/**
 * Default visual styling for feature types. Centralized so maps, panels and
 * the GenBank importer all agree on colors. Mirrors SnapGene-ish conventions.
 */
import type { Feature } from './types'

const TYPE_COLORS: Record<string, string> = {
  CDS: '#cf8d3a',
  gene: '#a0c060',
  promoter: '#3aa6cf',
  terminator: '#cf3a6b',
  rep_origin: '#9d6bcf',
  primer_bind: '#5fb88f',
  protein_bind: '#c0a040',
  misc_feature: '#8aa0b8',
  RBS: '#6bcf9d',
  polyA_signal: '#cf6b8d',
  LTR: '#b86b5f',
  enhancer: '#3acfa6',
  ncRNA: '#7d8acf',
  regulatory: '#bf9f5f',
  source: '#6b7280',
  oriT: '#9d6bcf',
  mobile_element: '#a06bcf',
  sig_peptide: '#cfae3a',
  stem_loop: '#cf7a3a'
}

const FALLBACK_PALETTE = [
  '#cf8d3a', '#3aa6cf', '#a0c060', '#cf3a6b', '#9d6bcf',
  '#5fb88f', '#c0a040', '#cf6b8d', '#3acfa6', '#b86b5f'
]

/** Resolve the display color for a feature (explicit color wins). */
export function featureColor(feature: Pick<Feature, 'type' | 'color' | 'name'>): string {
  if (feature.color) return feature.color
  const byType = TYPE_COLORS[feature.type]
  if (byType) return byType
  // deterministic fallback based on name hash
  let h = 0
  const s = feature.name || feature.type || ''
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
}

export function defaultColorForType(type: string): string {
  return TYPE_COLORS[type] ?? '#8aa0b8'
}

/** Whether a feature type is typically drawn as a directional arrow. */
export function isDirectional(type: string): boolean {
  return type === 'CDS' || type === 'gene' || type === 'promoter' || type === 'primer_bind' || type === 'mobile_element'
}

export const FEATURE_TYPES = [
  'CDS', 'gene', 'promoter', 'terminator', 'rep_origin', 'primer_bind',
  'protein_bind', 'RBS', 'polyA_signal', 'LTR', 'enhancer', 'regulatory',
  'misc_feature', 'ncRNA', 'sig_peptide', 'stem_loop', 'source'
]
