/**
 * Genome file loading: detect the format of an opened file and turn it into
 * track(s) and/or reference sequence to merge into the current assembly.
 */
import type { Track } from './types'
import { makeId } from '@core/sequence'
import { parseGff } from './gff'
import { parseBed } from './bed'
import { parseBedGraph, parseWig } from './wig'
import { normalizeChromName } from './viewport'

export type GenomeFormat = 'gff' | 'bed' | 'bedgraph' | 'wig' | 'fasta' | 'unknown'

export function detectGenomeFormat(filename: string, text: string): GenomeFormat {
  const f = filename.toLowerCase()
  if (/\.(gff3?|gtf)$/.test(f)) return 'gff'
  if (/\.bedgraph$|\.bg$/.test(f)) return 'bedgraph'
  if (/\.wig$/.test(f)) return 'wig'
  if (/\.bed$/.test(f)) return 'bed'
  if (/\.(fa|fasta|fna)$/.test(f)) return 'fasta'
  const head = text.slice(0, 4000)
  if (/^##gff-version/m.test(head)) return 'gff'
  if (/^track type=bedGraph/m.test(head) || /^browser /m.test(head)) return 'bedgraph'
  if (/^(fixedStep|variableStep)/m.test(head)) return 'wig'
  if (head.trimStart().startsWith('>')) return 'fasta'
  if (/^\S+\t\d+\t\d+/m.test(head)) return 'bed'
  return 'unknown'
}

export interface LoadedGenome {
  tracks: Track[]
  sequence?: { chrom: string; start: number; bases: string }
  format: GenomeFormat
  /** Suggested locus to jump to (e.g. the extent of loaded gene models). */
  suggestChrom?: string
}

/** Parse an opened genome file into mergeable tracks / sequence. */
export function loadGenomeFile(filename: string, text: string): LoadedGenome {
  const format = detectGenomeFormat(filename, text)
  const baseName = filename.replace(/\.[^.]+$/, '').split(/[/\\]/).pop() || 'track'

  if (format === 'gff') {
    const transcripts = parseGff(text)
    const track: Track = {
      id: makeId('trk'),
      name: baseName,
      kind: 'genes',
      visible: true,
      transcripts
    }
    return { tracks: [track], format, suggestChrom: transcripts[0]?.chrom }
  }

  if (format === 'bed') {
    const features = parseBed(text)
    const track: Track = { id: makeId('trk'), name: baseName, kind: 'features', visible: true, features }
    return { tracks: [track], format, suggestChrom: features[0]?.chrom }
  }

  if (format === 'bedgraph' || format === 'wig') {
    const signal = format === 'bedgraph' ? parseBedGraph(text) : parseWig(text)
    const track: Track = { id: makeId('trk'), name: baseName, kind: 'signal', visible: true, signal }
    return { tracks: [track], format, suggestChrom: signal.chrom || undefined }
  }

  if (format === 'fasta') {
    const seq = parseFastaRegion(text)
    return { tracks: [], sequence: seq ?? undefined, format, suggestChrom: seq?.chrom }
  }

  return { tracks: [], format }
}

/**
 * Parse a single-record FASTA into chromosome + window-start. Understands the
 * Ensembl region header ">chromosome:GRCh38:17:7660000:7700000:1" (1-based) and
 * falls back to the first header token at start 0.
 */
export function parseFastaRegion(text: string): { chrom: string; start: number; bases: string } | null {
  const nl = text.indexOf('\n')
  if (nl < 0 || !text.trimStart().startsWith('>')) return null
  const header = text.slice(text.indexOf('>') + 1, nl).trim()
  const bases = text.slice(nl + 1).replace(/[^A-Za-z]/g, '').toUpperCase()
  if (!bases) return null

  // Ensembl region header: chromosome:ASM:NAME:START:END:STRAND
  const ens = header.match(/^chromosome:[^:]+:([\w.]+):(\d+):(\d+):/i)
  if (ens) {
    return { chrom: normalizeChromName(ens[1]), start: Math.max(0, parseInt(ens[2], 10) - 1), bases }
  }
  const name = normalizeChromName(header.split(/\s+/)[0] || 'chr1')
  return { chrom: name, start: 0, bases }
}
