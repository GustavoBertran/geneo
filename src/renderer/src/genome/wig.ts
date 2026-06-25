// bedGraph + UCSC WIG (fixedStep / variableStep) parsers -> SignalData.
import type { SignalData, SignalSpan } from './types'
import { normalizeChromName } from './viewport'

/** Pick the chrom with the most spans; ties resolve to the first seen. */
function dominantChrom(spans: SignalSpan[], chromOf: (i: number) => string): string {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (let i = 0; i < spans.length; i++) {
    const c = chromOf(i)
    if (!counts.has(c)) order.push(c)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = ''
  let bestN = -1
  for (const c of order) {
    const n = counts.get(c) ?? 0
    if (n > bestN) {
      bestN = n
      best = c
    }
  }
  return best
}

function finalize(spans: SignalSpan[], chroms: string[]): SignalData {
  if (spans.length === 0) return { chrom: '', spans: [] }
  const chrom = dominantChrom(spans, (i) => chroms[i])
  spans.sort((a, b) => a.start - b.start)
  let min = Infinity
  let max = -Infinity
  for (const s of spans) {
    if (s.value < min) min = s.value
    if (s.value > max) max = s.value
  }
  return { chrom, spans, min, max }
}

/**
 * Parse bedGraph text ("chrom  start  end  value", 0-based half-open) into a
 * SignalData. Lines for other chromosomes are kept; the renderer filters by the
 * current chromosome.
 */
export function parseBedGraph(text: string): SignalData {
  const spans: SignalSpan[] = []
  const chroms: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith('track') || line.startsWith('browser')) continue
    const f = line.split(/\s+/)
    if (f.length < 4) continue
    const start = parseInt(f[1], 10)
    const end = parseInt(f[2], 10)
    const value = parseFloat(f[3])
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(value)) continue
    spans.push({ start, end, value })
    chroms.push(normalizeChromName(f[0]))
  }
  return finalize(spans, chroms)
}

interface WigDecl {
  mode: 'fixed' | 'variable'
  chrom: string
  start: number
  step: number
  span: number
}

function parseDecl(fields: string[]): WigDecl | null {
  const mode = fields[0] === 'fixedStep' ? 'fixed' : fields[0] === 'variableStep' ? 'variable' : null
  if (!mode) return null
  const kv = new Map<string, string>()
  for (let i = 1; i < fields.length; i++) {
    const eq = fields[i].indexOf('=')
    if (eq > 0) kv.set(fields[i].slice(0, eq), fields[i].slice(eq + 1))
  }
  const rawChrom = kv.get('chrom')
  if (!rawChrom) return null
  const step = kv.has('step') ? parseInt(kv.get('step')!, 10) : 1
  // For fixedStep, default span to step so contiguous bars meet (UCSC default is 1).
  const span = kv.has('span')
    ? parseInt(kv.get('span')!, 10)
    : mode === 'fixed'
      ? step
      : 1
  return {
    mode,
    chrom: normalizeChromName(rawChrom),
    start: kv.has('start') ? parseInt(kv.get('start')!, 10) : 1,
    step: Number.isFinite(step) && step > 0 ? step : 1,
    span: Number.isFinite(span) && span > 0 ? span : 1
  }
}

/**
 * Parse UCSC WIG (fixedStep / variableStep) into SignalData. WIG positions are
 * 1-based; converted here to 0-based half-open spans. Returns an empty track if
 * no declaration line is recognized.
 */
export function parseWig(text: string): SignalData {
  const spans: SignalSpan[] = []
  const chroms: string[] = []
  let decl: WigDecl | null = null
  let fixedPos = 0 // 0-based next position for fixedStep

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith('track') || line.startsWith('browser')) continue

    if (line.startsWith('fixedStep') || line.startsWith('variableStep')) {
      decl = parseDecl(line.split(/\s+/))
      if (decl && decl.mode === 'fixed') fixedPos = decl.start - 1 // 1-based -> 0-based
      continue
    }
    if (!decl) continue

    const f = line.split(/\s+/)
    if (decl.mode === 'fixed') {
      const value = parseFloat(f[0])
      if (Number.isFinite(value)) {
        spans.push({ start: fixedPos, end: fixedPos + decl.span, value })
        chroms.push(decl.chrom)
      }
      fixedPos += decl.step
    } else {
      if (f.length < 2) continue
      const pos = parseInt(f[0], 10)
      const value = parseFloat(f[1])
      if (!Number.isFinite(pos) || !Number.isFinite(value)) continue
      const start = pos - 1 // 1-based -> 0-based
      spans.push({ start, end: start + decl.span, value })
      chroms.push(decl.chrom)
    }
  }
  return finalize(spans, chroms)
}
