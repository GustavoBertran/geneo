import type { GenomeFeature, GStrand, Block } from './types'
import { normalizeChromName } from './viewport'
import { makeId } from '../core/sequence'

/**
 * Parse BED (3..12 columns) into interval features. BED is 0-based half-open
 * already. BED12 block fields populate `blocks`; thickStart/thickEnd populate
 * the thick range; itemRgb populates `color`.
 */
export function parseBed(text: string): GenomeFeature[] {
  const out: GenomeFeature[] = []
  const lines = text.split(/\r?\n/)

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#') || line.startsWith('track') || line.startsWith('browser')) continue

    // BED is whitespace-delimited (tabs or spaces).
    const cols = line.split(/\s+/)
    if (cols.length < 3) continue

    const chrom = normalizeChromName(cols[0])
    const start = parseInt(cols[1], 10)
    const end = parseInt(cols[2], 10)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue

    const feature: GenomeFeature = {
      id: '',
      chrom,
      start,
      end,
      strand: 0
    }

    // col 4: name
    const name = cols.length >= 4 && cols[3] !== '.' ? cols[3] : undefined
    if (name !== undefined) feature.name = name

    // col 5: score
    if (cols.length >= 5 && cols[4] !== '.') {
      const score = parseFloat(cols[4])
      if (Number.isFinite(score)) feature.score = score
    }

    // col 6: strand
    feature.strand = parseStrand(cols.length >= 6 ? cols[5] : undefined)

    // col 7/8: thickStart / thickEnd
    if (cols.length >= 8) {
      const thickStart = parseInt(cols[6], 10)
      const thickEnd = parseInt(cols[7], 10)
      if (Number.isFinite(thickStart) && Number.isFinite(thickEnd)) {
        feature.thickStart = thickStart
        feature.thickEnd = thickEnd
      }
    }

    // col 9: itemRgb -> '#rrggbb'
    if (cols.length >= 9) {
      const color = parseRgb(cols[8])
      if (color !== undefined) feature.color = color
    }

    // col 10/11/12: blockCount / blockSizes / blockStarts
    if (cols.length >= 12) {
      const blocks = parseBlocks(start, cols[10], cols[11])
      if (blocks.length > 0) feature.blocks = blocks
    }

    feature.id = name ?? makeId('bed')
    out.push(feature)
  }

  return out
}

function parseStrand(s: string | undefined): GStrand {
  if (s === '+') return 1
  if (s === '-') return -1
  return 0
}

/** Parse "r,g,b" (0..255) into '#rrggbb'. Returns undefined on '0'/'.'/invalid. */
function parseRgb(s: string): string | undefined {
  if (s === '' || s === '.' || s === '0') return undefined
  const parts = s.split(',')
  if (parts.length !== 3) return undefined
  const rgb: number[] = []
  for (const p of parts) {
    const n = parseInt(p, 10)
    if (!Number.isFinite(n) || n < 0 || n > 255) return undefined
    rgb.push(n)
  }
  return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('')
}

/** Build absolute blocks from comma-separated sizes and chromStart-relative starts. */
function parseBlocks(chromStart: number, sizesRaw: string, startsRaw: string): Block[] {
  const sizes = parseIntList(sizesRaw)
  const starts = parseIntList(startsRaw)
  const blocks: Block[] = []
  const n = Math.min(sizes.length, starts.length)
  for (let i = 0; i < n; i++) {
    const bStart = chromStart + starts[i]
    blocks.push({ start: bStart, end: bStart + sizes[i] })
  }
  return blocks
}

/** Parse a comma-separated int list, ignoring trailing comma / blank entries. */
function parseIntList(s: string): number[] {
  const out: number[] = []
  for (const part of s.split(',')) {
    if (part.trim() === '') continue
    const n = parseInt(part, 10)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}
