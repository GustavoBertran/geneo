/**
 * Restriction-enzyme engine: site finding and digestion.
 *
 * Coordinate convention (see types.ts):
 *   - 0-based half-open intervals; strand 1 = top, -1 = bottom.
 *   - Enzyme cut offsets (cutTop/cutBottom) are measured from the first base of
 *     the recognition site along the top-strand coordinate.
 *
 * Reuses the shared primitives from ./sequence (IUPAC, reverseComplement,
 * subsequence, spanLength) — none are reimplemented here.
 */
import type { CutSite, Enzyme, Fragment, OverhangType, SeqRecord } from './types'
import { ENZYME_DATA } from '../data/enzymes'
import { IUPAC, reverseComplement, subsequence, spanLength } from './sequence'

/** The bundled enzyme database. */
export const ENZYMES: Enzyme[] = ENZYME_DATA

/** Linear lookup of an enzyme by name (case-sensitive, exact). */
export function getEnzyme(name: string): Enzyme | undefined {
  for (const e of ENZYMES) {
    if (e.name === name) return e
  }
  return undefined
}

/** Whether a recognition site (5'->3') is its own reverse complement. */
function isPalindrome(site: string): boolean {
  return site === reverseComplement(site)
}

/**
 * Does the (possibly IUPAC-ambiguous) recognition base `siteBase` match the
 * template base `templateBase`? Every concrete possibility of the template base
 * must be permitted by the site code (so a definite A matches N/R/W, but an N in
 * the molecule only matches a site N).
 */
function baseMatches(siteBase: string, templateBase: string): boolean {
  const allowed = IUPAC[siteBase]
  if (!allowed) return false
  const tmpl = IUPAC[templateBase]
  if (!tmpl) return false
  for (let i = 0; i < tmpl.length; i++) {
    if (allowed.indexOf(tmpl[i]) === -1) return false
  }
  return true
}

/** Match a pattern against `seq` starting at offset `at` (no wrapping). */
function matchesAt(seq: string, at: number, pattern: string): boolean {
  if (at + pattern.length > seq.length) return false
  for (let i = 0; i < pattern.length; i++) {
    if (!baseMatches(pattern[i], seq[at + i])) return false
  }
  return true
}

/** Derive an overhang label from cut offsets when not stored on the enzyme. */
function deriveOverhang(cutTop: number, cutBottom: number): OverhangType {
  if (cutTop === cutBottom) return 'blunt'
  return cutTop < cutBottom ? "5'" : "3'"
}

/**
 * All cut sites for the given enzymes, sorted by top-strand cut position.
 *
 * Palindromic sites are scanned once on the top strand (strand +1). For
 * non-palindromic sites we additionally scan for reverseComplement(site) and
 * emit those as strand -1 sites with cut coordinates remapped onto the top
 * strand:  for a revcomp match at [p, p+L) the top cut is p + (L - cutBottom)
 * and the bottom cut is p + (L - cutTop).
 *
 * For circular molecules sites that span the origin are detected by scanning a
 * window of `seq` plus a copy of its leading bases; all coordinates are reported
 * modulo the sequence length and de-duplicated.
 */
export function findCutSites(record: SeqRecord, enzymes: Enzyme[]): CutSite[] {
  const seq = record.sequence
  const len = seq.length
  const circular = record.topology === 'circular'
  const sites: CutSite[] = []
  const seen = new Set<string>()

  if (len === 0) return sites

  const pushSite = (
    enzymeName: string,
    siteStart: number,
    siteLength: number,
    cutPosTop: number,
    cutPosBottom: number,
    strand: 1 | -1,
    overhang: OverhangType
  ): void => {
    // Linear molecules cannot be cut outside their physical ends. Type IIS
    // enzymes cut a fixed distance away from the recognition site, so a site
    // near a linear end can produce a cut beyond [0,len]; such cuts do not
    // occur on the molecule and are dropped. (Circular topology wraps instead.)
    if (!circular && (cutPosTop < 0 || cutPosTop > len || cutPosBottom < 0 || cutPosBottom > len)) {
      return
    }
    const ss = circular ? ((siteStart % len) + len) % len : siteStart
    const key = `${enzymeName}@${ss}#${strand}`
    if (seen.has(key)) return
    seen.add(key)
    sites.push({
      enzyme: enzymeName,
      siteStart: ss,
      siteLength,
      cutPosTop: circular ? ((cutPosTop % len) + len) % len : cutPosTop,
      cutPosBottom: circular ? ((cutPosBottom % len) + len) % len : cutPosBottom,
      strand,
      overhang
    })
  }

  // For circular molecules, pad with the leading bases so origin-spanning sites
  // are visible to the linear scan. Padding never exceeds the sequence length.
  const maxPad = circular ? Math.max(0, ...enzymes.map((e) => e.site.length - 1)) : 0
  const scanWindow = circular ? seq + seq.slice(0, Math.min(maxPad, len)) : seq

  for (const enz of enzymes) {
    const site = enz.site
    const L = site.length
    if (L === 0 || L > len) continue
    const overhang: OverhangType = enz.overhang ?? deriveOverhang(enz.cutTop, enz.cutBottom)
    const palindrome = isPalindrome(site)

    // Forward (strand +1) scan. Circular allows starts up to len-1 (wrapping).
    const lastStart = circular ? len - 1 : len - L
    for (let p = 0; p <= lastStart; p++) {
      if (matchesAt(scanWindow, p, site)) {
        pushSite(enz.name, p, L, p + enz.cutTop, p + enz.cutBottom, 1, overhang)
      }
    }

    // Reverse-complement (strand -1) scan, only for non-palindromic sites.
    if (!palindrome) {
      const rc = reverseComplement(site)
      for (let p = 0; p <= lastStart; p++) {
        if (matchesAt(scanWindow, p, rc)) {
          const cutTop = p + (L - enz.cutBottom)
          const cutBottom = p + (L - enz.cutTop)
          pushSite(enz.name, p, L, cutTop, cutBottom, -1, overhang)
        }
      }
    }
  }

  sites.sort((a, b) => a.cutPosTop - b.cutPosTop || a.cutPosBottom - b.cutPosBottom)
  return sites
}

/**
 * Digest the record into fragments using its topology.
 *
 * Cuts are taken at the unique top-strand cut positions (cutPosTop). For a
 * LINEAR molecule with N cuts we produce N+1 fragments (the two outer ends carry
 * undefined enzymes). For a CIRCULAR molecule with N cuts we produce N
 * fragments, one of which may span the origin (start > end). Fragment lengths
 * always sum to record.sequence.length.
 */
export function digest(record: SeqRecord, enzymes: Enzyme[]): Fragment[] {
  const seq = record.sequence
  const len = seq.length
  const topology = record.topology
  const circular = topology === 'circular'

  const cutSites = findCutSites(record, enzymes)

  // Collapse to unique cut positions (top strand). If two enzymes cut at the
  // same position keep the first encountered (sorted by position already).
  const cutByPos = new Map<number, string>()
  for (const cs of cutSites) {
    if (!cutByPos.has(cs.cutPosTop)) cutByPos.set(cs.cutPosTop, cs.enzyme)
  }
  const positions = Array.from(cutByPos.keys()).sort((a, b) => a - b)

  const fragments: Fragment[] = []
  if (len === 0) return fragments

  if (!circular) {
    if (positions.length === 0) {
      fragments.push(makeFragment(seq, 0, len, len, undefined, undefined, topology))
      return fragments
    }
    let prev = 0
    let leftEnz: string | undefined = undefined
    for (const pos of positions) {
      const enz = cutByPos.get(pos)
      fragments.push(
        makeFragment(seq, prev, pos, spanLength(prev, pos, len, topology), leftEnz, enz, topology)
      )
      prev = pos
      leftEnz = enz
    }
    fragments.push(
      makeFragment(seq, prev, len, spanLength(prev, len, len, topology), leftEnz, undefined, topology)
    )
    return fragments
  }

  // Circular.
  if (positions.length === 0) {
    // Uncut circle -> single full-length fragment.
    fragments.push(makeFragment(seq, 0, len, len, undefined, undefined, topology))
    return fragments
  }
  if (positions.length === 1) {
    // Single cut -> one linear fragment around the whole circle. Represented as
    // start === end with length === len (a full rotation; the start>end wrap
    // convention cannot express a complete circle). Use pos..pos+len so
    // subsequence's full-circle branch fires and returns all `len` bases.
    const pos = positions[0]
    const enz = cutByPos.get(pos)
    fragments.push(makeFragment(seq, pos, pos + len, len, enz, enz, topology))
    fragments[0].end = pos
    return fragments
  }
  // N cuts -> N fragments between consecutive cuts, wrapping at the origin.
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]
    const end = positions[(i + 1) % positions.length]
    const leftEnz = cutByPos.get(start)
    const rightEnz = cutByPos.get(end)
    const length = spanLength(start, end, len, topology)
    fragments.push(makeFragment(seq, start, end, length, leftEnz, rightEnz, topology))
  }
  return fragments
}

function makeFragment(
  seq: string,
  start: number,
  end: number,
  length: number,
  leftEnzyme: string | undefined,
  rightEnzyme: string | undefined,
  topology: SeqRecord['topology']
): Fragment {
  return {
    start,
    end,
    length,
    sequence: subsequence(seq, start, end, topology),
    leftEnzyme,
    rightEnzyme
  }
}

/**
 * Number of cut sites per enzyme name across the record. Each located site
 * counts once (palindromic sites are not double-counted because the reverse
 * strand is not separately scanned for them).
 */
export function cutCounts(record: SeqRecord, enzymes: Enzyme[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const enz of enzymes) {
    if (!counts.has(enz.name)) counts.set(enz.name, 0)
  }
  for (const cs of findCutSites(record, enzymes)) {
    counts.set(cs.enzyme, (counts.get(cs.enzyme) ?? 0) + 1)
  }
  return counts
}
