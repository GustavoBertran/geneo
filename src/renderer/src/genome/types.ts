/**
 * Genome-browser domain model (UCSC-style). Separate from the plasmid SeqRecord
 * model: this describes a genome assembly browsed at chromosome scale through a
 * stack of tracks.
 *
 * COORDINATE CONVENTION (matches the rest of GeneO):
 *   - 0-based, half-open [start, end) in CHROMOSOME coordinates.
 *   - strand: 1 = +, -1 = -, 0 = unstranded.
 *   - GFF/BED 1-based vs 0-based conversions happen only in the parsers.
 */

export type GStrand = 1 | -1 | 0

/** A viewing window on one chromosome. */
export interface Locus {
  chrom: string
  start: number
  end: number
}

/**
 * A user position marker (karyoploteR-style): a labeled vertical rule drawn
 * across all tracks at a single chromosome coordinate.
 */
export interface GenomeMarker {
  id: string
  chrom: string
  /** 0-based chromosome coordinate of the rule (range start). */
  position: number
  /**
   * Optional 0-based exclusive end. When set and > position the marker spans a
   * range and is drawn as a highlighted bar; otherwise it is a single vertical
   * rule at `position`.
   */
  end?: number
  label: string
  color?: string
}

/** A block (exon / BED block) in chromosome coordinates, half-open. */
export interface Block {
  start: number
  end: number
}

/** A transcript / gene model (the UCSC "gene" glyph: thin UTR + thick CDS). */
export interface Transcript {
  id: string
  name: string
  geneId?: string
  geneName?: string
  chrom: string
  start: number
  end: number
  strand: GStrand
  biotype?: string
  /** Exon blocks, ascending by start. Whole exon = drawn; CDS portion = thick. */
  exons: Block[]
  /** Coding blocks (subset/intersection of exons). Empty => non-coding. */
  cds: Block[]
}

/** A generic interval annotation (BED-like). May carry BED12 block structure. */
export interface GenomeFeature {
  id: string
  name?: string
  chrom: string
  start: number
  end: number
  strand: GStrand
  type?: string
  score?: number
  color?: string
  /** BED12 sub-blocks (chrom coords), if present. */
  blocks?: Block[]
  /** BED thick range (coding) in chrom coords, if present. */
  thickStart?: number
  thickEnd?: number
}

/** One quantitative span (bedGraph / wig). */
export interface SignalSpan {
  start: number
  end: number
  value: number
}

export interface SignalData {
  chrom: string
  spans: SignalSpan[]
  /** Optional precomputed value range for fixed y-scaling. */
  min?: number
  max?: number
}

export type TrackKind = 'genes' | 'features' | 'signal' | 'sequence'

/** A single horizontal track in the browser. */
export interface Track {
  id: string
  name: string
  kind: TrackKind
  visible: boolean
  /** Preferred pixel height (the renderer may grow for stacked lanes). */
  height?: number
  color?: string
  // payload by kind:
  transcripts?: Transcript[] // kind 'genes'
  features?: GenomeFeature[] // kind 'features'
  signal?: SignalData // kind 'signal'
  // kind 'sequence' reads bases from the chromosome
}

/** A chromosome / contig. Sequence may only be present for a window. */
export interface Chromosome {
  name: string
  length: number
  /**
   * Reference bases for a window. `bases` covers [start, start + bases.length)
   * in 0-based chromosome coordinates. Undefined => no bundled sequence.
   */
  seq?: { start: number; bases: string }
}

export interface GenomeAssembly {
  id: string
  name: string
  chromosomes: Chromosome[]
  tracks: Track[]
  /** Optional default view when the assembly is first opened. */
  defaultLocus?: Locus
}

// ---------------------------------------------------------------------------
// Rendering contract shared by the container and every track renderer.
// ---------------------------------------------------------------------------

/**
 * Maps the current locus to pixels. Tracks MUST use `pxPerBp` to zoom-gate their
 * rendering (e.g. the sequence track only draws bases when legible; the signal
 * track aggregates spans into pixel columns instead of one element per span).
 */
export interface Viewport {
  locus: Locus
  /** Pixel width of the track drawing area. */
  width: number
  /** Pixels per base pair (width / (end - start)). */
  pxPerBp: number
  /** Chromosome bp -> x pixel within the track area. */
  bpToPx: (bp: number) => number
  /** x pixel within the track area -> chromosome bp (float). */
  pxToBp: (px: number) => number
}

/**
 * Props every track renderer receives. Each renderer returns an <svg> of
 * `viewport.width` and its own height; the container stacks them vertically and
 * shares the horizontal scale, so no single giant SVG is needed.
 */
export interface GenomeTrackProps {
  track: Track
  chrom: Chromosome
  viewport: Viewport
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}
