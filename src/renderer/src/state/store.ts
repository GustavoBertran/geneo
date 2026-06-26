/**
 * Global application state (Zustand).
 *
 * UI components SUBSCRIBE to this store rather than receiving deep props, which
 * keeps the component tree flat and decoupled. Heavy derived data (cut sites,
 * ORFs, primer hits) is NOT stored here — components compute it with memoized
 * selectors from the engines, keyed on `record` identity.
 */
import { create } from 'zustand'
import type { Range, SeqRecord, Feature } from '@core/types'
import { makeId } from '@core/sequence'
import type { GenomeAssembly, GenomeMarker, Locus, Track } from '../genome/types'
import { clampLocus } from '../genome/viewport'

/** Which main center panel is showing. */
export type ViewMode = 'map' | 'sequence' | 'enzymes' | 'orfs' | 'primers' | 'genome' | 'files'

/** How a recently-opened item can be re-opened. */
export type RecentSource =
  | { type: 'sample-plasmid'; sampleId: string }
  | { type: 'plasmid-file'; path: string }
  | { type: 'sample-genome'; assemblyId: string }
  | { type: 'genome-file'; path: string }
  | { type: 'ensembl'; species: string; query: string }

/** An entry in the "Files" / recently-worked-on list. */
export interface RecentItem {
  id: string
  kind: 'plasmid' | 'genome'
  name: string
  subtitle: string
  openedAt: number
  source: RecentSource
}

const RECENT_KEY = 'geneo.recentItems'
const RECENT_MAX = 60

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as RecentItem[]) : []
  } catch {
    return []
  }
}

function persistRecent(items: RecentItem[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Stable signature so re-opening the same thing updates rather than duplicates. */
function recentSig(s: RecentSource): string {
  return JSON.stringify(s)
}

/** How the map view draws the molecule. */
export type MapStyle = 'circular' | 'linear'

export interface AppState {
  // --- the open construct -------------------------------------------------
  record: SeqRecord | null
  /** File path the record was loaded from / last saved to (for re-save). */
  filePath: string | null
  dirty: boolean

  setRecord: (rec: SeqRecord, filePath?: string | null) => void
  updateSequence: (sequence: string) => void
  renameRecord: (name: string) => void
  setTopology: (topology: 'linear' | 'circular') => void

  // --- features -----------------------------------------------------------
  addFeature: (feature: Omit<Feature, 'id'> & { id?: string }) => void
  updateFeature: (id: string, patch: Partial<Feature>) => void
  removeFeature: (id: string) => void

  // --- selection / hover --------------------------------------------------
  /** Current base selection on the top strand (half-open). null = no selection. */
  selection: Range | null
  setSelection: (range: Range | null) => void
  selectedFeatureId: string | null
  setSelectedFeatureId: (id: string | null) => void
  hoveredFeatureId: string | null
  setHoveredFeatureId: (id: string | null) => void

  // --- view ---------------------------------------------------------------
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  mapStyle: MapStyle
  setMapStyle: (s: MapStyle) => void
  /** Show the 3-frame / 6-frame translation track in the sequence view. */
  showTranslation: boolean
  setShowTranslation: (v: boolean) => void
  /** Show enzyme cut sites on the maps. */
  showEnzymeSites: boolean
  setShowEnzymeSites: (v: boolean) => void

  // --- enzymes ------------------------------------------------------------
  /** Names of enzymes currently enabled for display/analysis. */
  enabledEnzymes: string[]
  setEnabledEnzymes: (names: string[]) => void
  toggleEnzyme: (name: string) => void
  /** Restrict the enzyme list to those cutting exactly N times (0 = no filter). */
  cutCountFilter: number
  setCutCountFilter: (n: number) => void

  // --- genome browser -----------------------------------------------------
  assembly: GenomeAssembly | null
  /** Current viewing window. Always clamped to the active chromosome. */
  locus: Locus | null
  /** Per-track-id visibility overrides (defaults seeded from track.visible). */
  trackVisibility: Record<string, boolean>
  selectedGenomeId: string | null
  hoveredGenomeId: string | null
  /** User position markers (labeled vertical rules). */
  markers: GenomeMarker[]
  setAssembly: (assembly: GenomeAssembly | null) => void
  setLocus: (locus: Locus) => void
  toggleTrack: (id: string) => void
  addMarker: (marker: Omit<GenomeMarker, 'id'> & { id?: string }) => void
  removeMarker: (id: string) => void
  clearMarkers: () => void
  mergeGenomeData: (loaded: {
    tracks: Track[]
    sequence?: { chrom: string; start: number; bases: string }
  }) => void
  setSelectedGenomeId: (id: string | null) => void
  setHoveredGenomeId: (id: string | null) => void

  // --- recent files ("Files" view) ---------------------------------------
  recentItems: RecentItem[]
  /** Record an opened item (dedupes by source, moves to front, persists). */
  addRecent: (item: Omit<RecentItem, 'id' | 'openedAt'>) => void
  removeRecent: (id: string) => void
  clearRecent: () => void
}

export const useStore = create<AppState>((set) => ({
  record: null,
  filePath: null,
  dirty: false,

  setRecord: (rec, filePath = null) =>
    set({ record: rec, filePath, dirty: false, selection: null, selectedFeatureId: null }),

  updateSequence: (sequence) =>
    set((s) => (s.record ? { record: { ...s.record, sequence }, dirty: true } : s)),

  renameRecord: (name) =>
    set((s) => (s.record ? { record: { ...s.record, name }, dirty: true } : s)),

  setTopology: (topology) =>
    set((s) => (s.record ? { record: { ...s.record, topology }, dirty: true } : s)),

  addFeature: (feature) =>
    set((s) => {
      if (!s.record) return s
      const f: Feature = { ...feature, id: feature.id ?? makeId('feat') }
      return { record: { ...s.record, features: [...s.record.features, f] }, dirty: true }
    }),

  updateFeature: (id, patch) =>
    set((s) => {
      if (!s.record) return s
      return {
        record: {
          ...s.record,
          features: s.record.features.map((f) => (f.id === id ? { ...f, ...patch } : f))
        },
        dirty: true
      }
    }),

  removeFeature: (id) =>
    set((s) => {
      if (!s.record) return s
      return {
        record: { ...s.record, features: s.record.features.filter((f) => f.id !== id) },
        dirty: true,
        selectedFeatureId: s.selectedFeatureId === id ? null : s.selectedFeatureId
      }
    }),

  selection: null,
  setSelection: (range) => set({ selection: range }),
  selectedFeatureId: null,
  setSelectedFeatureId: (id) => set({ selectedFeatureId: id }),
  hoveredFeatureId: null,
  setHoveredFeatureId: (id) => set({ hoveredFeatureId: id }),

  viewMode: 'map',
  setViewMode: (m) => set({ viewMode: m }),
  mapStyle: 'circular',
  setMapStyle: (s) => set({ mapStyle: s }),
  showTranslation: false,
  setShowTranslation: (v) => set({ showTranslation: v }),
  showEnzymeSites: true,
  setShowEnzymeSites: (v) => set({ showEnzymeSites: v }),

  enabledEnzymes: ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NotI', 'XbaI', 'PstI', 'SalI', 'NcoI', 'NdeI', 'KpnI', 'SacI'],
  setEnabledEnzymes: (names) => set({ enabledEnzymes: names }),
  toggleEnzyme: (name) =>
    set((s) => ({
      enabledEnzymes: s.enabledEnzymes.includes(name)
        ? s.enabledEnzymes.filter((n) => n !== name)
        : [...s.enabledEnzymes, name]
    })),
  cutCountFilter: 0,
  setCutCountFilter: (n) => set({ cutCountFilter: n }),

  // --- genome browser -----------------------------------------------------
  assembly: null,
  locus: null,
  trackVisibility: {},
  selectedGenomeId: null,
  hoveredGenomeId: null,
  markers: [],

  setAssembly: (assembly) =>
    set(() => {
      if (!assembly) return { assembly: null, locus: null, trackVisibility: {}, markers: [] }
      const vis: Record<string, boolean> = {}
      for (const t of assembly.tracks) vis[t.id] = t.visible
      const chrom0 = assembly.chromosomes[0]
      const fallback: Locus | null = chrom0
        ? { chrom: chrom0.name, start: chrom0.seq?.start ?? 0, end: (chrom0.seq?.start ?? 0) + (chrom0.seq?.bases.length ?? chrom0.length) }
        : null
      const locus = assembly.defaultLocus ?? fallback
      return { assembly, trackVisibility: vis, locus, selectedGenomeId: null, markers: [] }
    }),

  setLocus: (locus) =>
    set((s) => {
      const chrom = s.assembly?.chromosomes.find((c) => c.name === locus.chrom)
      return { locus: clampLocus(locus, chrom) }
    }),

  toggleTrack: (id) =>
    set((s) => ({ trackVisibility: { ...s.trackVisibility, [id]: !(s.trackVisibility[id] ?? true) } })),

  mergeGenomeData: (loaded) =>
    set((s) => {
      const assembly: GenomeAssembly =
        s.assembly ?? { id: makeId('asm'), name: 'Genome', chromosomes: [], tracks: [] }
      let chromosomes = assembly.chromosomes
      if (loaded.sequence) {
        const { chrom, start, bases } = loaded.sequence
        const existing = chromosomes.find((c) => c.name === chrom)
        if (existing) {
          chromosomes = chromosomes.map((c) =>
            c.name === chrom ? { ...c, length: Math.max(c.length, start + bases.length), seq: { start, bases } } : c
          )
        } else {
          chromosomes = [...chromosomes, { name: chrom, length: start + bases.length, seq: { start, bases } }]
        }
      }
      // ensure any chromosome referenced by new tracks exists
      for (const t of loaded.tracks) {
        const names = new Set<string>()
        t.transcripts?.forEach((x) => names.add(x.chrom))
        t.features?.forEach((x) => names.add(x.chrom))
        if (t.signal?.chrom) names.add(t.signal.chrom)
        for (const n of names) {
          if (!chromosomes.find((c) => c.name === n)) {
            const extent = Math.max(
              ...(t.transcripts?.filter((x) => x.chrom === n).map((x) => x.end) ?? [0]),
              ...(t.features?.filter((x) => x.chrom === n).map((x) => x.end) ?? [0]),
              ...(t.signal?.chrom === n ? t.signal.spans.map((sp) => sp.end) : [0]),
              1
            )
            chromosomes = [...chromosomes, { name: n, length: extent }]
          }
        }
      }
      const tracks = [...assembly.tracks, ...loaded.tracks]
      const vis = { ...s.trackVisibility }
      for (const t of loaded.tracks) vis[t.id] = t.visible
      const next: GenomeAssembly = { ...assembly, chromosomes, tracks }
      // if no locus yet, jump to the new data
      let locus = s.locus
      if (!locus && loaded.tracks[0]) {
        const t = loaded.tracks[0]
        const first = t.transcripts?.[0] ?? t.features?.[0]
        if (first) locus = clampLocus({ chrom: first.chrom, start: first.start, end: first.end }, undefined)
      }
      return { assembly: next, trackVisibility: vis, locus }
    }),

  addMarker: (marker) =>
    set((s) => ({ markers: [...s.markers, { ...marker, id: marker.id ?? makeId('mark') }] })),
  removeMarker: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),
  clearMarkers: () => set({ markers: [] }),

  setSelectedGenomeId: (id) => set({ selectedGenomeId: id }),
  setHoveredGenomeId: (id) => set({ hoveredGenomeId: id }),

  recentItems: loadRecent(),
  addRecent: (item) =>
    set((s) => {
      const sig = recentSig(item.source)
      const without = s.recentItems.filter((r) => recentSig(r.source) !== sig)
      const entry: RecentItem = { ...item, id: makeId('recent'), openedAt: Date.now() }
      const next = [entry, ...without].slice(0, RECENT_MAX)
      persistRecent(next)
      return { recentItems: next }
    }),
  removeRecent: (id) =>
    set((s) => {
      const next = s.recentItems.filter((r) => r.id !== id)
      persistRecent(next)
      return { recentItems: next }
    }),
  clearRecent: () =>
    set(() => {
      persistRecent([])
      return { recentItems: [] }
    })
}))
