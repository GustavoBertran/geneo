// STUB — full implementation provided by the build workflow.
import type { SeqRecord } from './types'
import { parseGenBank } from './genbank'
import { parseFasta } from './fasta'

export type SeqFormat = 'genbank' | 'fasta' | 'plain'

export function detectFormat(_filename: string, content: string): SeqFormat {
  const head = content.trimStart()
  if (head.startsWith('>')) return 'fasta'
  if (/^LOCUS\s/m.test(head)) return 'genbank'
  return 'plain'
}

/** Parse an opened file into a record, dispatching on detected format. */
export function parseSequenceFile(filename: string, content: string): SeqRecord {
  const fmt = detectFormat(filename, content)
  if (fmt === 'genbank') return parseGenBank(content)
  if (fmt === 'fasta') return parseFasta(content)
  throw new Error('Unrecognized sequence format')
}
