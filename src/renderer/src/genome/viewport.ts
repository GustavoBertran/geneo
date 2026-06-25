/**
 * Coordinate math for the genome browser: locus clamping, bp<->px scaling,
 * tick generation, and locus formatting/parsing. Pure functions.
 */
import type { Chromosome, Locus, Viewport } from './types'

/** Smallest viewable span (so zoom-in bottoms out at base level, not 0). */
export const MIN_SPAN = 40

/**
 * Canonical chromosome name so a GFF seqid ("17"), an Ensembl FASTA header
 * ("17"), and a UCSC name ("chr17") all collapse to one key. Numeric/X/Y/MT
 * names become chr-prefixed (MT -> chrM); anything else is returned unchanged.
 */
export function normalizeChromName(raw: string): string {
  const s = raw.trim()
  const m = s.match(/^(?:chr)?(\d+|[XYxy]|MT|mt|M|m)$/)
  if (!m) return s
  let core = m[1].toUpperCase()
  if (core === 'MT') core = 'M'
  return 'chr' + core
}

/** Build a Viewport (the bp<->px scale) for a locus and pixel width. */
export function makeViewport(locus: Locus, width: number): Viewport {
  const span = Math.max(1, locus.end - locus.start)
  const pxPerBp = width / span
  return {
    locus,
    width,
    pxPerBp,
    bpToPx: (bp: number) => (bp - locus.start) * pxPerBp,
    pxToBp: (px: number) => locus.start + px / pxPerBp
  }
}

/** Clamp a locus to the chromosome bounds, enforcing a minimum span. */
export function clampLocus(locus: Locus, chrom: Chromosome | undefined): Locus {
  const max = chrom ? chrom.length : locus.end
  let start = Math.round(locus.start)
  let end = Math.round(locus.end)
  if (end - start < MIN_SPAN) {
    const mid = (start + end) / 2
    start = Math.round(mid - MIN_SPAN / 2)
    end = start + MIN_SPAN
  }
  // shift into bounds preserving span where possible
  const span = end - start
  if (span >= max) {
    start = 0
    end = max
  } else {
    if (start < 0) {
      start = 0
      end = span
    }
    if (end > max) {
      end = max
      start = max - span
    }
  }
  return { chrom: locus.chrom, start: Math.max(0, start), end }
}

/** Zoom by `factor` (<1 = zoom in) keeping `anchorBp` fixed on screen. */
export function zoomLocus(
  locus: Locus,
  factor: number,
  anchorBp: number,
  chrom: Chromosome | undefined
): Locus {
  const span = locus.end - locus.start
  const newSpan = Math.max(MIN_SPAN, span * factor)
  const frac = (anchorBp - locus.start) / span
  const start = anchorBp - frac * newSpan
  return clampLocus({ chrom: locus.chrom, start, end: start + newSpan }, chrom)
}

/** Pan by a fraction of the current span (positive = right). */
export function panLocus(
  locus: Locus,
  fraction: number,
  chrom: Chromosome | undefined
): Locus {
  const span = locus.end - locus.start
  const delta = span * fraction
  return clampLocus({ chrom: locus.chrom, start: locus.start + delta, end: locus.end + delta }, chrom)
}

/** Pan by an exact number of base pairs. */
export function panLocusBp(locus: Locus, deltaBp: number, chrom: Chromosome | undefined): Locus {
  return clampLocus({ chrom: locus.chrom, start: locus.start + deltaBp, end: locus.end + deltaBp }, chrom)
}

const TICK_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
  100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000, 20000000, 50000000
]

/** Choose a "nice" tick step yielding roughly `target` ticks across the span. */
export function chooseTickStep(span: number, target = 10): number {
  const ideal = span / target
  for (const s of TICK_STEPS) if (s >= ideal) return s
  return TICK_STEPS[TICK_STEPS.length - 1]
}

export interface Tick {
  pos: number
  label: string
}

/** Evenly spaced round-number ticks within [start, end). */
export function niceTicks(start: number, end: number, target = 10): Tick[] {
  const step = chooseTickStep(end - start, target)
  const first = Math.ceil(start / step) * step
  const ticks: Tick[] = []
  for (let p = first; p < end; p += step) {
    ticks.push({ pos: p, label: formatBp(p) })
  }
  return ticks
}

/** Human-friendly base-position label: 7,668,421 or 7.67 Mb at coarse scale. */
export function formatBp(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Compact scale label for the current span, e.g. "25 kb" / "1.2 Mb". */
export function formatSpan(span: number): string {
  if (span >= 1e6) return `${(span / 1e6).toFixed(span >= 1e7 ? 0 : 2)} Mb`
  if (span >= 1e3) return `${(span / 1e3).toFixed(span >= 1e4 ? 0 : 1)} kb`
  return `${Math.round(span)} bp`
}

/** "chr17:7,660,000-7,700,000" (1-based, inclusive — UCSC display convention). */
export function formatLocus(locus: Locus): string {
  return `${locus.chrom}:${formatBp(locus.start + 1)}-${formatBp(locus.end)}`
}

/**
 * Parse a UCSC-style locus string "chr17:7,660,000-7,700,000" (1-based) or a
 * bare chromosome name. Returns a 0-based half-open Locus, or null.
 */
export function parseLocusString(input: string, chromNames: string[]): Locus | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(/^([\w.]+)\s*(?::\s*([\d,]+)\s*-\s*([\d,]+))?\s*$/)
  if (!m) return null
  const chrom = resolveChrom(m[1], chromNames)
  if (!chrom) return null
  if (m[2] && m[3]) {
    const a = parseInt(m[2].replace(/,/g, ''), 10)
    const b = parseInt(m[3].replace(/,/g, ''), 10)
    if (isNaN(a) || isNaN(b)) return null
    const start = Math.min(a, b) - 1 // 1-based inclusive -> 0-based
    const end = Math.max(a, b)
    return { chrom, start: Math.max(0, start), end }
  }
  return { chrom, start: 0, end: 0 } // caller fills full-chrom span
}

/** Match a chromosome name tolerating chr/no-chr prefixes and case. */
export function resolveChrom(name: string, chromNames: string[]): string | null {
  if (chromNames.includes(name)) return name
  const lower = name.toLowerCase()
  const stripped = lower.replace(/^chr/, '')
  for (const c of chromNames) {
    const cl = c.toLowerCase()
    if (cl === lower || cl.replace(/^chr/, '') === stripped) return c
  }
  return null
}
