// On-demand genome fetching from the Ensembl REST API (https://rest.ensembl.org).
// The renderer's CSP allows connect-src https://rest.ensembl.org; we use the
// global fetch() (no node imports). Everything is caught — fetchEnsemblAssembly
// never throws, it returns { assembly } or { error }.
import type { Chromosome, GenomeAssembly, Locus, Track } from './types'
import { parseGff } from './gff'
import { parseFastaRegion } from './io'
import { computeGcSignal } from './signal'
import { normalizeChromName } from './viewport'

/** A selectable Ensembl species + its reference assembly name. */
export interface EnsemblSpecies {
  id: string // Ensembl species id, e.g. 'homo_sapiens'
  label: string // human-readable, e.g. 'Human (GRCh38)'
  assembly: string // e.g. 'GRCh38'
}

export const ENSEMBL_SPECIES: EnsemblSpecies[] = [
  { id: 'homo_sapiens', label: 'Human (GRCh38)', assembly: 'GRCh38' },
  { id: 'mus_musculus', label: 'Mouse (GRCm39)', assembly: 'GRCm39' },
  { id: 'danio_rerio', label: 'Zebrafish (GRCz11)', assembly: 'GRCz11' },
  { id: 'drosophila_melanogaster', label: 'Fruit fly (BDGP6)', assembly: 'BDGP6' },
  { id: 'saccharomyces_cerevisiae', label: 'Yeast (R64)', assembly: 'R64-1-1' }
]

export interface EnsemblResult {
  assembly?: GenomeAssembly
  error?: string
}

const ENSEMBL_BASE = 'https://rest.ensembl.org'
const MAX_REGION_BP = 5_000_000

/** Resolved 1-based inclusive region (what the Ensembl REST API expects). */
interface Region {
  /** Chromosome name for the API (no 'chr', no commas), e.g. '16'. */
  apiChrom: string
  /** Normalized chromosome name for the assembly, e.g. 'chr16'. */
  chrom: string
  start1: number // 1-based inclusive
  end1: number // 1-based inclusive
  /** Gene symbol, when the query was resolved from one. */
  geneSymbol?: string
}

/** Look up the assembly label for a species id, falling back to the id. */
function assemblyLabel(speciesId: string): string {
  const sp = ENSEMBL_SPECIES.find((s) => s.id === speciesId)
  return sp ? sp.assembly : speciesId
}

/** Chromosome name as the Ensembl API expects it: no 'chr', mitochondrion = MT. */
function toApiChrom(name: string): string {
  const s = name.replace(/^chr/i, '')
  return /^m$/i.test(s) ? 'MT' : s
}

/**
 * Parse a locus string into a 1-based inclusive region. Accepts:
 *   "chr16:23,641,000-23,641,800", "16:23641000-23641800",
 *   "chr16:23641000..23641800". Returns null if it is not a locus (then the
 *   caller treats the input as a gene symbol).
 */
function parseLocus(query: string): Region | null {
  // [\w.] so dotted scaffold/contig names (GL000220.1, KI270728.1) parse as loci.
  const m = query.trim().match(/^([\w.]+):\s*([\d,]+)\s*(?:-|\.\.)\s*([\d,]+)\s*$/)
  if (!m) return null
  const a = parseInt(m[2].replace(/,/g, ''), 10)
  const b = parseInt(m[3].replace(/,/g, ''), 10)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const apiChrom = toApiChrom(m[1])
  if (!apiChrom) return null
  return {
    apiChrom,
    chrom: normalizeChromName(m[1]),
    start1: Math.min(a, b),
    end1: Math.max(a, b)
  }
}

/** Read an Ensembl error body and return a short, friendly message. */
async function ensemblErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.text()
    try {
      const json = JSON.parse(body)
      if (json && typeof json.error === 'string' && json.error.trim()) {
        return json.error.trim()
      }
    } catch {
      // not JSON — fall through
    }
    if (body && body.length < 200) return body.trim() || fallback
  } catch {
    // ignore
  }
  return fallback
}

/**
 * Resolve a gene symbol via /lookup/symbol into a padded 1-based region.
 * Returns { error } if the symbol is unknown (404) or the request fails.
 */
async function resolveSymbol(
  speciesId: string,
  symbol: string
): Promise<{ region?: Region; error?: string }> {
  const url = `${ENSEMBL_BASE}/lookup/symbol/${encodeURIComponent(speciesId)}/${encodeURIComponent(
    symbol
  )}?content-type=application/json`
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 404) return { error: `Gene "${symbol}" not found in ${speciesId}` }
    return { error: await ensemblErrorMessage(res, `Could not look up gene "${symbol}".`) }
  }
  const data = (await res.json()) as {
    seq_region_name?: string
    start?: number
    end?: number
  }
  const name = data.seq_region_name
  const start = data.start
  const end = data.end
  if (!name || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { error: `Gene "${symbol}" not found in ${speciesId}` }
  }
  const s = start as number
  const e = end as number
  const span = Math.max(0, e - s)
  const pad = Math.max(2000, Math.round(span * 0.1))
  const start1 = Math.max(1, s - pad)
  const end1 = e + pad
  return {
    region: {
      apiChrom: toApiChrom(name),
      chrom: normalizeChromName(name),
      start1,
      end1,
      geneSymbol: symbol
    }
  }
}

/**
 * Fetch a region's gene models + reference sequence from the Ensembl REST API
 * and assemble a GenomeAssembly ready for the browser. `query` may be a locus
 * ("chr16:23,641,000-23,641,800" or "16:23641000-23641800") or a gene symbol
 * ("BRCA1"), which is resolved via Ensembl /lookup/symbol.
 */
export async function fetchEnsemblAssembly(speciesId: string, query: string): Promise<EnsemblResult> {
  const q = query.trim()
  if (!q) return { error: 'Enter a locus (chr16:23,641,000-23,641,800) or a gene symbol.' }

  try {
    // ---- Resolve the region (locus form or gene symbol). ----
    let region = parseLocus(q)
    if (!region) {
      const resolved = await resolveSymbol(speciesId, q)
      if (resolved.error || !resolved.region) {
        return { error: resolved.error ?? `Gene "${q}" not found in ${speciesId}` }
      }
      region = resolved.region
    }

    const { apiChrom, chrom, start1, end1, geneSymbol } = region

    // ---- Validate. ----
    if (!apiChrom) return { error: 'Invalid region — missing chromosome.' }
    if (!(start1 < end1)) return { error: 'Invalid region — start must be before end.' }
    if (end1 - start1 + 1 > MAX_REGION_BP) {
      return { error: 'Region too large for fetch (max 5 Mb) — zoom in.' }
    }

    const span = `${apiChrom}:${start1}-${end1}`
    const gffUrl =
      `${ENSEMBL_BASE}/overlap/region/${encodeURIComponent(speciesId)}/${span}` +
      `?feature=gene;feature=transcript;feature=exon;feature=cds;content-type=text/x-gff3`
    const seqUrl =
      `${ENSEMBL_BASE}/sequence/region/${encodeURIComponent(speciesId)}/${span}` +
      `?content-type=text/x-fasta`

    // ---- Fetch annotations + sequence in parallel. ----
    const [gffRes, seqRes] = await Promise.all([fetch(gffUrl), fetch(seqUrl)])

    if (!gffRes.ok) {
      return { error: await ensemblErrorMessage(gffRes, 'Ensembl could not return annotations for this region.') }
    }
    if (!seqRes.ok) {
      return { error: await ensemblErrorMessage(seqRes, 'Ensembl could not return sequence for this region.') }
    }

    const [gffText, seqText] = await Promise.all([gffRes.text(), seqRes.text()])

    // ---- Parse annotations -> genes track. ----
    const transcripts = parseGff(gffText).filter((t) => normalizeChromName(t.chrom) === chrom)
    const genesTrack: Track = {
      id: 'trk_gencode',
      name: 'GENCODE genes',
      kind: 'genes',
      visible: true,
      transcripts
    }

    // ---- Parse sequence -> chromosome.seq (its start is already 0-based). ----
    const fasta = parseFastaRegion(seqText)
    const chromosome: Chromosome = {
      name: chrom,
      length: end1, // bound navigation to the fetched window
      seq: fasta ? { start: fasta.start, bases: fasta.bases } : undefined
    }

    // ---- GC track (reads chromosome.seq, so build it after seq is set). ----
    const gcTrack: Track = {
      id: 'trk_gc',
      name: 'GC Percent',
      kind: 'signal',
      visible: true,
      color: '#5fb88f',
      signal: computeGcSignal(chromosome, 200)
    }

    const defaultLocus: Locus = { chrom, start: start1 - 1, end: end1 }
    const label = assemblyLabel(speciesId)
    const assembly: GenomeAssembly = {
      id: `ensembl_${speciesId}_${chrom}_${start1}`,
      name: `${geneSymbol ?? chrom} · ${label}`,
      chromosomes: [chromosome],
      tracks: [genesTrack, gcTrack],
      defaultLocus
    }
    return { assembly }
  } catch {
    return { error: 'Network error contacting Ensembl — check your connection.' }
  }
}
