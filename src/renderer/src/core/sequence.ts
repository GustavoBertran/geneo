/**
 * Low-level nucleotide sequence utilities. Pure functions, no UI imports.
 * These are the shared primitives the higher-level engines (enzymes, ORFs,
 * primers, I/O) all build on.
 */
import type { SeqRecord, Topology } from './types'

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', N: 'N',
  // IUPAC ambiguity codes
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D',
  // keep lowercase support, gaps
  '-': '-', '.': '.'
}

/** Map of IUPAC ambiguity code -> set of matching concrete bases (uppercase). */
export const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'GC', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT'
}

/** Normalize raw text into an uppercase DNA string (strips whitespace/digits). */
export function cleanSequence(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '')
}

/** Complement a single base (uppercase IUPAC aware). */
export function complementBase(b: string): string {
  return COMPLEMENT[b.toUpperCase()] ?? 'N'
}

/** Complement (not reversed). */
export function complement(seq: string): string {
  let out = ''
  for (let i = 0; i < seq.length; i++) out += complementBase(seq[i])
  return out
}

/** Reverse complement, 5'->3'. */
export function reverseComplement(seq: string): string {
  let out = ''
  for (let i = seq.length - 1; i >= 0; i--) out += complementBase(seq[i])
  return out
}

/** GC fraction in [0,1]. Ambiguous/N bases are ignored in the denominator. */
export function gcContent(seq: string): number {
  let gc = 0
  let at = 0
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i].toUpperCase()
    if (c === 'G' || c === 'C') gc++
    else if (c === 'A' || c === 'T' || c === 'U') at++
  }
  const total = gc + at
  return total === 0 ? 0 : gc / total
}

/**
 * Extract a subsequence honoring topology. For circular molecules, indices may
 * wrap past the end. `start`/`end` are half-open; for a wrapping circular span
 * pass start > end. For linear molecules indices are clamped to [0,len].
 */
export function subsequence(
  seq: string,
  start: number,
  end: number,
  topology: Topology
): string {
  const len = seq.length
  if (len === 0) return ''
  if (topology === 'circular') {
    const s = ((start % len) + len) % len
    let e = ((end % len) + len) % len
    if (s === e && start !== end) {
      // full circle
      return seq.slice(s) + seq.slice(0, e)
    }
    if (s <= e) return seq.slice(s, e)
    return seq.slice(s) + seq.slice(0, e) // wraps origin
  }
  const s = Math.max(0, Math.min(start, len))
  const e = Math.max(0, Math.min(end, len))
  return s <= e ? seq.slice(s, e) : ''
}

/** Length covered by a possibly-wrapping span on a record. */
export function spanLength(start: number, end: number, recordLength: number, topology: Topology): number {
  if (topology === 'circular' && end < start) {
    return recordLength - start + end
  }
  return end - start
}

/** Normalize an index into [0,len) for circular, or clamp for linear. */
export function normalizeIndex(i: number, len: number, topology: Topology): number {
  if (len === 0) return 0
  if (topology === 'circular') return ((i % len) + len) % len
  return Math.max(0, Math.min(i, len))
}

/** Molecular weight (g/mol) of single-stranded DNA, approximate. */
export function molecularWeightSS(seq: string): number {
  const w: Record<string, number> = { A: 313.21, T: 304.2, G: 329.21, C: 289.18, N: 308.95 }
  let sum = 0
  for (const b of seq.toUpperCase()) sum += w[b] ?? w.N
  return sum - 61.96 // minus one phosphate for the 5' end approximation
}

/** Convenience: a fresh record-ready id. Deterministic-ish without Date.now. */
let _idCounter = 0
export function makeId(prefix = 'id'): string {
  _idCounter += 1
  return `${prefix}_${_idCounter.toString(36)}_${(_idCounter * 2654435761 % 0xffffff).toString(36)}`
}

/** Shallow validation/normalization for a record loaded from disk. */
export function normalizeRecord(rec: SeqRecord): SeqRecord {
  return {
    ...rec,
    sequence: cleanSequence(rec.sequence),
    features: rec.features ?? []
  }
}
