/**
 * FASTA parsing and serialization.
 *
 * Pure functions, no UI imports. Reuses the shared sequence primitives
 * (`cleanSequence`, `makeId`) rather than reimplementing them.
 */
import type { SeqRecord } from './types'
import { cleanSequence, makeId } from './sequence'

/** Number of sequence characters per line when serializing. */
const WRAP_WIDTH = 70

/**
 * Parse a (possibly multi-record) FASTA string into an array of records.
 *
 * For each record:
 *   - The header is the text following '>' up to the end of line.
 *   - `name` is the first whitespace-delimited token of the header.
 *   - `description` is the remainder of the header line (trimmed), or undefined.
 *   - `sequence` is `cleanSequence` of all body lines concatenated.
 *   - `topology` is 'linear', `features` is [].
 *
 * Records with an empty header AND empty sequence are skipped. Any text before
 * the first '>' header is ignored.
 */
export function parseFastaMulti(content: string): SeqRecord[] {
  const records: SeqRecord[] = []
  // Locate the first '>' header. Any text before it is not part of a record
  // (per FASTA, '>' only ever begins a header line) and is discarded.
  const firstHeader = content.indexOf('>')
  if (firstHeader === -1) return records

  // Split into chunks at each '>'. The slice from the first '>' onward means
  // every non-empty chunk corresponds to exactly one record's header+body.
  const chunks = content.slice(firstHeader + 1).split('>')

  for (const chunk of chunks) {
    if (chunk === '') continue
    // First line is the header; everything after is sequence body.
    const newlineIdx = chunk.search(/\r?\n/)
    let header: string
    let body: string
    if (newlineIdx === -1) {
      header = chunk
      body = ''
    } else {
      header = chunk.slice(0, newlineIdx)
      body = chunk.slice(newlineIdx)
    }

    const trimmedHeader = header.trim()
    const sequence = cleanSequence(body)

    // Skip fully-empty entries (e.g. the chunk before the first header).
    if (trimmedHeader === '' && sequence === '') continue

    // name = first whitespace-delimited token; description = the remainder.
    const wsIdx = trimmedHeader.search(/\s/)
    let name: string
    let description: string
    if (wsIdx === -1) {
      name = trimmedHeader
      description = ''
    } else {
      name = trimmedHeader.slice(0, wsIdx)
      description = trimmedHeader.slice(wsIdx).trim()
    }

    const record: SeqRecord = {
      id: makeId('seq'),
      name,
      sequence,
      topology: 'linear',
      features: []
    }
    if (description !== '') record.description = description

    records.push(record)
  }

  return records
}

/**
 * Parse a FASTA string and return the first record.
 * @throws Error if the content contains no FASTA records.
 */
export function parseFasta(content: string): SeqRecord {
  const records = parseFastaMulti(content)
  if (records.length === 0) {
    throw new Error('parseFasta: no FASTA records found in content')
  }
  return records[0]
}

/**
 * Serialize a record to FASTA text:
 *   '>' name [' ' description] '\n'
 *   sequence wrapped at WRAP_WIDTH chars/line
 *   trailing '\n'
 */
export function serializeFasta(record: SeqRecord): string {
  const header = '>' + record.name + (record.description ? ' ' + record.description : '')
  let body = ''
  const seq = record.sequence
  for (let i = 0; i < seq.length; i += WRAP_WIDTH) {
    body += seq.slice(i, i + WRAP_WIDTH) + '\n'
  }
  return header + '\n' + body
}
