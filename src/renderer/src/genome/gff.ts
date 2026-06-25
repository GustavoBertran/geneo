// GFF3 + GTF parser → transcript gene-models.
import type { Block, GStrand, Transcript } from './types'
import { normalizeChromName } from './viewport'
import { makeId } from '../core/sequence'

/** One parsed data row (9 GFF/GTF columns), coords already 0-based half-open. */
interface Row {
  chrom: string
  source: string
  type: string
  start0: number
  end0: number
  score?: number
  strand: GStrand
  phase: string
  attrRaw: string
}

/** Mutable transcript accumulator before finalization. */
interface TxAcc {
  id: string
  name?: string
  geneId?: string
  geneName?: string
  biotype?: string
  chrom?: string
  strand: GStrand
  start?: number
  end?: number
  exons: Block[]
  cds: Block[]
}

/** Gene-index entry (from 'gene'-typed rows). */
interface GeneInfo {
  name?: string
  biotype?: string
}

/** Decode the GFF3 percent-encoded characters per the spec (best-effort). */
function decodeGff3(v: string): string {
  if (v.indexOf('%') === -1) return v
  try {
    return decodeURIComponent(v)
  } catch {
    // Fall back to decoding only the well-defined reserved characters.
    return v
      .replace(/%2C/gi, ',')
      .replace(/%3B/gi, ';')
      .replace(/%3D/gi, '=')
      .replace(/%26/gi, '&')
      .replace(/%25/gi, '%')
  }
}

/** Strip an Ensembl-style 'gene:'/'transcript:'/'CDS:' prefix so IDs match. */
function stripPrefix(id: string): string {
  const i = id.indexOf(':')
  if (i === -1) return id
  const prefix = id.slice(0, i)
  if (
    prefix === 'gene' ||
    prefix === 'transcript' ||
    prefix === 'CDS' ||
    prefix === 'mRNA' ||
    prefix === 'exon'
  ) {
    return id.slice(i + 1)
  }
  return id
}

/** Parse a GFF3 attribute column ('key=value;key=value'). */
function parseGff3Attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq === -1) continue
    const key = seg.slice(0, eq).trim()
    const val = decodeGff3(seg.slice(eq + 1).trim())
    if (key) out[key] = val
  }
  return out
}

/** Parse a GTF attribute column ('key "value"; key "value";'). */
function parseGtfAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w+)\s+"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    out[m[1]] = m[2]
  }
  // Also tolerate unquoted GTF values (key value;).
  if (Object.keys(out).length === 0) {
    for (const part of raw.split(';')) {
      const seg = part.trim()
      if (!seg) continue
      const sp = seg.indexOf(' ')
      if (sp === -1) continue
      out[seg.slice(0, sp)] = seg.slice(sp + 1).replace(/^"|"$/g, '').trim()
    }
  }
  return out
}

/** Heuristic: GTF attributes use 'key "value"', GFF3 uses 'key=value'. */
function isGtfAttrs(raw: string): boolean {
  // A GFF3 line has '=' before any space-separated quoted value.
  const hasEq = /(^|;)\s*\w+=/.test(raw)
  if (hasEq) return false
  return /\w+\s+"/.test(raw)
}

function toStrand(s: string): GStrand {
  if (s === '+') return 1
  if (s === '-') return -1
  return 0
}

/** A transcript-like feature type: mRNA, transcript, *_transcript, *RNA. */
function isTranscriptType(type: string): boolean {
  const t = type.toLowerCase()
  if (t === 'mrna' || t === 'transcript') return true
  if (t.endsWith('_transcript')) return true
  // *RNA (lnc_RNA, lncRNA, miRNA, snoRNA, ncRNA, rRNA, tRNA, etc.) but not a
  // plain 'rna' fragment of an unrelated word — require the suffix 'rna'.
  if (t.endsWith('rna')) return true
  return false
}

/** A gene-like feature type: gene, *_gene (ncRNA_gene, pseudogene…). */
function isGeneType(type: string): boolean {
  const t = type.toLowerCase()
  return t === 'gene' || t.endsWith('_gene') || t === 'pseudogene'
}

/** Sort ascending by start and drop exact-duplicate blocks. */
function sortDedupe(blocks: Block[]): Block[] {
  if (blocks.length <= 1) return blocks
  blocks.sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Block[] = []
  for (const b of blocks) {
    const last = out[out.length - 1]
    if (last && last.start === b.start && last.end === b.end) continue
    out.push(b)
  }
  return out
}

/** Get or create a transcript accumulator for `id`. */
function getTx(map: Map<string, TxAcc>, id: string): TxAcc {
  let tx = map.get(id)
  if (!tx) {
    tx = { id, strand: 0, exons: [], cds: [] }
    map.set(id, tx)
  }
  return tx
}

export function parseGff(text: string): Transcript[] {
  const rows: Row[] = []

  // ---- Pass 0: tokenize lines into rows. ----
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line[0] === '#') continue
    const cols = line.split('\t')
    if (cols.length < 8) continue // need at least through phase to be meaningful
    const start = parseInt(cols[3], 10)
    const end = parseInt(cols[4], 10)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const scoreNum = parseFloat(cols[5])
    rows.push({
      chrom: normalizeChromName(cols[0]),
      source: cols[1] ?? '',
      type: cols[2] ?? '',
      start0: start - 1, // 1-based inclusive -> 0-based half-open
      end0: end,
      score: Number.isFinite(scoreNum) ? scoreNum : undefined,
      strand: toStrand(cols[6] ?? '.'),
      phase: cols[7] ?? '.',
      attrRaw: cols[8] ?? ''
    })
  }

  const genes = new Map<string, GeneInfo>()
  const txMap = new Map<string, TxAcc>()

  // ---- Pass 1: index genes and create transcripts. ----
  for (const r of rows) {
    const gtf = isGtfAttrs(r.attrRaw)
    const a = gtf ? parseGtfAttrs(r.attrRaw) : parseGff3Attrs(r.attrRaw)

    if (isGeneType(r.type)) {
      const gid = gtf ? a.gene_id : a.ID ? stripPrefix(a.ID) : undefined
      if (gid) {
        const existing = genes.get(gid)
        genes.set(gid, {
          name: a.Name ?? a.gene_name ?? a.gene ?? existing?.name,
          biotype: a.biotype ?? a.gene_biotype ?? a.gene_type ?? existing?.biotype
        })
      }
      continue
    }

    if (isTranscriptType(r.type)) {
      const tid = gtf
        ? a.transcript_id
        : a.ID
          ? stripPrefix(a.ID)
          : undefined
      if (!tid) continue
      const tx = getTx(txMap, tid)
      const geneId = gtf
        ? a.gene_id
        : a.Parent
          ? stripPrefix(a.Parent.split(',')[0])
          : undefined
      tx.name = a.Name ?? a.transcript_name ?? (gtf ? a.transcript_id : undefined) ?? tx.name
      tx.geneId = geneId ?? tx.geneId
      tx.geneName = a.gene_name ?? a.gene ?? tx.geneName
      tx.biotype =
        a.biotype ?? a.transcript_biotype ?? a.transcript_type ?? a.gene_biotype ?? tx.biotype
      tx.chrom = r.chrom
      if (r.strand !== 0) tx.strand = r.strand
      tx.start = tx.start === undefined ? r.start0 : Math.min(tx.start, r.start0)
      tx.end = tx.end === undefined ? r.end0 : Math.max(tx.end, r.end0)
    }
  }

  // ---- Pass 2: attach exon / CDS blocks (multi-parent aware). ----
  for (const r of rows) {
    const t = r.type.toLowerCase()
    const isExon = t === 'exon'
    const isCds = t === 'cds'
    if (!isExon && !isCds) continue

    const gtf = isGtfAttrs(r.attrRaw)
    const a = gtf ? parseGtfAttrs(r.attrRaw) : parseGff3Attrs(r.attrRaw)

    let parentIds: string[]
    if (gtf) {
      parentIds = a.transcript_id ? [a.transcript_id] : []
    } else if (a.Parent) {
      parentIds = a.Parent.split(',')
        .map((p) => stripPrefix(p.trim()))
        .filter((p) => p.length > 0)
    } else {
      parentIds = []
    }
    if (parentIds.length === 0) continue

    const block: Block = { start: r.start0, end: r.end0 }
    for (const pid of parentIds) {
      const tx = getTx(txMap, pid)
      // A transcript may be synthesized purely from its exon/CDS children.
      if (!tx.chrom) tx.chrom = r.chrom
      if (tx.strand === 0 && r.strand !== 0) tx.strand = r.strand
      if (isExon) tx.exons.push({ ...block })
      else tx.cds.push({ ...block })
      // For synthesized transcripts, fill gene linkage from the child if present.
      if (gtf) {
        if (!tx.geneId && a.gene_id) tx.geneId = a.gene_id
        if (!tx.geneName && (a.gene_name || a.gene)) tx.geneName = a.gene_name ?? a.gene
      }
    }
  }

  // ---- Finalize. ----
  const out: Transcript[] = []
  for (const tx of txMap.values()) {
    let exons = sortDedupe(tx.exons)
    const cds = sortDedupe(tx.cds)

    // If no exon lines but CDS present, use CDS blocks as exons.
    if (exons.length === 0 && cds.length > 0) {
      exons = cds.map((b) => ({ ...b }))
    }
    // Drop transcripts with no usable structure.
    if (exons.length === 0 && cds.length === 0) continue

    // Resolve gene name: explicit on transcript, else gene index, else undefined.
    let geneName = tx.geneName
    if (!geneName && tx.geneId) {
      const g = genes.get(tx.geneId)
      if (g?.name) geneName = g.name
    }
    let biotype = tx.biotype
    if (!biotype && tx.geneId) {
      const g = genes.get(tx.geneId)
      if (g?.biotype) biotype = g.biotype
    }

    // Derive bounds from exons if the transcript had no own start/end.
    const start =
      tx.start !== undefined ? tx.start : exons.length ? exons[0].start : 0
    const end =
      tx.end !== undefined
        ? tx.end
        : exons.length
          ? exons[exons.length - 1].end
          : start

    out.push({
      id: tx.id || makeId('tx'),
      name: tx.name ?? tx.id,
      geneId: tx.geneId,
      geneName,
      chrom: tx.chrom ?? '',
      start,
      end,
      strand: tx.strand,
      biotype,
      exons,
      cds
    })
  }

  return out
}
