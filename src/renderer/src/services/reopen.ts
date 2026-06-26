/**
 * Re-open an item from the "Files" list. Dispatches on the stored source:
 * bundled samples load instantly, disk files are re-read via the Electron
 * bridge, and Ensembl regions are re-fetched.
 */
import { useStore, type RecentItem } from '@state/store'
import { puc19 } from '@data/puc19'
import { samplePlasmid } from '@data/sample'
import { sampleGenomes } from '@data/genome'
import { normalizeRecord } from '@core/sequence'
import { parseSequenceFile } from '@core/io'
import { loadGenomeFile } from '../genome/io'
import { fetchEnsemblAssembly } from '../genome/ensembl'

export interface ReopenResult {
  ok: boolean
  error?: string
}

export async function reopenItem(item: RecentItem): Promise<ReopenResult> {
  const st = useStore.getState()
  const src = item.source
  try {
    switch (src.type) {
      case 'sample-plasmid':
        st.setRecord(src.sampleId === 'puc19' ? puc19 : samplePlasmid)
        st.setViewMode('map')
        break

      case 'plasmid-file': {
        if (typeof window.api?.readPath !== 'function') return { ok: false, error: 'File access requires the desktop app' }
        const r = await window.api.readPath(src.path)
        if (!r.ok || r.content == null) return { ok: false, error: r.error ?? 'Could not read file' }
        st.setRecord(normalizeRecord(parseSequenceFile(r.name ?? 'sequence', r.content)), src.path)
        st.setViewMode('map')
        break
      }

      case 'sample-genome': {
        const a = sampleGenomes.find((g) => g.id === src.assemblyId)
        if (!a) return { ok: false, error: 'Sample no longer available' }
        st.setAssembly(a)
        st.setViewMode('genome')
        break
      }

      case 'genome-file': {
        if (typeof window.api?.readPath !== 'function') return { ok: false, error: 'File access requires the desktop app' }
        const r = await window.api.readPath(src.path)
        if (!r.ok || r.content == null) return { ok: false, error: r.error ?? 'Could not read file' }
        const loaded = loadGenomeFile(r.name ?? 'track', r.content)
        st.mergeGenomeData(loaded)
        const t = loaded.tracks[0]
        const first = t?.transcripts?.[0] ?? t?.features?.[0]
        if (first) {
          const pad = Math.max(500, Math.round((first.end - first.start) * 0.2))
          st.setLocus({ chrom: first.chrom, start: first.start - pad, end: first.end + pad })
        } else if (loaded.sequence) {
          st.setLocus({ chrom: loaded.sequence.chrom, start: loaded.sequence.start, end: loaded.sequence.start + loaded.sequence.bases.length })
        }
        st.setViewMode('genome')
        break
      }

      case 'ensembl': {
        const res = await fetchEnsemblAssembly(src.species, src.query)
        if (res.error || !res.assembly) return { ok: false, error: res.error ?? 'Fetch failed' }
        st.setAssembly(res.assembly)
        st.setViewMode('genome')
        break
      }
    }
    // bump it to the most-recent position
    st.addRecent({ kind: item.kind, name: item.name, subtitle: item.subtitle, source: item.source })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
