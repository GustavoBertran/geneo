/**
 * Annotation tracks computed locally from a chromosome's reference sequence
 * (no network). Currently CpG islands by the Gardiner-Garden & Frommer (1987)
 * criteria: GC content >= 50% and observed/expected CpG ratio >= 0.6 over a
 * 200 bp window, merged into islands of length >= 200 bp.
 */
import type { Chromosome, GenomeFeature } from './types'
import { makeId } from '../core/sequence'

export function computeCpgIslands(chrom: Chromosome): GenomeFeature[] {
  const out: GenomeFeature[] = []
  if (!chrom.seq || chrom.seq.bases.length < 200) return out
  const { start, bases } = chrom.seq
  const W = 200
  const STEP = 20

  let runStart = -1
  let runEnd = -1
  const flush = (): void => {
    if (runStart >= 0 && runEnd - runStart >= 200) {
      out.push({
        id: makeId('cpg'),
        name: 'CpG island',
        chrom: chrom.name,
        start: runStart,
        end: runEnd,
        strand: 0,
        type: 'cpg',
        color: '#59b85f'
      })
    }
    runStart = -1
    runEnd = -1
  }

  for (let i = 0; i + W <= bases.length; i += STEP) {
    let c = 0
    let g = 0
    let cg = 0
    for (let j = 0; j < W; j++) {
      const ch = bases[i + j]
      if (ch === 'C') {
        c++
        if (bases[i + j + 1] === 'G') cg++
      } else if (ch === 'G') {
        g++
      }
    }
    const gc = (c + g) / W
    const expected = (c * g) / W
    const ratio = expected > 0 ? cg / expected : 0
    const isIsland = gc >= 0.5 && ratio >= 0.6
    if (isIsland) {
      if (runStart < 0) runStart = start + i
      runEnd = start + i + W
    } else {
      flush()
    }
  }
  flush()
  return out
}
