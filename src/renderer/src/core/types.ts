/**
 * GeneO core domain types.
 *
 * COORDINATE CONVENTION (used everywhere unless noted):
 *   - 0-based, half-open intervals: `start` is inclusive, `end` is exclusive,
 *     exactly like JavaScript `String.prototype.slice(start, end)`.
 *   - A feature/selection of length L at position p covers bases [p, p+L).
 *   - For CIRCULAR molecules a feature may wrap the origin. In that case
 *     `start > end` and the feature covers [start, length) ++ [0, end).
 *   - `strand`:  1 = top/forward strand, -1 = bottom/reverse strand.
 *
 * Positions shown to the user are 1-based (add 1 to `start`); conversion to the
 * display convention happens only in the UI layer.
 */

export type Strand = 1 | -1
export type Topology = 'linear' | 'circular'

/** A biological annotation on a sequence (gene, CDS, promoter, ori, ...). */
export interface Feature {
  /** Stable unique id (used as React key and for selection). */
  id: string
  /** Human-readable label shown on maps. */
  name: string
  /**
   * Feature kind. Drives default color and rendering. Common values mirror
   * GenBank feature keys: 'CDS' | 'gene' | 'promoter' | 'terminator' |
   * 'rep_origin' | 'primer_bind' | 'misc_feature' | 'protein_bind' |
   * 'RBS' | 'polyA_signal' | 'LTR' | 'enhancer' | 'source' | ...
   */
  type: string
  /** 0-based inclusive start. */
  start: number
  /** 0-based exclusive end. May be <= start for origin-spanning circular features. */
  end: number
  strand: Strand
  /** CSS color (hex). When omitted the UI falls back to a per-type default. */
  color?: string
  /** Optional precomputed amino-acid translation (CDS features). */
  translation?: string
  /** Arbitrary GenBank qualifiers (e.g. { product: 'AmpR', note: '...' }). */
  qualifiers?: Record<string, string>
}

/** A single sequence record (one plasmid / fragment / construct). */
export interface SeqRecord {
  /** Stable unique id. */
  id: string
  /** Display name (LOCUS / file name). */
  name: string
  /** Free-text description (DEFINITION line). */
  description?: string
  /** Raw nucleotide sequence, uppercase, no whitespace. Alphabet: ACGTN + IUPAC. */
  sequence: string
  topology: Topology
  features: Feature[]
}

/** A contiguous span on the top strand, half-open [start, end). */
export interface Range {
  start: number
  end: number
}

// ---------------------------------------------------------------------------
// Restriction enzymes
// ---------------------------------------------------------------------------

export type OverhangType = 'blunt' | "5'" | "3'"

/**
 * A restriction enzyme definition.
 *
 * `site` is the recognition sequence written 5'->3' on the top strand and may
 * contain IUPAC ambiguity codes (e.g. GGTNACC for BstEII).
 *
 * Cut positions are 0-based offsets measured from the FIRST base of the
 * recognition site:
 *   - `cutTop`    = number of bases after which the top strand is cut.
 *   - `cutBottom` = number of bases after which the bottom strand is cut
 *                   (also measured along the top-strand coordinate).
 * Example EcoRI  G^AATTC :  site='GAATTC', cutTop=1, cutBottom=5  => 5' overhang.
 * Example SmaI   CCC^GGG :  site='CCCGGG', cutTop=3, cutBottom=3  => blunt.
 */
export interface Enzyme {
  name: string
  site: string
  cutTop: number
  cutBottom: number
  /** Optional grouping (supplier/isoschizomer family); informational only. */
  overhang?: OverhangType
}

/** A located cut: where an enzyme recognizes and cuts the sequence. */
export interface CutSite {
  enzyme: string
  /** 0-based start of the recognition site on the top strand. */
  siteStart: number
  /** Recognition site length. */
  siteLength: number
  /** 0-based top-strand cut coordinate (bond is between cutPosTop-1 and cutPosTop). */
  cutPosTop: number
  /** 0-based bottom-strand cut coordinate. */
  cutPosBottom: number
  strand: Strand
  overhang: OverhangType
}

/** A fragment produced by digestion. */
export interface Fragment {
  /** 0-based start (top strand) of the fragment. */
  start: number
  /** 0-based end (top strand, exclusive). */
  end: number
  length: number
  sequence: string
  /** Enzyme that produced the left/right end (undefined = molecule end for linear). */
  leftEnzyme?: string
  rightEnzyme?: string
}

// ---------------------------------------------------------------------------
// ORFs / translation
// ---------------------------------------------------------------------------

export interface Orf {
  start: number
  end: number
  strand: Strand
  /** Reading frame 0..2 relative to its strand's 5' end. */
  frame: number
  length: number
  protein: string
}

// ---------------------------------------------------------------------------
// Primers
// ---------------------------------------------------------------------------

export interface Primer {
  id: string
  name: string
  /** Primer sequence 5'->3'. */
  sequence: string
  /** Optional recorded binding location once mapped against a template. */
  binding?: {
    start: number
    end: number
    strand: Strand
    mismatches: number
  }
}

export interface PrimerBindingSite {
  primerId: string
  primerName: string
  start: number
  end: number
  strand: Strand
  mismatches: number
  /** Melting temp of the matching 3' region (°C). */
  tm: number
}

export interface PcrProduct {
  forwardPrimer: string
  reversePrimer: string
  start: number
  end: number
  length: number
  sequence: string
}
