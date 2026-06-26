import { useStore, type ViewMode } from '@state/store'
import { normalizeRecord } from '@core/sequence'
import { parseSequenceFile } from '@core/io'
import { serializeGenBank } from '@core/genbank'
import { serializeFasta } from '@core/fasta'
import { samplePlasmid } from '@data/sample'
import { puc19 } from '@data/puc19'
import { sampleGenomes } from '@data/genome'
import { loadGenomeFile } from '../genome/io'
import { Logo } from './Logo'

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'sequence', label: 'Sequence' },
  { id: 'enzymes', label: 'Enzymes' },
  { id: 'orfs', label: 'ORFs' },
  { id: 'primers', label: 'Primers' },
  { id: 'genome', label: 'Genome' },
  { id: 'files', label: 'Files' }
]

function plasmidSubtitle(seqLen: number, topology: string): string {
  return `${seqLen.toLocaleString()} bp · ${topology}`
}

/** Guard a window.api method (absent in the browser-only preview). */
function ensureDesktop(method: 'openFile' | 'saveFile'): boolean {
  if (typeof window.api?.[method] === 'function') return true
  // eslint-disable-next-line no-alert
  alert('Opening and saving files requires the GeneO desktop app.')
  return false
}

export function Toolbar(): JSX.Element {
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const mapStyle = useStore((s) => s.mapStyle)
  const setMapStyle = useStore((s) => s.setMapStyle)
  const setRecord = useStore((s) => s.setRecord)
  const record = useStore((s) => s.record)
  const mergeGenomeData = useStore((s) => s.mergeGenomeData)
  const setLocus = useStore((s) => s.setLocus)
  const setAssembly = useStore((s) => s.setAssembly)
  const assembly = useStore((s) => s.assembly)
  const addRecent = useStore((s) => s.addRecent)

  async function onLoadGenome(): Promise<void> {
    if (!ensureDesktop('openFile')) return
    try {
      const res = await window.api.openFile({
        filters: [
          { name: 'Genome tracks', extensions: ['gff', 'gff3', 'gtf', 'bed', 'bedgraph', 'bg', 'wig', 'fasta', 'fa', 'fna'] },
          { name: 'Annotations (GFF/GTF/BED)', extensions: ['gff', 'gff3', 'gtf', 'bed'] },
          { name: 'Signal (bedGraph/WIG)', extensions: ['bedgraph', 'bg', 'wig'] },
          { name: 'Reference (FASTA)', extensions: ['fasta', 'fa', 'fna'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (res.canceled || res.content == null) return
      const loaded = loadGenomeFile(res.name ?? 'track', res.content)
      mergeGenomeData(loaded)
      const t = loaded.tracks[0]
      const first = t?.transcripts?.[0] ?? t?.features?.[0]
      if (first) {
        const pad = Math.max(500, Math.round((first.end - first.start) * 0.2))
        setLocus({ chrom: first.chrom, start: first.start - pad, end: first.end + pad })
      } else if (loaded.sequence) {
        setLocus({ chrom: loaded.sequence.chrom, start: loaded.sequence.start, end: loaded.sequence.start + loaded.sequence.bases.length })
      }
      if (res.path) {
        addRecent({
          kind: 'genome',
          name: res.name ?? 'track',
          subtitle: `${loaded.format.toUpperCase()} · ${first?.chrom ?? loaded.sequence?.chrom ?? ''}`,
          source: { type: 'genome-file', path: res.path }
        })
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Could not load genome file: ${(err as Error).message}`)
    }
  }

  async function onOpen(): Promise<void> {
    if (!ensureDesktop('openFile')) return
    try {
      const res = await window.api.openFile()
      if (res.canceled || !res.content) return
      const rec = normalizeRecord(parseSequenceFile(res.name ?? 'sequence', res.content))
      setRecord(rec, res.path ?? null)
      if (res.path) {
        addRecent({
          kind: 'plasmid',
          name: rec.name,
          subtitle: plasmidSubtitle(rec.sequence.length, rec.topology),
          source: { type: 'plasmid-file', path: res.path }
        })
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Could not parse file: ${(err as Error).message}`)
    }
  }

  async function onSaveGenBank(): Promise<void> {
    if (!record || !ensureDesktop('saveFile')) return
    try {
      await window.api.saveFile({
        content: serializeGenBank(record),
        defaultName: `${record.name}.gb`,
        filters: [{ name: 'GenBank', extensions: ['gb'] }]
      })
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Could not save: ${(err as Error).message}`)
    }
  }

  async function onSaveFasta(): Promise<void> {
    if (!record || !ensureDesktop('saveFile')) return
    try {
      await window.api.saveFile({
        content: serializeFasta(record),
        defaultName: `${record.name}.fasta`,
        filters: [{ name: 'FASTA', extensions: ['fasta'] }]
      })
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Could not save: ${(err as Error).message}`)
    }
  }

  return (
    <div
      className="drag"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px 8px 84px',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)'
      }}
    >
      <div className="row no-drag" style={{ gap: 7 }}>
        <Logo size={22} />
        <span style={{ fontWeight: 700, letterSpacing: '0.02em', color: 'var(--accent-strong)' }}>GeneO</span>
      </div>

      {viewMode === 'genome' ? (
        <div className="no-drag row" style={{ gap: 6 }}>
          <select
            value={sampleGenomes.some((g) => g.id === assembly?.id) ? assembly!.id : ''}
            title="Switch the bundled genome locus"
            onChange={(e) => {
              const a = sampleGenomes.find((g) => g.id === e.target.value)
              if (a) {
                setAssembly(a)
                addRecent({
                  kind: 'genome',
                  name: a.name,
                  subtitle: a.defaultLocus?.chrom ?? a.chromosomes[0]?.name ?? '',
                  source: { type: 'sample-genome', assemblyId: a.id }
                })
              }
            }}
            style={{ background: 'var(--bg-input)' }}
          >
            <option value="" disabled>Sample locus…</option>
            {sampleGenomes.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <button onClick={onLoadGenome} title="Load GFF3 / BED / bedGraph / FASTA as a track">Load track…</button>
        </div>
      ) : (
        <div className="no-drag row" style={{ gap: 6 }}>
          <button onClick={onOpen} title="Open a GenBank or FASTA file">Open…</button>
          <button onClick={onSaveGenBank} disabled={!record} title="Export as GenBank">Save .gb</button>
          <button onClick={onSaveFasta} disabled={!record} title="Export as FASTA">Save .fa</button>
          <select
            value=""
            title="Load a bundled sample plasmid"
            onChange={(e) => {
              const rec = e.target.value === 'puc19' ? puc19 : e.target.value === 'demo' ? samplePlasmid : null
              if (rec) {
                setRecord(rec)
                addRecent({
                  kind: 'plasmid',
                  name: rec.name,
                  subtitle: plasmidSubtitle(rec.sequence.length, rec.topology),
                  source: { type: 'sample-plasmid', sampleId: e.target.value }
                })
              }
              e.target.value = ''
            }}
            style={{ background: 'var(--bg-input)' }}
          >
            <option value="">Samples ▾</option>
            <option value="puc19">pUC19 (real, 2686 bp)</option>
            <option value="demo">pGeneO-Demo (synthetic)</option>
          </select>
        </div>
      )}

      <div className="spacer" />

      <div className="no-drag row" style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius)', padding: 2 }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className="ghost"
            onClick={() => setViewMode(v.id)}
            style={{
              background: viewMode === v.id ? 'var(--accent)' : 'transparent',
              color: viewMode === v.id ? '#fff' : 'var(--text-dim)',
              padding: '4px 12px'
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {viewMode === 'map' && (
        <div className="no-drag row" style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius)', padding: 2 }}>
          <button
            className="ghost"
            onClick={() => setMapStyle('circular')}
            style={{ background: mapStyle === 'circular' ? 'var(--bg-active)' : 'transparent', padding: '4px 10px' }}
          >
            ◯ Circular
          </button>
          <button
            className="ghost"
            onClick={() => setMapStyle('linear')}
            style={{ background: mapStyle === 'linear' ? 'var(--bg-active)' : 'transparent', padding: '4px 10px' }}
          >
            ▭ Linear
          </button>
        </div>
      )}
    </div>
  )
}
