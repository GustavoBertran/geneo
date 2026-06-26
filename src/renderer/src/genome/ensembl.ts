// On-demand genome fetching from the Ensembl REST API (https://rest.ensembl.org).
// The renderer's CSP allows connect-src https://rest.ensembl.org; we use the
// global fetch() (no node imports). Everything is caught — fetchEnsemblAssembly
// never throws, it returns { assembly } or { error }.
import type { Chromosome, GenomeAssembly, GenomeFeature, Locus, Track } from './types'
import { parseGff } from './gff'
import { parseFastaRegion } from './io'
import { computeGcSignal } from './signal'
import { normalizeChromName } from './viewport'
import { makeId } from '../core/sequence'

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
      defaultLocus,
      species: speciesId
    }
    return { assembly }
  } catch {
    return { error: 'Network error contacting Ensembl — check your connection.' }
  }
}

// ---------------------------------------------------------------------------
// Additional annotation tracks (UCSC-style "add track") for a region.
// ---------------------------------------------------------------------------

export interface EnsemblTrackSpec {
  /** Stable id used in the menu + track id. */
  id: string
  /** Ensembl ?feature= value; '' for a locally-computed track (CpG islands). */
  feature: string
  name: string
  color: string
  /** Largest region this track may be fetched for (dense data is capped). */
  maxBp?: number
  /** Computed locally from the reference sequence rather than fetched. */
  computed?: boolean
}

export const ENSEMBL_TRACKS: EnsemblTrackSpec[] = [
  { id: 'regulatory', feature: 'regulatory', name: 'Regulatory features', color: '#cf6b8d' },
  { id: 'repeat', feature: 'repeat', name: 'Repeat regions', color: '#8aa0b8', maxBp: 2_000_000 },
  { id: 'constrained', feature: 'constrained', name: 'Conservation (constrained)', color: '#3acfa6' },
  { id: 'variation', feature: 'variation', name: 'Variants (SNPs)', color: '#d8a43c', maxBp: 100_000 },
  { id: 'cpg', feature: '', name: 'CpG islands (computed)', color: '#59b85f', computed: true }
]

// Keyed on the lowercase Ensembl regulatory `description` value.
const REGULATORY_COLORS: Record<string, string> = {
  promoter: '#d8694d',
  promoter_flanking_region: '#cf8d3a',
  enhancer: '#cf6b8d',
  ctcf_binding_site: '#4f9dde',
  tf_binding_site: '#9d6bcf',
  open_chromatin_region: '#5fb88f'
}

/** "CTCF_binding_site" -> "CTCF binding site"; "enhancer" -> "Enhancer". */
function regulatoryLabel(desc?: string): string {
  if (!desc) return 'regulatory'
  const s = desc.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface OverlapFeature {
  seq_region_name?: string
  start?: number
  end?: number
  strand?: number
  id?: string
  feature_type?: string
  description?: string
  consequence_type?: string
  score?: number
}

/** Fetch one annotation track (regulatory / repeat / constrained / variation). */
export async function fetchEnsemblTrack(
  speciesId: string,
  chromName: string,
  start1: number,
  end1: number,
  spec: EnsemblTrackSpec
): Promise<{ track?: Track; error?: string }> {
  if (spec.computed) return { error: 'Computed track — build it from the reference sequence locally.' }
  if (!(start1 < end1)) return { error: 'Invalid region.' }
  if (spec.maxBp && end1 - start1 + 1 > spec.maxBp) {
    return { error: `Zoom in to under ${(spec.maxBp / 1000).toLocaleString()} kb to add ${spec.name.toLowerCase()}.` }
  }
  const apiChrom = toApiChrom(chromName)
  const url =
    `${ENSEMBL_BASE}/overlap/region/${encodeURIComponent(speciesId)}/${apiChrom}:${start1}-${end1}` +
    `?feature=${encodeURIComponent(spec.feature)};content-type=application/json`
  try {
    const res = await fetch(url)
    if (!res.ok) return { error: await ensemblErrorMessage(res, `Ensembl could not return ${spec.name.toLowerCase()}.`) }
    const data = (await res.json()) as OverlapFeature[]
    if (!Array.isArray(data)) return { error: 'Unexpected response from Ensembl.' }
    const chrom = normalizeChromName(chromName)
    const MAX_FEATURES = 6000
    const features: GenomeFeature[] = []
    for (const f of data) {
      if (features.length >= MAX_FEATURES) break
      const s = f.start
      const e = f.end
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue
      let name: string
      let color = spec.color
      if (spec.id === 'regulatory') {
        name = regulatoryLabel(f.description)
        color = REGULATORY_COLORS[(f.description ?? '').toLowerCase()] ?? spec.color
      } else if (spec.id === 'variation') {
        name = f.id ?? 'variant'
      } else {
        name = f.description ?? f.feature_type ?? f.id ?? spec.name
      }
      features.push({
        id: f.id ?? makeId(spec.id),
        name,
        chrom,
        start: (s as number) - 1,
        end: e as number,
        strand: f.strand === 1 ? 1 : f.strand === -1 ? -1 : 0,
        type: spec.id,
        score: f.score,
        color
      })
    }
    if (features.length === 0) return { error: `No ${spec.name.toLowerCase()} in this region.` }
    const track: Track = {
      id: makeId('trk_' + spec.id),
      name: features.length >= MAX_FEATURES ? `${spec.name} (first ${MAX_FEATURES})` : spec.name,
      kind: 'features',
      visible: true,
      color: spec.color,
      features
    }
    return { track }
  } catch {
    return { error: 'Network error contacting Ensembl — check your connection.' }
  }
}
