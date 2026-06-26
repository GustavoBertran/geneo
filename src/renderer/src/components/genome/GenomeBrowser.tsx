import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@state/store'
import {
  makeViewport,
  zoomLocus,
  panLocus,
  niceTicks,
  formatBp,
  formatSpan,
  formatLocus,
  parseLocusString,
  clampLocus,
  normalizeChromName
} from '../../genome/viewport'
import type { Chromosome, GenomeFeature, GenomeTrackProps, Locus, Track, Transcript } from '../../genome/types'
import { buildSnapshotSvg, rasterizeSvgToPng, downloadInBrowser } from '../../genome/export'
import { ENSEMBL_SPECIES, fetchEnsemblAssembly, ENSEMBL_TRACKS, fetchEnsemblTrack } from '../../genome/ensembl'
import { computeCpgIslands } from '../../genome/compute'
import { makeId } from '@core/sequence'
import { GeneTrack } from './GeneTrack'
import { FeatureTrack } from './FeatureTrack'
import { SignalTrack } from './SignalTrack'
import { SequenceTrack } from './SequenceTrack'

const GUTTER = 140 // px reserved for track labels on the left
const RULER_H = 30
const MARKER_COLOR = '#e8b339'

type GenomeItem =
  | { kind: 'transcript'; item: Transcript; trackName: string }
  | { kind: 'feature'; item: GenomeFeature; trackName: string }

function strandLabel(s: number): string {
  return s === -1 ? '− (reverse)' : s === 1 ? '+ (forward)' : 'unstranded'
}

function loc(chrom: string, start: number, end: number): string {
  return `${chrom}:${(start + 1).toLocaleString()}–${end.toLocaleString()}`
}

function fmtSignal(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && (a < 0.01 || a >= 100000)) return v.toExponential(2)
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

/** Accent color for the popup header swatch. */
function itemColor(g: GenomeItem): string {
  if (g.kind === 'feature') return g.item.color ?? 'var(--accent)'
  return g.item.biotype === 'protein_coding' ? 'var(--accent)' : '#9d6bcf'
}

/** One-line summary for the hover tooltip. */
function itemSummary(g: GenomeItem): string {
  if (g.kind === 'transcript') {
    const t = g.item
    return `${t.geneName ?? t.name}${t.geneName ? ` · ${t.name}` : ''}`
  }
  return g.item.name ?? g.item.type ?? 'feature'
}

/** Full key/value detail rows for the click popup. */
function itemRows(g: GenomeItem): [string, string][] {
  if (g.kind === 'transcript') {
    const t = g.item
    return [
      ['Gene', t.geneName ?? '—'],
      ['Transcript', t.name],
      ['ID', t.id],
      ['Biotype', t.biotype ?? '—'],
      ['Strand', strandLabel(t.strand)],
      ['Location', loc(t.chrom, t.start, t.end)],
      ['Length', `${(t.end - t.start).toLocaleString()} bp`],
      ['Exons', String(t.exons.length)],
      ['CDS blocks', String(t.cds.length)],
      ['Track', g.trackName]
    ]
  }
  const f = g.item
  const rows: [string, string][] = [
    ['Name', f.name ?? '—'],
    ['Type', f.type ?? '—'],
    ['ID', f.id],
    ['Strand', strandLabel(f.strand)],
    ['Location', loc(f.chrom, f.start, f.end)],
    ['Length', `${(f.end - f.start).toLocaleString()} bp`],
    ['Track', g.trackName]
  ]
  if (f.score != null) rows.splice(3, 0, ['Score', String(f.score)])
  if (f.blocks && f.blocks.length) rows.push(['Blocks', String(f.blocks.length)])
  return rows
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(900)
  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) setW(cr.width)
    })
    ro.observe(el)
    setW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Build a name -> locus search index from all tracks. */
function buildSearchIndex(tracks: Track[]): Map<string, Locus> {
  const idx = new Map<string, Locus>()
  for (const t of tracks) {
    for (const tr of t.transcripts ?? []) {
      for (const key of [tr.geneName, tr.name, tr.geneId, tr.id]) {
        if (key) {
          const k = key.toLowerCase()
          const cur = idx.get(k)
          if (cur) idx.set(k, { chrom: tr.chrom, start: Math.min(cur.start, tr.start), end: Math.max(cur.end, tr.end) })
          else idx.set(k, { chrom: tr.chrom, start: tr.start, end: tr.end })
        }
      }
    }
    for (const f of t.features ?? []) {
      if (f.name) idx.set(f.name.toLowerCase(), { chrom: f.chrom, start: f.start, end: f.end })
    }
  }
  return idx
}

const TRACK_COMPONENTS: Record<string, (p: GenomeTrackProps) => JSX.Element> = {
  genes: GeneTrack,
  features: FeatureTrack,
  signal: SignalTrack,
  sequence: SequenceTrack
}

export function GenomeBrowser(): JSX.Element {
  const assembly = useStore((s) => s.assembly)
  const locus = useStore((s) => s.locus)
  const setLocus = useStore((s) => s.setLocus)
  const trackVisibility = useStore((s) => s.trackVisibility)
  const toggleTrack = useStore((s) => s.toggleTrack)
  const selectedGenomeId = useStore((s) => s.selectedGenomeId)
  const setSelectedGenomeId = useStore((s) => s.setSelectedGenomeId)
  const hoveredGenomeId = useStore((s) => s.hoveredGenomeId)
  const setHoveredGenomeId = useStore((s) => s.setHoveredGenomeId)
  const markers = useStore((s) => s.markers)
  const addMarker = useStore((s) => s.addMarker)
  const removeMarker = useStore((s) => s.removeMarker)
  const clearMarkers = useStore((s) => s.clearMarkers)
  const setAssembly = useStore((s) => s.setAssembly)
  const addRecent = useStore((s) => s.addRecent)
  const addTrack = useStore((s) => s.addTrack)
  const removeTrack = useStore((s) => s.removeTrack)

  const [wrapRef, fullWidth] = useWidth()
  const trackWidth = Math.max(120, fullWidth - GUTTER)

  const [locusText, setLocusText] = useState('')
  const [searchText, setSearchText] = useState('')
  const [markerPos, setMarkerPos] = useState('')
  const [markerLabel, setMarkerLabel] = useState('')
  const [species, setSpecies] = useState('homo_sapiens')
  const [fetchQuery, setFetchQuery] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [addingTrack, setAddingTrack] = useState(false)
  const [trackError, setTrackError] = useState<string | null>(null)

  const chrom: Chromosome | undefined = useMemo(
    () => assembly?.chromosomes.find((c) => c.name === locus?.chrom) ?? assembly?.chromosomes[0],
    [assembly, locus?.chrom]
  )

  useEffect(() => {
    if (locus) setLocusText(formatLocus(locus))
  }, [locus])

  // Detail popup anchor + a clicked signal point (declared early; the Esc effect reads them).
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null)
  const [signalPopup, setSignalPopup] = useState<{ trackName: string; color: string; value: number; bp: number } | null>(null)

  // Esc closes the detail popup (feature or signal).
  useEffect(() => {
    if (!selectedGenomeId && !signalPopup) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setSelectedGenomeId(null)
        setSignalPopup(null)
        setPopupAnchor(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedGenomeId, signalPopup, setSelectedGenomeId])

  const searchIndex = useMemo(() => buildSearchIndex(assembly?.tracks ?? []), [assembly])

  const findItem = (id: string | null): GenomeItem | null => {
    if (!id || !assembly) return null
    for (const t of assembly.tracks) {
      const tr = t.transcripts?.find((x) => x.id === id)
      if (tr) return { kind: 'transcript', item: tr, trackName: t.name }
      const f = t.features?.find((x) => x.id === id)
      if (f) return { kind: 'feature', item: f, trackName: t.name }
    }
    return null
  }
  const selected = useMemo(() => findItem(selectedGenomeId), [assembly, selectedGenomeId])
  const hovered = useMemo(() => findItem(hoveredGenomeId), [assembly, hoveredGenomeId])

  // drag-to-pan state
  const drag = useRef<{ x: number; startLocus: Locus } | null>(null)
  // cursor tracking + detail popup anchor (relative to the browser root)
  const rootRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  if (!assembly || !locus || !chrom) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 18, fontWeight: 600 }}>Genome Browser</div>
        <div className="dim">Load a genome (GFF3 / BED / bedGraph / FASTA) to begin.</div>
      </div>
    )
  }

  const viewport = makeViewport(locus, trackWidth)

  const onGo = (): void => {
    const parsed = parseLocusString(locusText, assembly.chromosomes.map((c) => c.name))
    if (parsed) {
      const target = parsed.end > parsed.start ? parsed : { ...parsed, start: 0, end: chrom.length }
      setLocus(target)
    }
  }

  const onSearch = (): void => {
    const q = searchText.trim().toLowerCase()
    if (!q) return
    let hit = searchIndex.get(q)
    if (!hit) {
      for (const [k, v] of searchIndex) {
        if (k.startsWith(q)) { hit = v; break }
      }
    }
    if (hit) {
      const pad = Math.max(200, Math.round((hit.end - hit.start) * 0.1))
      setLocus({ chrom: hit.chrom, start: hit.start - pad, end: hit.end + pad })
    }
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const localX = e.clientX - rect.left
    const anchorBp = viewport.pxToBp(localX)
    const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25
    setLocus(zoomLocus(locus, factor, anchorBp, chrom))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, startLocus: locus }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const dxPx = e.clientX - drag.current.x
    const dxBp = -dxPx / viewport.pxPerBp
    const sl = drag.current.startLocus
    setLocus(clampLocus({ chrom: sl.chrom, start: sl.start + dxBp, end: sl.end + dxBp }, chrom))
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    drag.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }

  // Track the cursor (relative to the browser root) and move the hover tooltip
  // imperatively, so following the cursor doesn't re-render the heavy tracks.
  const onRootMouseMove = (e: React.MouseEvent): void => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    mousePosRef.current = { x, y }
    const tip = tooltipRef.current
    if (tip) {
      const flipX = x > rect.width - 260
      tip.style.transform = `translate(${flipX ? x - 250 : x + 14}px, ${y + 16}px)`
    }
  }

  // Clicking a feature selects it AND opens the detail popup at the cursor.
  const onSelectFeature = (id: string | null): void => {
    setSignalPopup(null)
    setSelectedGenomeId(id)
    setPopupAnchor(id ? { ...mousePosRef.current } : null)
  }

  // Clicking a signal track opens the same popup with the value at that point.
  const onSignalSelect = (track: Track, probe: { value: number; bp: number }): void => {
    setSelectedGenomeId(null)
    setSignalPopup({ trackName: track.name, color: track.color || 'var(--good)', value: probe.value, bp: probe.bp })
    setPopupAnchor({ ...mousePosRef.current })
  }

  const closePopup = (): void => {
    setSelectedGenomeId(null)
    setSignalPopup(null)
    setPopupAnchor(null)
  }

  // The popup renders from either a selected feature/transcript or a signal point.
  const popupModel: { color: string; title: string; rows: [string, string][] } | null = selected
    ? { color: itemColor(selected), title: itemSummary(selected), rows: itemRows(selected) }
    : signalPopup
      ? {
          color: signalPopup.color,
          title: signalPopup.trackName,
          rows: [
            ['Track', signalPopup.trackName],
            ['Value', fmtSignal(signalPopup.value)],
            ['Position', `${locus.chrom}:${(signalPopup.bp + 1).toLocaleString()}`],
            ['Type', 'signal (quantitative)']
          ]
        }
      : null

  // Add a marker. Input is a 1-based coordinate ("7,668,421" or
  // "chr17:7,668,421") for a vertical rule, OR a 1-based range
  // ("7,668,421-7,669,000") for a highlighted bar. Stored 0-based.
  const onAddMarker = (): void => {
    const raw = markerPos.trim()
    if (!raw) return
    let chromName = locus.chrom
    let numPart = raw
    if (raw.includes(':')) {
      const [c, n] = raw.split(':')
      const resolved = normalizeChromName(c.trim())
      if (assembly.chromosomes.some((x) => x.name === resolved)) chromName = resolved
      numPart = n ?? ''
    }
    let position: number
    let end: number | undefined
    let defaultLabel: string
    const rangeMatch = numPart.replace(/\s/g, '').match(/^([\d,]+)(?:-|\.\.)([\d,]+)$/)
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1].replace(/,/g, ''), 10)
      const b = parseInt(rangeMatch[2].replace(/,/g, ''), 10)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      position = Math.max(0, lo - 1)
      end = hi
      defaultLabel = `${formatBp(lo)}–${formatBp(hi)}`
    } else {
      const num = parseInt(numPart.replace(/[,\s]/g, ''), 10)
      if (!Number.isFinite(num)) return
      position = Math.max(0, num - 1)
      defaultLabel = formatBp(num)
    }
    addMarker({ chrom: chromName, position, end, label: markerLabel.trim() || defaultLabel, color: MARKER_COLOR })
    setMarkerPos('')
    setMarkerLabel('')
    const mid = end != null ? (position + end) / 2 : position
    if (chromName === locus.chrom && (mid < locus.start || mid >= locus.end)) {
      const span = locus.end - locus.start
      setLocus({ chrom: chromName, start: mid - span / 2, end: mid + span / 2 })
    }
  }

  // Fetch a region (locus or gene symbol) on demand from Ensembl.
  const onFetch = async (): Promise<void> => {
    const q = fetchQuery.trim()
    if (!q || fetching) return
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetchEnsemblAssembly(species, q)
      if (res.error || !res.assembly) {
        setFetchError(res.error ?? 'Fetch failed')
        return
      }
      setAssembly(res.assembly)
      addRecent({
        kind: 'genome',
        name: res.assembly.name,
        subtitle: res.assembly.defaultLocus?.chrom ?? res.assembly.chromosomes[0]?.name ?? '',
        source: { type: 'ensembl', species, query: q }
      })
      setFetchQuery('')
    } catch (e) {
      setFetchError((e as Error).message)
    } finally {
      setFetching(false)
    }
  }

  // Add an annotation track for the current region (Ensembl-fetched or computed).
  const onAddTrack = async (specId: string): Promise<void> => {
    const spec = ENSEMBL_TRACKS.find((t) => t.id === specId)
    if (!spec) return
    setTrackError(null)
    if (spec.computed) {
      const features = computeCpgIslands(chrom)
      if (features.length === 0) {
        setTrackError('No CpG islands found in the loaded sequence window.')
        return
      }
      addTrack({ id: makeId('trk_cpg'), name: spec.name, kind: 'features', visible: true, color: spec.color, features })
      return
    }
    setAddingTrack(true)
    try {
      const sp = assembly.species ?? species
      const res = await fetchEnsemblTrack(sp, locus.chrom, locus.start + 1, locus.end, spec)
      if (res.error || !res.track) {
        setTrackError(res.error ?? 'Could not add track')
        return
      }
      addTrack(res.track)
    } finally {
      setAddingTrack(false)
    }
  }

  const safeName = (): string =>
    `GeneO_${formatLocus(locus)}`.replace(/[:\s]/g, '_').replace(/,/g, '')

  const saveSnapshot = async (format: 'png' | 'svg'): Promise<void> => {
    const root = wrapRef.current
    if (!root) return
    const snapMarkers = markers
      .filter((m) => m.chrom === locus.chrom)
      .map((m) => ({
        x: viewport.bpToPx(m.position),
        x2: m.end != null && m.end > m.position ? viewport.bpToPx(m.end) : undefined,
        label: m.label,
        color: m.color ?? MARKER_COLOR
      }))
      .filter((m) => (m.x2 ?? m.x) >= -40 && m.x <= trackWidth + 40)
    const { svg, width, height } = buildSnapshotSvg(root, {
      gutter: GUTTER,
      trackWidth,
      rulerHeight: RULER_H,
      chromName: chrom.name,
      locusLabel: formatLocus(locus),
      markers: snapMarkers
    })
    const hasNativeImage = typeof window.api?.saveImage === 'function'
    const hasNativeSave = typeof window.api?.saveFile === 'function'
    try {
      if (format === 'png') {
        const dataUrl = await rasterizeSvgToPng(svg, width, height, 2)
        if (hasNativeImage) await window.api.saveImage({ dataUrl, defaultName: safeName() + '.png' })
        else downloadInBrowser(dataUrl, safeName() + '.png', 'image/png')
      } else {
        if (hasNativeSave) {
          await window.api.saveFile({
            content: svg,
            defaultName: safeName() + '.svg',
            filters: [{ name: 'SVG image', extensions: ['svg'] }]
          })
        } else downloadInBrowser(svg, safeName() + '.svg', 'image/svg+xml')
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Export failed: ${(err as Error).message}`)
    }
  }

  const ticks = niceTicks(locus.start, locus.end, Math.max(6, Math.round(trackWidth / 110)))
  const visibleMarkers = markers.filter((m) => {
    if (m.chrom !== locus.chrom) return false
    const mEnd = m.end != null && m.end > m.position ? m.end : m.position + 1
    return m.position < locus.end && mEnd > locus.start
  })

  return (
    <div
      ref={rootRef}
      onMouseMove={onRootMouseMove}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}
    >
      {/* Navigation bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          flexWrap: 'wrap'
        }}
      >
        {assembly.chromosomes.length > 1 && (
          <select
            value={locus.chrom}
            onChange={(e) => {
              const c = assembly.chromosomes.find((x) => x.name === e.target.value)
              if (c) setLocus({ chrom: c.name, start: c.seq?.start ?? 0, end: (c.seq?.start ?? 0) + (c.seq?.bases.length ?? Math.min(c.length, 1_000_000)) })
            }}
          >
            {assembly.chromosomes.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        )}
        <input
          value={locusText}
          onChange={(e) => setLocusText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onGo()}
          spellCheck={false}
          style={{ width: 240, fontFamily: 'var(--mono)', fontSize: 12 }}
          title="Locus, e.g. chr17:7,668,000-7,688,000"
        />
        <button onClick={onGo}>Go</button>
        <input
          value={searchText}
          placeholder="Find gene…"
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          spellCheck={false}
          style={{ width: 130 }}
        />
        <div className="row" style={{ gap: 2 }}>
          <button title="Pan left" onClick={() => setLocus(panLocus(locus, -0.4, chrom))}>◀</button>
          <button title="Zoom out" onClick={() => setLocus(zoomLocus(locus, 2, (locus.start + locus.end) / 2, chrom))}>−</button>
          <button title="Zoom in" onClick={() => setLocus(zoomLocus(locus, 0.5, (locus.start + locus.end) / 2, chrom))}>+</button>
          <button title="Pan right" onClick={() => setLocus(panLocus(locus, 0.4, chrom))}>▶</button>
        </div>

        {/* On-demand fetch from Ensembl (any locus / gene, any species) */}
        <div className="row" style={{ gap: 4, paddingLeft: 8, borderLeft: '1px solid var(--border)' }}>
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            title="Ensembl species"
            style={{ fontSize: 12, maxWidth: 150 }}
          >
            {ENSEMBL_SPECIES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <input
            value={fetchQuery}
            placeholder="gene or locus"
            onChange={(e) => { setFetchQuery(e.target.value); setFetchError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && onFetch()}
            spellCheck={false}
            title="Fetch a region from Ensembl — a gene symbol (BRCA1) or a locus (chr16:23,641,000-23,641,800)"
            style={{ width: 168 }}
          />
          <button className="primary" onClick={onFetch} disabled={fetching || !fetchQuery.trim()} title="Download this region from Ensembl">
            {fetching ? 'Fetching…' : 'Fetch ⤓'}
          </button>
        </div>
        {fetchError && (
          <span style={{ color: 'var(--bad)', fontSize: 11, maxWidth: 280 }}>{fetchError}</span>
        )}

        <span className="spacer" />
        <span className="tag" style={{ fontFamily: 'var(--mono)' }}>{formatSpan(locus.end - locus.start)}</span>
      </div>

      {/* Markers + export row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          flexWrap: 'wrap'
        }}
      >
        <span className="faint" style={{ fontSize: 11 }}>Marker</span>
        <input
          value={markerPos}
          placeholder="position or range"
          title="A single position (7,668,421) draws a line; a range (7,668,421-7,669,000) draws a highlighted bar. Optional chrom prefix, e.g. chr16:23,641,000-23,641,800."
          onChange={(e) => setMarkerPos(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddMarker()}
          spellCheck={false}
          style={{ width: 200, fontFamily: 'var(--mono)', fontSize: 12 }}
        />
        <input
          value={markerLabel}
          placeholder="label (optional)"
          onChange={(e) => setMarkerLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddMarker()}
          spellCheck={false}
          style={{ width: 130, fontSize: 12 }}
        />
        <button onClick={onAddMarker}>Add</button>

        {markers.length > 0 && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {markers.map((m) => (
              <span
                key={m.id}
                className="tag"
                title={
                  m.end != null && m.end > m.position
                    ? `${m.chrom}:${formatBp(m.position + 1)}–${formatBp(m.end)}`
                    : `${m.chrom}:${formatBp(m.position + 1)}`
                }
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-active)' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color ?? MARKER_COLOR }} />
                {m.label}
                <button
                  className="ghost"
                  onClick={() => removeMarker(m.id)}
                  style={{ padding: '0 3px', lineHeight: 1, color: 'var(--text-faint)' }}
                  title="Remove marker"
                >×</button>
              </span>
            ))}
            <button className="ghost" onClick={clearMarkers} style={{ fontSize: 11, color: 'var(--text-faint)' }}>Clear all</button>
          </div>
        )}

        <span className="spacer" />
        {trackError && <span style={{ color: 'var(--bad)', fontSize: 11, maxWidth: 300 }}>{trackError}</span>}
        <select
          value=""
          title="Add an annotation track for the current region"
          disabled={addingTrack}
          onChange={(e) => {
            const v = e.target.value
            e.target.value = ''
            if (v) void onAddTrack(v)
          }}
          style={{ background: 'var(--bg-input)', fontSize: 12 }}
        >
          <option value="">{addingTrack ? 'Adding…' : '+ Track ▾'}</option>
          <optgroup label="Ensembl (this region)">
            {ENSEMBL_TRACKS.filter((t) => !t.computed).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
          <optgroup label="Computed">
            {ENSEMBL_TRACKS.filter((t) => t.computed).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        </select>
        <button onClick={() => void saveSnapshot('png')} title="Export the current view as a PNG image">Export PNG</button>
        <button onClick={() => void saveSnapshot('svg')} title="Export the current view as an SVG">Export SVG</button>
      </div>

      {/* Track area (relative wrapper hosts the non-scrolling marker overlay) */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={wrapRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, background: 'var(--bg)' }}>
        {/* ruler */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: GUTTER, flexShrink: 0, fontSize: 10, color: 'var(--text-faint)', padding: '8px', borderRight: '1px solid var(--border)' }}>
            {chrom.name}
          </div>
          <svg width={trackWidth} height={RULER_H} data-geneo-ruler="true" style={{ display: 'block' }}>
            {ticks.map((t) => {
              const x = viewport.bpToPx(t.pos)
              return (
                <g key={t.pos}>
                  <line x1={x} y1={RULER_H - 8} x2={x} y2={RULER_H} stroke="var(--border-strong)" />
                  <text x={x + 3} y={RULER_H - 11} fontSize={10} fill="var(--text-faint)" fontFamily="var(--mono)">{formatBp(t.pos)}</text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* tracks */}
        <div
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
        >
          {/* Every track keeps its gutter + checkbox even when hidden, so it can
              always be toggled back on; only its content collapses when off. */}
          {assembly.tracks.map((track) => {
            const Comp = TRACK_COMPONENTS[track.kind]
            const isVisible = trackVisibility[track.id] ?? track.visible
            return (
              <div key={track.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                <div
                  style={{
                    width: GUTTER,
                    flexShrink: 0,
                    padding: '6px 8px',
                    borderRight: '1px solid var(--border)',
                    background: 'var(--bg-panel)',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    opacity: isVisible ? 1 : 0.6
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleTrack(track.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={isVisible ? `Hide ${track.name}` : `Show ${track.name}`}
                    style={{ marginTop: 1 }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
                    <div className="faint" style={{ fontSize: 9 }}>{track.kind}</div>
                  </div>
                  <button
                    className="ghost"
                    onClick={() => removeTrack(track.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    title={`Remove ${track.name}`}
                    style={{ padding: '0 3px', marginTop: -1, lineHeight: 1, color: 'var(--text-faint)', fontSize: 13 }}
                  >×</button>
                </div>
                <div
                  // only tag VISIBLE tracks so snapshot export skips hidden ones
                  data-geneo-track-name={isVisible ? track.name : undefined}
                  style={{
                    width: trackWidth,
                    overflowX: 'hidden',
                    overflowY: isVisible && track.kind === 'genes' ? 'auto' : 'hidden',
                    maxHeight: isVisible && track.kind === 'genes' ? 340 : undefined
                  }}
                >
                  {isVisible && Comp ? (
                    <Comp
                      track={track}
                      chrom={chrom}
                      viewport={viewport}
                      selectedId={selectedGenomeId}
                      hoveredId={hoveredGenomeId}
                      onSelect={onSelectFeature}
                      onHover={setHoveredGenomeId}
                      onSignalSelect={(probe) => onSignalSelect(track, probe)}
                    />
                  ) : (
                    <div style={{ height: 20, display: 'flex', alignItems: 'center', paddingLeft: 8, color: 'var(--text-faint)', fontSize: 10 }}>
                      hidden — tick the box to show
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {/* sequence track is implicit at the bottom when zoomed in */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: GUTTER, flexShrink: 0, padding: '6px 8px', borderRight: '1px solid var(--border)', background: 'var(--bg-panel)', fontSize: 11 }}>
              <div style={{ fontWeight: 600 }}>Sequence</div>
              <div className="faint" style={{ fontSize: 9 }}>reference</div>
            </div>
            <div data-geneo-track-name="Sequence" style={{ width: trackWidth, overflow: 'hidden' }}>
              <SequenceTrack
                track={{ id: 'seq', name: 'Sequence', kind: 'sequence', visible: true }}
                chrom={chrom}
                viewport={viewport}
                selectedId={selectedGenomeId}
                hoveredId={hoveredGenomeId}
                onSelect={setSelectedGenomeId}
                onHover={setHoveredGenomeId}
              />
            </div>
          </div>
        </div>
      </div>
      {/* Position markers — non-scrolling overlay of labeled vertical rules */}
      {visibleMarkers.length > 0 && (
        <div style={{ position: 'absolute', top: 0, left: GUTTER, width: trackWidth, bottom: 0, pointerEvents: 'none' }}>
          <svg width={trackWidth} height="100%" style={{ display: 'block' }}>
            {visibleMarkers.map((m) => {
              const x = viewport.bpToPx(m.position)
              const color = m.color ?? MARKER_COLOR
              const isRange = m.end != null && m.end > m.position
              if (isRange) {
                const x2 = viewport.bpToPx(m.end as number)
                const left = Math.max(-1, Math.min(x, x2))
                const right = Math.min(trackWidth + 1, Math.max(x, x2))
                return (
                  <g key={m.id}>
                    <rect x={left} y={RULER_H} width={Math.max(1, right - left)} height="100%" fill={color} fillOpacity={0.13} />
                    <line x1={left} y1={RULER_H} x2={left} y2="100%" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
                    <line x1={right} y1={RULER_H} x2={right} y2="100%" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
                    <rect x={left} y={RULER_H} width={Math.max(1, right - left)} height={5} fill={color} />
                    <text x={left + 4} y={RULER_H + 14} fontSize={10} fill={color} stroke="var(--bg)" strokeWidth={3} style={{ paintOrder: 'stroke' }}>{m.label}</text>
                  </g>
                )
              }
              return (
                <g key={m.id}>
                  <line x1={x} y1={RULER_H} x2={x} y2="100%" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
                  <path d={`M ${x - 4} ${RULER_H} L ${x + 4} ${RULER_H} L ${x} ${RULER_H + 6} Z`} fill={color} />
                  <text x={x + 5} y={RULER_H + 13} fontSize={10} fill={color} stroke="var(--bg)" strokeWidth={3} style={{ paintOrder: 'stroke' }}>{m.label}</text>
                </g>
              )
            })}
          </svg>
        </div>
      )}
      </div>

      {/* Hover tooltip — follows the cursor (position updated imperatively) */}
      {hovered && (
        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `translate(${mousePosRef.current.x + 14}px, ${mousePosRef.current.y + 16}px)`,
            pointerEvents: 'none',
            zIndex: 50,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 9px',
            boxShadow: 'var(--shadow)',
            maxWidth: 260
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemSummary(hovered)}</div>
          <div className="dim" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>{loc(hovered.item.chrom, hovered.item.start, hovered.item.end)}</div>
          <div className="faint" style={{ fontSize: 10 }}>
            {hovered.kind === 'transcript' ? hovered.item.biotype ?? 'transcript' : hovered.trackName} · {strandLabel(hovered.item.strand)} · click for details
          </div>
        </div>
      )}

      {/* Click detail popup — full info, dismissable (feature/transcript or signal point) */}
      {popupModel && popupAnchor && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(popupAnchor.x + 8, (rootRef.current?.clientWidth ?? 900) - 286)),
            top: Math.max(8, Math.min(popupAnchor.y + 8, (rootRef.current?.clientHeight ?? 600) - 300)),
            zIndex: 60,
            width: 278,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
            overflow: 'hidden'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: popupModel.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{popupModel.title}</span>
            <button className="ghost" onClick={closePopup} title="Close (Esc)" style={{ padding: '0 5px', lineHeight: 1, fontSize: 15, color: 'var(--text-faint)' }}>×</button>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
              <tbody>
                {popupModel.rows.map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: 'var(--text-faint)', padding: '3px 10px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{k}</td>
                    <td style={{ padding: '3px 10px', wordBreak: 'break-all', fontFamily: k === 'Location' || k === 'ID' || k === 'Position' ? 'var(--mono)' : undefined }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer: selection details */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '5px 14px',
          fontSize: 11,
          color: 'var(--text-dim)',
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border)'
        }}
      >
        {selected ? (
          selected.kind === 'transcript' ? (
            <>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{selected.item.geneName ?? selected.item.name}</span>
              <span className="mono">{selected.item.name}</span>
              <span>{selected.item.strand === -1 ? '− strand' : selected.item.strand === 1 ? '+ strand' : 'unstranded'}</span>
              {selected.item.biotype && <span className="tag">{selected.item.biotype}</span>}
              <span className="mono">{formatLocus({ chrom: selected.item.chrom, start: selected.item.start, end: selected.item.end })}</span>
              <span>{selected.item.exons.length} exons</span>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{selected.item.name ?? selected.item.type ?? 'feature'}</span>
              <span className="mono">{formatLocus({ chrom: selected.item.chrom, start: selected.item.start, end: selected.item.end })}</span>
              {selected.item.score != null && <span>score {selected.item.score}</span>}
            </>
          )
        ) : (
          <span className="faint">Scroll to zoom · drag to pan · click a feature for details</span>
        )}
        <span className="spacer" />
        <span className="mono">{formatLocus(locus)}</span>
      </div>
    </div>
  )
}
