/**
 * Genetic code (NCBI translation table 1), six-frame translation, ORF finding
 * and protein molecular weight. Pure functions, no UI imports.
 */
import type { Orf, SeqRecord, Strand } from './types'
import { IUPAC, reverseComplement } from './sequence'

// ---------------------------------------------------------------------------
// Codon table (NCBI translation table 1)
// ---------------------------------------------------------------------------

/**
 * All 64 codons -> single-letter amino acid; TAA/TAG/TGA -> '*'.
 * Codons are stored using DNA letters (T, not U); `translate` maps U->T on
 * input so RNA is accepted transparently.
 */
export const CODON_TABLE: Record<string, string> = buildCodonTable()

function buildCodonTable(): Record<string, string> {
  // Order of bases for the standard table string below.
  const bases = 'TCAG'
  // NCBI table 1 amino acids in TCAG x TCAG x TCAG order.
  const aas =
    'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
  const table: Record<string, string> = {}
  let i = 0
  for (const b1 of bases) {
    for (const b2 of bases) {
      for (const b3 of bases) {
        table[b1 + b2 + b3] = aas[i++]
      }
    }
  }
  return table
}

// ---------------------------------------------------------------------------
// Amino-acid names
// ---------------------------------------------------------------------------

export const AA_NAMES: Record<string, { three: string; full: string }> = {
  A: { three: 'Ala', full: 'Alanine' },
  R: { three: 'Arg', full: 'Arginine' },
  N: { three: 'Asn', full: 'Asparagine' },
  D: { three: 'Asp', full: 'Aspartic acid' },
  C: { three: 'Cys', full: 'Cysteine' },
  Q: { three: 'Gln', full: 'Glutamine' },
  E: { three: 'Glu', full: 'Glutamic acid' },
  G: { three: 'Gly', full: 'Glycine' },
  H: { three: 'His', full: 'Histidine' },
  I: { three: 'Ile', full: 'Isoleucine' },
  L: { three: 'Leu', full: 'Leucine' },
  K: { three: 'Lys', full: 'Lysine' },
  M: { three: 'Met', full: 'Methionine' },
  F: { three: 'Phe', full: 'Phenylalanine' },
  P: { three: 'Pro', full: 'Proline' },
  S: { three: 'Ser', full: 'Serine' },
  T: { three: 'Thr', full: 'Threonine' },
  W: { three: 'Trp', full: 'Tryptophan' },
  Y: { three: 'Tyr', full: 'Tyrosine' },
  V: { three: 'Val', full: 'Valine' },
  '*': { three: '***', full: 'Stop' },
  X: { three: 'Xaa', full: 'Unknown' }
}

// ---------------------------------------------------------------------------
// Codon -> amino acid (IUPAC aware)
// ---------------------------------------------------------------------------

/** Cache of resolved ambiguous codons so we don't re-expand repeatedly. */
const codonCache: Record<string, string> = {}

/**
 * Resolve a single (already U->T normalized, uppercase) codon to an amino acid.
 * - Plain ACGT codons hit CODON_TABLE directly.
 * - Codons with IUPAC ambiguity codes are expanded; if every concrete
 *   expansion yields the same AA, that AA is returned, otherwise 'X'.
 * - Any base not in the IUPAC map, or any disagreement, yields 'X'.
 */
function codonToAA(codon: string): string {
  const direct = CODON_TABLE[codon]
  if (direct !== undefined) return direct
  const cached = codonCache[codon]
  if (cached !== undefined) return cached

  const e0 = IUPAC[codon[0]]
  const e1 = IUPAC[codon[1]]
  const e2 = IUPAC[codon[2]]
  if (!e0 || !e1 || !e2) {
    codonCache[codon] = 'X'
    return 'X'
  }
  let resolved: string | null = null
  for (const a of e0) {
    for (const b of e1) {
      for (const c of e2) {
        const aa = CODON_TABLE[a + b + c]
        if (aa === undefined) {
          codonCache[codon] = 'X'
          return 'X'
        }
        if (resolved === null) resolved = aa
        else if (resolved !== aa) {
          codonCache[codon] = 'X'
          return 'X'
        }
      }
    }
  }
  const out = resolved ?? 'X'
  codonCache[codon] = out
  return out
}

// ---------------------------------------------------------------------------
// translate
// ---------------------------------------------------------------------------

/**
 * Translate `dna` reading codons starting at `frame` (0..2). RNA accepted
 * (U treated as T). STOP codons render as '*' (not truncated). Ambiguous or
 * incomplete codons that do not resolve to a unique AA render as 'X'. A
 * trailing partial codon is ignored.
 */
export function translate(dna: string, frame = 0): string {
  const s = dna.toUpperCase().replace(/U/g, 'T')
  let out = ''
  for (let i = frame; i + 3 <= s.length; i += 3) {
    out += codonToAA(s.slice(i, i + 3))
  }
  return out
}

// ---------------------------------------------------------------------------
// sixFrameTranslate
// ---------------------------------------------------------------------------

export interface FrameTranslation {
  frame: number
  strand: Strand
  protein: string
}

/**
 * Six-frame translation. Forward frames 0/1/2 read `seq` (strand 1); reverse
 * frames 0/1/2 read reverseComplement(seq) (strand -1).
 */
export function sixFrameTranslate(seq: string): FrameTranslation[] {
  const s = seq.toUpperCase()
  const rc = reverseComplement(s)
  const out: FrameTranslation[] = []
  for (let f = 0; f < 3; f++) {
    out.push({ frame: f, strand: 1, protein: translate(s, f) })
  }
  for (let f = 0; f < 3; f++) {
    out.push({ frame: f, strand: -1, protein: translate(rc, f) })
  }
  return out
}

// ---------------------------------------------------------------------------
// findOrfs
// ---------------------------------------------------------------------------

const STOPS = new Set(['TAA', 'TAG', 'TGA'])

/**
 * Find ORFs on both strands.
 *
 * An ORF starts at ATG (when requireStart) and runs in-frame to the first stop
 * codon, inclusive of the stop. When requireStart is false, ORFs are read as
 * stop-to-stop segments: a new ORF begins at the frame start and immediately
 * after each stop, and ends at the next stop (inclusive).
 *
 * Reported coordinates are always TOP-STRAND, 0-based half-open, covering the
 * full ORF including its stop codon. For reverse-strand ORFs (found by scanning
 * reverseComplement) coordinates are mapped back to the top strand.
 *
 * For circular records ORFs may wrap the origin: scanning runs over a doubled
 * sequence (one extra full turn), ORF length is capped at the sequence length,
 * a wrap is represented as start > end, and ORFs identical modulo the sequence
 * length are de-duplicated.
 */
export function findOrfs(
  record: SeqRecord,
  opts?: { minAA?: number; requireStart?: boolean }
): Orf[] {
  const minAA = opts?.minAA ?? 75
  const requireStart = opts?.requireStart ?? true
  const seq = record.sequence.toUpperCase()
  const L = seq.length
  if (L === 0) return []
  const circular = record.topology === 'circular'

  const results: Orf[] = []
  const seen = new Set<string>()

  // Scan one strand. `scanSeq` is the sequence read 5'->3' for this strand.
  // `toTop(i)` maps an index in scanSeq's base coordinate to a top-strand
  // base coordinate. `scanLen` is the effective scan length (L for linear,
  // up to 2L for circular).
  const scanStrand = (
    scanSeq: string,
    strand: Strand,
    toTopBase: (i: number) => number,
    scanLen: number
  ): void => {
    for (let frame = 0; frame < 3; frame++) {
      let orfStart = -1 // codon index (in scanSeq) of current ORF start
      for (let i = frame; i + 3 <= scanLen; i += 3) {
        // For circular records we scan a doubled sequence so an ORF can run past
        // the origin, but we only START new ORFs within the first turn [0, L) to
        // avoid reporting the same wrapping ORF twice (once per copy).
        const canStart = !circular || i < L
        const codon = scanSeq.slice(i, i + 3)
        if (requireStart) {
          if (orfStart < 0) {
            if (canStart && codon === 'ATG') orfStart = i
            continue
          }
          if (STOPS.has(codon)) {
            emit(orfStart, i + 3, strand, frame, toTopBase)
            orfStart = -1
          }
        } else {
          if (orfStart < 0) {
            if (canStart) orfStart = i
            else continue
          }
          if (STOPS.has(codon)) {
            emit(orfStart, i + 3, strand, frame, toTopBase)
            orfStart = -1
          }
        }
        // Stop scanning a frame once we have advanced a full turn past where any
        // first-copy ORF could still be open with no stop found (cap length L).
        if (circular && orfStart >= 0 && i - orfStart + 3 >= L) {
          // ORF spans a full turn without a stop: cap and stop (no valid stop).
          orfStart = -1
        }
      }
    }
  }

  function emit(
    scanStart: number,
    scanEnd: number,
    strand: Strand,
    frame: number,
    toTopBase: (i: number) => number
  ): void {
    // Cap the span at one full turn (circular) — should not exceed scanLen but
    // be defensive against runaway lengths.
    let spanBases = scanEnd - scanStart
    if (circular && spanBases > L) spanBases = L
    const aaLen = spanBases / 3 - 1 // exclude the stop codon
    if (aaLen < minAA) return

    const protein = translate(scanSeq3(scanSeq, scanStart, spanBases), 0)
    // Protein excluding the trailing stop for length reporting.
    const proteinNoStop = protein.endsWith('*') ? protein.slice(0, -1) : protein

    // Map scan coordinates to top-strand half-open [start, end).
    let topStart: number
    let topEnd: number
    if (strand === 1) {
      const a = toTopBase(scanStart)
      const b = toTopBase(scanStart + spanBases)
      topStart = a
      topEnd = b
    } else {
      // Reverse strand: rc index r maps to top base (M-1-r). A half-open
      // rc span [s, e) covers top bases [M-e, M-s).
      const a = toTopBase(scanStart + spanBases - 1) // top index of last rc base
      const b = toTopBase(scanStart) // top index of first rc base
      topStart = a
      topEnd = b + 1
    }

    if (circular) {
      topStart = ((topStart % L) + L) % L
      // topEnd may equal L (origin) — represent the full coordinate then reduce.
      const reducedEnd = ((topEnd % L) + L) % L
      topEnd = reducedEnd
      // For a non-wrapping ORF that exactly fills to L, end reduces to start;
      // keep start<end by detecting that span==L.
      if (spanBases === L) {
        topEnd = topStart // full circle marker (start==end) — extremely rare
      }
    }

    const key = `${topStart}:${strand}:${frame}:${spanBases}`
    if (seen.has(key)) return
    seen.add(key)

    results.push({
      start: topStart,
      end: topEnd,
      strand,
      frame,
      length: proteinNoStop.length,
      protein
    })
  }

  // Helper to extract a (possibly wrapping) substring from scanSeq by base
  // length without needing topology (scanSeq is already the doubled string for
  // circular, so a plain slice is correct).
  function scanSeq3(scanSeq: string, start: number, spanBases: number): string {
    return scanSeq.slice(start, start + spanBases)
  }

  // Forward strand.
  let scanSeq = seq
  if (circular) scanSeq = seq + seq
  scanStrand(scanSeq, 1, (i) => i, circular ? 2 * L : L)

  // Reverse strand.
  const rcBase = reverseComplement(seq)
  let rcScan = rcBase
  // M = length of the rc scan string used for mapping (must match scanSeq).
  let M = L
  if (circular) {
    rcScan = rcBase + rcBase
    M = 2 * L
  }
  scanSeq = rcScan
  scanStrand(rcScan, -1, (i) => M - 1 - i, circular ? 2 * L : L)

  results.sort((a, b) => (a.start - b.start) || (a.strand - b.strand))
  return results
}

// ---------------------------------------------------------------------------
// molecularWeightProtein
// ---------------------------------------------------------------------------

/**
 * Average molecular weights (Da) of the free amino acids (residue + one water).
 * The protein mass is the sum of these minus (n-1) waters for the peptide bonds.
 */
const AA_MASS: Record<string, number> = {
  A: 89.0935, R: 174.2017, N: 132.1184, D: 133.1032, C: 121.159,
  E: 147.1293, Q: 146.1451, G: 75.0669, H: 155.1546, I: 131.1736,
  L: 131.1736, K: 146.1882, M: 149.2124, F: 165.19, P: 115.131,
  S: 105.093, T: 119.1197, W: 204.2262, Y: 181.1894, V: 117.1469
}

const WATER = 18.015
// Average free amino-acid mass used for 'X' (unknown) — mean of the 20 above.
const X_MASS =
  Object.values(AA_MASS).reduce((s, m) => s + m, 0) /
  Object.keys(AA_MASS).length

/**
 * Average molecular weight (Da) of a protein: sum of the free amino-acid masses
 * minus (n-1) waters (one per peptide bond). '*' is ignored; 'X' uses the mean
 * amino-acid mass. Returns 0 for an empty/all-stop input.
 */
export function molecularWeightProtein(protein: string): number {
  let sum = 0
  let n = 0
  for (const ch of protein.toUpperCase()) {
    if (ch === '*') continue
    if (ch === 'X') {
      sum += X_MASS
      n++
      continue
    }
    const m = AA_MASS[ch]
    if (m === undefined) continue
    sum += m
    n++
  }
  if (n === 0) return 0
  return sum - (n - 1) * WATER
}
