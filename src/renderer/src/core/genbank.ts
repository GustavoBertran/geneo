/**
 * GenBank flat-file parser and serializer.
 *
 * Coordinate convention (see types.ts): 0-based, half-open [start, end).
 * GenBank files are 1-based inclusive; conversion happens here:
 *   start0 = gbStart - 1, end0 = gbEnd.
 * For circular molecules an origin-spanning feature is represented with
 * start > end and covers [start, length) ++ [0, end).
 */
import type { Feature, SeqRecord, Strand, Topology } from './types'
import { cleanSequence, makeId } from './sequence'
import { defaultColorForType } from './featureStyle'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Strip GenBank partial markers and surrounding whitespace from a number token. */
function parseGbInt(tok: string): number {
  const m = tok.replace(/[<>]/g, '').match(/-?\d+/)
  return m ? parseInt(m[0], 10) : NaN
}

interface ParsedLocation {
  start: number // 0-based inclusive
  end: number // 0-based exclusive (may be <= start for circular wrap)
  strand: Strand
}

/**
 * Parse a GenBank location string into a single span. Supports:
 *   start..end, complement(...), join(a..b,c..d), single positions, < / >.
 * For join(...) we take the span from the first segment's start to the last
 * segment's end; if the first start > last end we treat it as a circular wrap.
 */
function parseLocation(rawIn: string): ParsedLocation | null {
  let raw = rawIn.trim()
  let strand: Strand = 1

  // Peel off complement(...) — may wrap a join(...).
  // Repeatedly strip leading complement()/join() operators.
  // complement flips strand; join is handled by extracting all ranges below.
  // Use a loop in case of complement(join(...)).
  let changed = true
  while (changed) {
    changed = false
    const cm = raw.match(/^complement\((.*)\)$/s)
    if (cm) {
      strand = strand === 1 ? -1 : 1
      raw = cm[1].trim()
      changed = true
      continue
    }
    const jm = raw.match(/^join\((.*)\)$/s)
    if (jm) {
      raw = jm[1].trim()
      changed = true
      // don't continue stripping complement after join in this simple model;
      // but allow further complement on the whole join only (already handled)
      break
    }
  }

  // Now `raw` is either a single span "a..b" / "a" or a comma list of spans.
  // Split top-level by commas (segments may themselves carry complement()).
  const segments = splitTopLevel(raw)
  if (segments.length === 0) return null

  // Determine first segment start and last segment end.
  const firstSeg = parseSingleSegment(segments[0])
  const lastSeg = parseSingleSegment(segments[segments.length - 1])
  if (!firstSeg || !lastSeg) return null

  // Per-segment complement could override strand for mixed joins; if any
  // segment is complemented and the outer wasn't, reflect that minimally.
  if (firstSeg.complemented && strand === 1) strand = -1

  const gbStart = firstSeg.start
  const gbEnd = lastSeg.end
  const start0 = gbStart - 1
  const end0 = gbEnd // 1-based inclusive end -> 0-based exclusive

  return { start: start0, end: end0, strand }
}

/** Split a location body on top-level commas (ignoring commas inside parens). */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

interface SingleSegment {
  start: number // 1-based gb start
  end: number // 1-based gb end (inclusive)
  complemented: boolean
}

function parseSingleSegment(segIn: string): SingleSegment | null {
  let seg = segIn.trim()
  let complemented = false
  const cm = seg.match(/^complement\((.*)\)$/s)
  if (cm) {
    complemented = true
    seg = cm[1].trim()
  }
  // single base "467" or range "1..456" (also handles "1^2" -> treat as point)
  const rangeMatch = seg.match(/(-?[<>]?\d+)\s*(?:\.\.|\^)\s*(-?[>]?\d+)/)
  if (rangeMatch) {
    const a = parseGbInt(rangeMatch[1])
    const b = parseGbInt(rangeMatch[2])
    if (isNaN(a) || isNaN(b)) return null
    return { start: a, end: b, complemented }
  }
  const single = parseGbInt(seg)
  if (isNaN(single)) return null
  return { start: single, end: single, complemented }
}

interface RawFeature {
  type: string
  location: string
  qualifiers: Record<string, string>
}

/** Pull the LOCUS name, length and topology from the LOCUS line. */
function parseLocusLine(line: string): { name: string; topology: Topology } {
  const tokens = line.trim().split(/\s+/)
  // tokens[0] === 'LOCUS', tokens[1] === name
  const name = tokens[1] ?? ''
  const topology: Topology = /\bcircular\b/i.test(line) ? 'circular' : 'linear'
  return { name, topology }
}

export function parseGenBank(content: string): SeqRecord {
  const lines = content.split(/\r\n|\r|\n/)

  let name = ''
  let topology: Topology = 'linear'
  const definitionParts: string[] = []
  const rawFeatures: RawFeature[] = []
  let sequence = ''

  type Section = 'header' | 'features' | 'origin' | 'done'
  let section: Section = 'header'
  let inDefinition = false

  // Current feature being assembled in the FEATURES table.
  let cur: RawFeature | null = null
  // Current qualifier key whose value may continue across lines.
  let curQualKey: string | null = null
  let curQualOpenQuote = false

  const flushFeature = (): void => {
    if (cur) {
      rawFeatures.push(cur)
      cur = null
    }
    curQualKey = null
    curQualOpenQuote = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('//')) {
      flushFeature()
      section = 'done'
      break
    }

    if (section === 'origin') {
      // Sequence lines: strip leading position number and spaces/digits.
      sequence += line.replace(/[^A-Za-z]/g, '')
      continue
    }

    // Top-level keywords begin in column 0.
    const isTopLevel = line.length > 0 && /^[A-Z]/.test(line[0])

    if (section === 'features') {
      if (line.startsWith('ORIGIN')) {
        flushFeature()
        section = 'origin'
        continue
      }
      if (isTopLevel) {
        // A new top-level keyword ends the FEATURES table.
        flushFeature()
        section = 'header'
        // fall through to header handling below
      } else {
        handleFeatureLine(line)
        continue
      }
    }

    if (section === 'header') {
      if (line.startsWith('LOCUS')) {
        const parsed = parseLocusLine(line)
        name = parsed.name
        topology = parsed.topology
        inDefinition = false
        continue
      }
      if (line.startsWith('DEFINITION')) {
        definitionParts.push(line.slice('DEFINITION'.length).trim())
        inDefinition = true
        continue
      }
      if (line.startsWith('FEATURES')) {
        inDefinition = false
        section = 'features'
        continue
      }
      if (line.startsWith('ORIGIN')) {
        inDefinition = false
        section = 'origin'
        continue
      }
      if (inDefinition && !isTopLevel && line.trim().length > 0) {
        // continuation of DEFINITION
        definitionParts.push(line.trim())
        continue
      }
      if (isTopLevel) {
        inDefinition = false
      }
      continue
    }
  }

  // --- inner helper for FEATURES lines (closure over cur/curQual*) ---------
  function handleFeatureLine(line: string): void {
    // Feature key lives at columns ~6-20; qualifier lines start with /.
    const trimmed = line.trim()
    if (trimmed.length === 0) return

    // A feature key line: indentation (~5 spaces) then key then location.
    // Detect: starts with whitespace, then a non-'/' token.
    const keyMatch = line.match(/^\s{1,8}(\S+)\s+(\S.*)$/)
    const isQualifier = trimmed.startsWith('/')

    if (!isQualifier && keyMatch && !curQualOpenQuote) {
      // New feature.
      flushFeature()
      cur = {
        type: keyMatch[1],
        location: keyMatch[2].trim(),
        qualifiers: {}
      }
      curQualKey = null
      return
    }

    if (!cur) return

    if (isQualifier && !curQualOpenQuote) {
      // /key="value" or /key=value or /key
      const q = trimmed.slice(1) // drop leading '/'
      const eq = q.indexOf('=')
      if (eq === -1) {
        // valueless qualifier
        cur.qualifiers[q] = cur.qualifiers[q] ?? ''
        curQualKey = null
        return
      }
      const key = q.slice(0, eq).trim()
      let val = q.slice(eq + 1).trim()
      if (val.startsWith('"')) {
        val = val.slice(1)
        if (val.endsWith('"') && !val.endsWith('\\"')) {
          val = val.slice(0, -1)
          appendQualifier(key, val, false)
          curQualKey = null
          curQualOpenQuote = false
        } else {
          // open quote, continues on next lines
          appendQualifier(key, val, false)
          curQualKey = key
          curQualOpenQuote = true
        }
      } else {
        appendQualifier(key, val, false)
        curQualKey = null
      }
      return
    }

    if (curQualOpenQuote && curQualKey) {
      // Continuation of a quoted value.
      let val = trimmed
      let closing = false
      if (val.endsWith('"')) {
        val = val.slice(0, -1)
        closing = true
      }
      // translation values are joined with no spaces; others with a space.
      const joinSpace = curQualKey !== 'translation'
      appendContinuation(curQualKey, val, joinSpace)
      if (closing) {
        curQualOpenQuote = false
        curQualKey = null
      }
      return
    }
  }

  function appendQualifier(key: string, val: string, _cont: boolean): void {
    if (!cur) return
    if (key in cur.qualifiers && cur.qualifiers[key] !== '') {
      // duplicate qualifier key (e.g. multiple /note) — keep first, append.
      cur.qualifiers[key] += '; ' + val
    } else {
      cur.qualifiers[key] = val
    }
  }

  function appendContinuation(key: string, val: string, joinSpace: boolean): void {
    if (!cur) return
    const existing = cur.qualifiers[key] ?? ''
    if (existing === '') cur.qualifiers[key] = val
    else cur.qualifiers[key] = existing + (joinSpace ? ' ' : '') + val
  }

  // --- build normalized features ------------------------------------------
  const features: Feature[] = []
  for (const rf of rawFeatures) {
    const loc = parseLocation(rf.location)
    if (!loc) continue
    const q = rf.qualifiers
    const translation = q.translation ? q.translation.replace(/\s+/g, '') : undefined

    const nm =
      q.label ?? q.gene ?? q.product ?? q.note ?? rf.type

    // Strip translation out of the stored qualifiers (kept on feature.translation),
    // but keep everything else verbatim.
    const qualifiers: Record<string, string> = {}
    for (const k of Object.keys(q)) {
      if (k === 'translation') continue
      qualifiers[k] = q[k]
    }

    // Color: explicit ApE forward color wins, else default-by-type.
    const apeColor = q.ApEinfo_fwdcolor
    const color = apeColor && /^#?[0-9a-fA-F]{6}$/.test(apeColor)
      ? (apeColor.startsWith('#') ? apeColor : '#' + apeColor)
      : defaultColorForType(rf.type)

    const feature: Feature = {
      id: makeId('feat'),
      name: nm,
      type: rf.type,
      start: loc.start,
      end: loc.end,
      strand: loc.strand,
      color
    }
    if (translation) feature.translation = translation
    if (Object.keys(qualifiers).length > 0) feature.qualifiers = qualifiers
    features.push(feature)
  }

  const cleanSeq = cleanSequence(sequence)

  return {
    id: makeId('rec'),
    name: name || 'Unnamed',
    description: definitionParts.join(' ').trim() || undefined,
    sequence: cleanSeq,
    topology,
    features
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const FIXED_DATE = '01-JAN-2024'
const COL_QUALIFIER = 21 // 0-based column index -> 21 spaces then content (col 22)

/** Format a GenBank location string for a feature (1-based inclusive). */
function formatLocation(feature: Feature, length: number): string {
  const { start, end, strand } = feature
  const wraps = end < start // circular origin-spanning feature

  let loc: string
  if (wraps) {
    // [start, length) ++ [0, end) -> join(start+1..len, 1..end)
    loc = `join(${start + 1}..${length},1..${end})`
  } else {
    const gbStart = start + 1
    const gbEnd = end
    loc = gbStart === gbEnd ? `${gbStart}` : `${gbStart}..${gbEnd}`
  }
  if (strand === -1) loc = `complement(${loc})`
  return loc
}

/** Whether a qualifier value should be emitted unquoted (numeric-ish flags). */
function needsQuotes(_key: string, _value: string): boolean {
  // We always quote for safety/round-trip simplicity.
  return true
}

/** Emit a single /key="value" qualifier, wrapped to 79 columns at col 22. */
function emitQualifier(key: string, value: string): string[] {
  const indent = ' '.repeat(COL_QUALIFIER)
  const quoted = needsQuotes(key, value)
  const full = quoted
    ? `/${key}="${value.replace(/"/g, '""')}"`
    : `/${key}=${value}`
  // Wrap at 79 columns.
  const maxLen = 79
  const avail = maxLen - COL_QUALIFIER
  if (full.length <= avail) {
    return [indent + full]
  }
  const out: string[] = []
  let rest = full
  while (rest.length > avail) {
    // break at last space within window if possible
    let cut = avail
    const slice = rest.slice(0, avail + 1)
    const lastSpace = slice.lastIndexOf(' ')
    if (lastSpace > 0) cut = lastSpace
    out.push(indent + rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest.length > 0) out.push(indent + rest)
  return out
}

function emitFeature(feature: Feature, length: number): string[] {
  const lines: string[] = []
  const key = feature.type
  // key at column 6 (5 leading spaces), location at column 22.
  const keyPart = '     ' + key
  const padded =
    keyPart.length >= COL_QUALIFIER
      ? keyPart + ' '
      : keyPart + ' '.repeat(COL_QUALIFIER - keyPart.length)
  lines.push(padded + formatLocation(feature, length))

  // Always emit /label first so feature.name round-trips (parse picks /label first).
  lines.push(...emitQualifier('label', feature.name))

  // Then remaining qualifiers (skip a duplicate 'label').
  if (feature.qualifiers) {
    for (const k of Object.keys(feature.qualifiers)) {
      if (k === 'label') continue
      lines.push(...emitQualifier(k, feature.qualifiers[k]))
    }
  }
  if (feature.translation) {
    lines.push(...emitQualifier('translation', feature.translation))
  }
  return lines
}

/** Format the ORIGIN block: 60 bases/line in 10-base blocks, 1-based numbering. */
function formatOrigin(seq: string): string[] {
  const lines: string[] = ['ORIGIN']
  for (let i = 0; i < seq.length; i += 60) {
    const chunk = seq.slice(i, i + 60).toLowerCase()
    const blocks: string[] = []
    for (let j = 0; j < chunk.length; j += 10) {
      blocks.push(chunk.slice(j, j + 10))
    }
    const posStr = (i + 1).toString().padStart(9, ' ')
    lines.push(posStr + ' ' + blocks.join(' '))
  }
  if (seq.length === 0) {
    // still emit a single header line; ORIGIN already pushed.
  }
  return lines
}

export function serializeGenBank(record: SeqRecord): string {
  const seq = cleanSequence(record.sequence)
  const len = seq.length
  const topoWord = record.topology === 'circular' ? 'circular' : 'linear'

  const out: string[] = []

  // LOCUS line. Format roughly:
  // LOCUS       name        <len> bp    DNA     circular     01-JAN-2024
  const locusName = (record.name || 'Unnamed').replace(/\s+/g, '_')
  const locusLine =
    'LOCUS       ' +
    locusName.padEnd(16, ' ') +
    ' ' +
    String(len).padStart(7, ' ') +
    ' bp    DNA     ' +
    topoWord.padEnd(8, ' ') +
    ' UNA ' +
    FIXED_DATE
  out.push(locusLine)

  // DEFINITION
  const def = (record.description ?? '').trim() || '.'
  out.push('DEFINITION  ' + def)
  out.push('ACCESSION   .')
  out.push('KEYWORDS    .')

  // FEATURES
  out.push('FEATURES             Location/Qualifiers')
  for (const f of record.features) {
    out.push(...emitFeature(f, len))
  }

  // ORIGIN
  out.push(...formatOrigin(seq))
  out.push('//')

  return out.join('\n') + '\n'
}
