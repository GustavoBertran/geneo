/**
 * Primer analysis, binding-site search, PCR simulation and primer design.
 * Pure functions, no UI imports. Builds on the shared sequence primitives.
 */
import type { PcrProduct, PrimerBindingSite, Range, SeqRecord, Primer, Strand } from './types'
import {
  reverseComplement,
  gcContent,
  subsequence,
  cleanSequence,
  makeId,
  IUPAC
} from './sequence'

export interface PrimerAnalysis {
  length: number
  tm: number
  gc: number
  /** 3' GC clamp (number of G/C in the last 5 bases). */
  gcClamp: number
  hairpin: boolean
  selfDimer: boolean
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Melting temperature
// ---------------------------------------------------------------------------

/**
 * SantaLucia (1998) unified nearest-neighbor parameters.
 * dH in kcal/mol, dS in cal/(K·mol). Keyed by the 5'->3' dinucleotide on the
 * top strand (the complementary stack is implied).
 */
const NN_DH: Record<string, number> = {
  AA: -7.9, AT: -7.2, AC: -8.4, AG: -7.8,
  TA: -7.2, TT: -7.9, TC: -8.2, TG: -8.5,
  CA: -8.5, CT: -7.8, CC: -8.0, CG: -10.6,
  GA: -8.2, GT: -8.4, GC: -9.8, GG: -8.0
}
const NN_DS: Record<string, number> = {
  AA: -22.2, AT: -20.4, AC: -22.4, AG: -21.0,
  TA: -21.3, TT: -22.2, TC: -22.2, TG: -22.7,
  CA: -22.7, CT: -21.0, CC: -19.9, CG: -27.2,
  GA: -22.2, GT: -22.4, GC: -24.4, GG: -19.9
}

// Default reaction conditions.
const PRIMER_CONC = 0.25e-6 // total strand concentration (M)
const NA_CONC = 0.05 // monovalent cation (M)
const R = 1.987 // gas constant cal/(K·mol)

/**
 * Reduce an (possibly ambiguous/lowercase) sequence to A/C/G/T for NN
 * thermodynamics. Ambiguous bases are mapped to their first concrete option so
 * Tm degrades gracefully rather than throwing.
 */
function toConcrete(seq: string): string {
  const s = cleanSequence(seq)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === 'A' || c === 'C' || c === 'G' || c === 'T') {
      out += c
    } else {
      const opts = IUPAC[c]
      out += opts && opts.length > 0 ? opts[0] : 'A'
    }
  }
  return out
}

/**
 * Nearest-neighbor melting temperature (°C). Wallace rule fallback for
 * sequences shorter than 8 nt.
 */
export function calcTm(seq: string): number {
  const s = toConcrete(seq)
  const n = s.length
  if (n === 0) return 0

  // Wallace rule for very short oligos.
  if (n < 8) {
    let at = 0
    let gc = 0
    for (let i = 0; i < n; i++) {
      const c = s[i]
      if (c === 'A' || c === 'T') at++
      else if (c === 'G' || c === 'C') gc++
    }
    return 2 * at + 4 * gc
  }

  // Sum nearest-neighbor enthalpy/entropy.
  let dH = 0
  let dS = 0
  for (let i = 0; i < n - 1; i++) {
    const pair = s[i] + s[i + 1]
    dH += NN_DH[pair] ?? 0
    dS += NN_DS[pair] ?? 0
  }

  // Initiation terms (SantaLucia 1998 unified): terminal base penalties.
  const init = (b: string): void => {
    if (b === 'G' || b === 'C') {
      dH += 0.1
      dS += -2.8
    } else {
      // A or T terminus
      dH += 2.3
      dS += 4.1
    }
  }
  init(s[0])
  init(s[n - 1])

  // Tm at standard 1 M Na+. ct used for non-self-complementary duplex.
  // The /4 factor reflects total strand concentration for non-self-comp duplex.
  const ct = PRIMER_CONC
  const tmK = (dH * 1000) / (dS + R * Math.log(ct / 4))

  // Salt correction (SantaLucia 1998): adjust 1/Tm by the number of phosphates.
  const lnNa = Math.log(NA_CONC)
  const tmKSalt = 1 / (1 / tmK + (0.368 * (n - 1) * lnNa) / (dH * 1000))

  const tmC = tmKSalt - 273.15
  if (!isFinite(tmC)) return 0
  return tmC
}

// ---------------------------------------------------------------------------
// GC content
// ---------------------------------------------------------------------------

/** GC percentage 0..100. */
export function calcGc(seq: string): number {
  return gcContent(seq) * 100
}

// ---------------------------------------------------------------------------
// Primer analysis
// ---------------------------------------------------------------------------

/** Does base `a` pair with base `b` (Watson-Crick on opposing antiparallel)? */
function pairs(a: string, b: string): boolean {
  return (
    (a === 'A' && b === 'T') ||
    (a === 'T' && b === 'A') ||
    (a === 'G' && b === 'C') ||
    (a === 'C' && b === 'G')
  )
}

/**
 * Detect a self-complementary hairpin: a stem of >= 4 bp with a loop >= 3 nt.
 * We test every loop center and stem length, pairing bases that fold back.
 */
function hasHairpin(seq: string): boolean {
  const s = toConcrete(seq)
  const n = s.length
  const MIN_STEM = 4
  const MIN_LOOP = 3
  // i..j is the loop region (exclusive of stem). Stem pairs s[i-1-k] with s[j+k].
  for (let i = 0; i < n; i++) {
    for (let j = i + MIN_LOOP; j < n; j++) {
      // loop is (i, j) exclusive => loop length j - i - 1 ... ensure >= MIN_LOOP
      if (j - i - 1 < MIN_LOOP) continue
      let stem = 0
      let left = i
      let right = j
      while (left >= 0 && right < n && pairs(s[left], s[right])) {
        stem++
        left--
        right++
        if (stem >= MIN_STEM) return true
      }
    }
  }
  return false
}

/**
 * Detect a self-dimer: a complementary run of >= 4 bp that includes the 3' end.
 * We slide the reverse complement of the primer against itself and look for a
 * contiguous match anchored at (overlapping) the 3' terminus.
 */
function hasSelfDimer(seq: string): boolean {
  const s = toConcrete(seq)
  const n = s.length
  if (n < 4) return false
  const rc = reverseComplement(s)
  // A complementary alignment of s against itself = aligning s with rc.
  // Try every relative offset; count longest contiguous run; require it to
  // include the 3' base of the primer (index n-1 in s).
  for (let offset = -(n - 1); offset <= n - 1; offset++) {
    let run = 0
    let runIncludes3 = false
    for (let i = 0; i < n; i++) {
      const k = i + offset
      if (k < 0 || k >= n) {
        run = 0
        runIncludes3 = false
        continue
      }
      // s[i] pairs with s[n-1-k] when matching s against its own complement
      if (s[i] === rc[k]) {
        run++
        if (i === n - 1 || n - 1 - k === n - 1) runIncludes3 = true
        if (run >= 4 && runIncludes3) return true
      } else {
        run = 0
        runIncludes3 = false
      }
    }
  }
  return false
}

/** Longest homopolymer run length. */
function maxHomopolymer(seq: string): number {
  const s = toConcrete(seq)
  let best = 0
  let cur = 0
  let prev = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === prev) cur++
    else {
      cur = 1
      prev = s[i]
    }
    if (cur > best) best = cur
  }
  return best
}

export function analyzePrimer(seq: string): PrimerAnalysis {
  const clean = cleanSequence(seq)
  const length = clean.length
  const tm = calcTm(clean)
  const gc = calcGc(clean)

  // 3' GC clamp: G/C count in the last 5 bases.
  const last5 = clean.slice(Math.max(0, length - 5))
  let gcClamp = 0
  for (let i = 0; i < last5.length; i++) {
    const c = last5[i]
    if (c === 'G' || c === 'C') gcClamp++
  }

  const hairpin = hasHairpin(clean)
  const selfDimer = hasSelfDimer(clean)

  const warnings: string[] = []
  if (tm < 55 || tm > 65) warnings.push(`Tm ${tm.toFixed(1)}°C outside ideal 55-65°C`)
  if (gc < 40 || gc > 60) warnings.push(`GC ${gc.toFixed(0)}% outside ideal 40-60%`)
  if (gcClamp === 0) warnings.push("Weak 3' GC clamp (no G/C in last 5 bases)")
  if (gcClamp >= 4) warnings.push("Over-strong 3' GC clamp (>=4 G/C in last 5 bases)")
  if (maxHomopolymer(clean) >= 5) warnings.push('Homopolymer run >=5')
  if (length < 18 || length > 30) warnings.push(`Length ${length} outside ideal 18-30 nt`)
  if (hairpin) warnings.push('Potential hairpin (self-complementary stem >=4 bp)')
  if (selfDimer) warnings.push("Potential self-dimer (>=4 bp complementary run at 3' end)")

  return { length, tm, gc, gcClamp, hairpin, selfDimer, warnings }
}

// ---------------------------------------------------------------------------
// Binding-site search
// ---------------------------------------------------------------------------

/**
 * Count mismatches between primer `p` and template footprint `t` (same length).
 * Returns -1 early-out if it exceeds maxMismatch, otherwise the count. Also
 * enforces that the 3'-most 2 bases match exactly (anchored extension).
 *
 * `p` is the oligo that anneals; comparison is base-by-base against the
 * template strand it would copy. The 3' end of `p` corresponds to the last
 * index of `p` (we orient `p` so index 0 is its 5' base, length-1 its 3').
 */
function matchFootprint(p: string, t: string, maxMismatch: number): number {
  const n = p.length
  if (t.length !== n) return -1
  // 3'-most 2 bases (indices n-1, n-2) must match exactly.
  const anchor = Math.min(2, n)
  for (let k = 0; k < anchor; k++) {
    if (p[n - 1 - k] !== t[n - 1 - k]) return -1
  }
  let mm = 0
  for (let i = 0; i < n; i++) {
    if (p[i] !== t[i]) {
      mm++
      if (mm > maxMismatch) return -1
    }
  }
  return mm
}

export function findPrimerBindingSites(
  record: SeqRecord,
  primer: { id: string; name: string; sequence: string },
  maxMismatch = 0
): PrimerBindingSite[] {
  const top = cleanSequence(record.sequence)
  const len = top.length
  const circular = record.topology === 'circular'
  const pSeq = cleanSequence(primer.sequence)
  const plen = pSeq.length
  const sites: PrimerBindingSite[] = []
  if (plen === 0 || len === 0) return sites

  // The forward-orientation oligo (strand 1) IS the primer: its sequence must
  // match a top-strand footprint read 5'->3'.
  const fwdProbe = pSeq
  // The reverse-orientation oligo (strand -1): reverseComplement(primer) reads
  // along the top strand 5'->3' at its footprint.
  const revProbe = reverseComplement(pSeq)

  const lastStart = circular ? len - 1 : len - plen
  for (let p = 0; p <= lastStart; p++) {
    // Footprint [p, p+plen) honoring circular wrap.
    const end = p + plen
    if (!circular && end > len) break
    const footprint = circular ? subsequence(top, p, end % len === 0 ? len : end % len, 'circular') : top.slice(p, end)
    if (footprint.length !== plen) continue

    // Forward orientation: primer matches top-strand footprint; 3' end is at
    // the high (downstream) coordinate.
    const mmF = matchFootprint(fwdProbe, footprint, maxMismatch)
    if (mmF >= 0) {
      sites.push({
        primerId: primer.id,
        primerName: primer.name,
        start: p,
        end: ((end - 1) % len) + 1,
        strand: 1 as Strand,
        mismatches: mmF,
        tm: calcTm(footprint)
      })
    }

    // Reverse orientation: reverseComplement(primer) matches top-strand
    // footprint. The primer's 3' end sits at the LOW (upstream) coordinate,
    // i.e. index 0 of the footprint. We compare revProbe (which is 5'->3' on
    // top) against the footprint, with the anchor at revProbe's 3' end =
    // footprint's high end; that corresponds to the primer's 5' end. We must
    // anchor the PRIMER's 3' end, which is the footprint's low end, so check
    // the first two bases instead.
    const mmR = matchFootprintRev(revProbe, footprint, maxMismatch)
    if (mmR >= 0) {
      sites.push({
        primerId: primer.id,
        primerName: primer.name,
        start: p,
        end: ((end - 1) % len) + 1,
        strand: -1 as Strand,
        mismatches: mmR,
        tm: calcTm(footprint)
      })
    }
  }

  return sites
}

/**
 * Like matchFootprint but anchors the LOW end (footprint index 0..1), because
 * for a reverse-orientation primer the 3' end of the primer aligns to the
 * upstream (low) coordinate of the top-strand footprint.
 */
function matchFootprintRev(probe: string, t: string, maxMismatch: number): number {
  const n = probe.length
  if (t.length !== n) return -1
  const anchor = Math.min(2, n)
  for (let k = 0; k < anchor; k++) {
    if (probe[k] !== t[k]) return -1
  }
  let mm = 0
  for (let i = 0; i < n; i++) {
    if (probe[i] !== t[i]) {
      mm++
      if (mm > maxMismatch) return -1
    }
  }
  return mm
}

// ---------------------------------------------------------------------------
// PCR simulation
// ---------------------------------------------------------------------------

export function simulatePcr(
  record: SeqRecord,
  fwd: string,
  rev: string,
  maxMismatch = 0
): PcrProduct[] {
  const top = cleanSequence(record.sequence)
  const len = top.length
  const circular = record.topology === 'circular'
  const products: PcrProduct[] = []
  if (len === 0) return products

  const fwdSites = findPrimerBindingSites(
    record,
    { id: 'fwd', name: fwd, sequence: fwd },
    maxMismatch
  ).filter((s) => s.strand === 1)

  const revSites = findPrimerBindingSites(
    record,
    { id: 'rev', name: rev, sequence: rev },
    maxMismatch
  ).filter((s) => s.strand === -1)

  for (const f of fwdSites) {
    for (const r of revSites) {
      // Product spans from the forward footprint start to the reverse footprint
      // end (both top-strand coordinates). Reverse must be downstream.
      const start = f.start
      const end = r.end
      let length: number
      if (end > start) {
        length = end - start
      } else if (circular) {
        // wrap around the origin
        length = len - start + end
      } else {
        continue // reverse not downstream on a linear template
      }
      if (length <= 0 || length > len) continue
      // Full-circle case (start === end on a circular template): subsequence's
      // start!==end guard would return '' for equal indices, so take the whole
      // molecule from `start` explicitly.
      const sequence =
        circular && start === end ? top.slice(start) + top.slice(0, start) : subsequence(top, start, end, record.topology)
      products.push({
        forwardPrimer: fwd,
        reversePrimer: rev,
        start,
        end,
        length,
        sequence
      })
    }
  }

  return products
}

// ---------------------------------------------------------------------------
// Primer design
// ---------------------------------------------------------------------------

export function designPrimers(
  record: SeqRecord,
  region: Range,
  opts?: { targetTm?: number; minLen?: number; maxLen?: number }
): { forward: Primer; reverse: Primer } | null {
  const top = cleanSequence(record.sequence)
  const len = top.length
  if (len === 0) return null

  const targetTm = opts?.targetTm ?? 60
  const minLen = opts?.minLen ?? 18
  const maxLen = opts?.maxLen ?? 30
  const circular = record.topology === 'circular'

  // Validate region.
  if (!Number.isFinite(region.start) || !Number.isFinite(region.end)) return null
  if (region.start < 0 || region.end < 0) return null
  if (!circular) {
    if (region.start > len || region.end > len) return null
    if (region.end <= region.start) return null
    if (region.end - region.start < 1) return null
  } else {
    if (region.start >= len || region.end > len) return null
  }

  // Forward primer: top-strand bases starting at region.start, grown from
  // minLen until Tm >= targetTm (capped at maxLen).
  const fwdSeq = growForward(top, region.start, minLen, maxLen, targetTm, record.topology)
  if (!fwdSeq) return null

  // Reverse primer: reverseComplement of top-strand bases ending at region.end.
  const revSeq = growReverse(top, region.end, minLen, maxLen, targetTm, record.topology, len)
  if (!revSeq) return null

  const forward: Primer = {
    id: makeId('primer'),
    name: 'Fwd',
    sequence: fwdSeq,
    binding: {
      start: ((region.start % len) + len) % len,
      end: ((region.start + fwdSeq.length) % len + len) % len || len,
      strand: 1,
      mismatches: 0
    }
  }

  // The reverse primer footprint on the top strand ends at region.end and has
  // length revSeq.length, so it starts at region.end - revSeq.length.
  const revFootStart = ((region.end - revSeq.length) % len + len) % len
  const reverse: Primer = {
    id: makeId('primer'),
    name: 'Rev',
    sequence: revSeq,
    binding: {
      start: revFootStart,
      end: ((region.end % len) + len) % len || len,
      strand: -1,
      mismatches: 0
    }
  }

  return { forward, reverse }
}

/** Grow a top-strand oligo starting at `start` to hit targetTm. */
function growForward(
  top: string,
  start: number,
  minLen: number,
  maxLen: number,
  targetTm: number,
  topology: SeqRecord['topology']
): string | null {
  let chosen = ''
  for (let L = minLen; L <= maxLen; L++) {
    const seq = subsequence(top, start, start + L, topology)
    if (seq.length < L) {
      // ran off the end of a linear template
      if (chosen) return chosen
      // not even minLen available
      if (seq.length < minLen) return seq.length > 0 ? seq : null
      chosen = seq
      return chosen
    }
    chosen = seq
    if (calcTm(seq) >= targetTm) return seq
  }
  return chosen || null
}

/** Grow the reverse primer = revComp of top-strand bases ending at `end`. */
function growReverse(
  top: string,
  end: number,
  minLen: number,
  maxLen: number,
  targetTm: number,
  topology: SeqRecord['topology'],
  len: number
): string | null {
  let chosen = ''
  for (let L = minLen; L <= maxLen; L++) {
    const footStart = end - L
    const footprint =
      topology === 'circular'
        ? subsequence(top, ((footStart % len) + len) % len, ((end % len) + len) % len || len, 'circular')
        : footStart < 0
          ? top.slice(0, Math.max(0, end))
          : top.slice(footStart, end)
    if (footprint.length < L) {
      if (chosen) return chosen
      if (footprint.length < minLen) return footprint.length > 0 ? reverseComplement(footprint) : null
      chosen = reverseComplement(footprint)
      return chosen
    }
    const rc = reverseComplement(footprint)
    chosen = rc
    if (calcTm(rc) >= targetTm) return rc
  }
  return chosen || null
}
