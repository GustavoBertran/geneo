/**
 * Derived signal tracks computed from reference sequence — currently GC percent,
 * the classic UCSC "GC Percent" track. Real, computed, no external data needed.
 */
import type { Chromosome, SignalData } from './types'
import { gcContent } from '@core/sequence'

/**
 * GC-percent signal over fixed windows of a chromosome's bundled sequence.
 * Spans are in chromosome coordinates; values are 0..100.
 */
export function computeGcSignal(chrom: Chromosome, windowSize = 200): SignalData {
  const spans: SignalData['spans'] = []
  if (!chrom.seq || chrom.seq.bases.length === 0) {
    return { chrom: chrom.name, spans, min: 0, max: 100 }
  }
  const { start, bases } = chrom.seq
  for (let i = 0; i < bases.length; i += windowSize) {
    const win = bases.slice(i, i + windowSize)
    const value = gcContent(win) * 100
    spans.push({ start: start + i, end: start + Math.min(i + windowSize, bases.length), value })
  }
  return { chrom: chrom.name, spans, min: 0, max: 100 }
}
