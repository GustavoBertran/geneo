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
import type { Chromosome, GenomeTrackProps, Locus, Track } from '../../genome/types'
import { buildSnapshotSvg, rasterizeSvgToPng, downloadInBrowser } from '../../genome/export'
import { GeneTrack } from './GeneTrack'
import { FeatureTrack } from './FeatureTrack'
import { SignalTrack } from './SignalTrack'
import { SequenceTrack } from './SequenceTrack'

const GUTTER = 140 // px reserved for track labels on the left
const RULER_H = 30
const MARKER_COLOR = '#e8b339'

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

  const [wrapRef, fullWidth] = useWidth()
  const trackWidth = Math.max(120, fullWidth - GUTTER)

  const [locusText, setLocusText] = useState('')
  const [searchText, setSearchText] = useState('')
  const [markerPos, setMarkerPos] = useState('')
  const [markerLabel, setMarkerLabel] = useState('')

  const chrom: Chromosome | undefined = useMemo(
    () => assembly?.chromosomes.find((c) => c.name === locus?.chrom) ?? assembly?.chromosomes[0],
    [assembly, locus?.chrom]
  )

  useEffect(() => {
    if (locus) setLocusText(formatLocus(locus))
  }, [locus])

  const searchIndex = useMemo(() => buildSearchIndex(assembly?.tracks ?? []), [assembly])

  const selected = useMemo(() => {
    if (!selectedGenomeId || !assembly) return null
    for (const t of assembly.tracks) {
      const tr = t.transcripts?.find((x) => x.id === selectedGenomeId)
      if (tr) return { kind: 'transcript' as const, item: tr }
      const f = t.features?.find((x) => x.id === selectedGenomeId)
      if (f) return { kind: 'feature' as const, item: f }
    }
    return null
  }, [assembly, selectedGenomeId])

  // drag-to-pan state
  const drag = useRef<{ x: number; startLocus: Locus } | null>(null)

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

  // Add a position marker. Input is a 1-based coordinate ("7,668,421" or
  // "chr17:7,668,421"); stored 0-based against the relevant chromosome.
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
    const num = parseInt(numPart.replace(/[,\s]/g, ''), 10)
    if (!Number.isFinite(num)) return
    const position = Math.max(0, num - 1) // 1-based -> 0-based
    addMarker({ chrom: chromName, position, label: markerLabel.trim() || formatBp(num), color: MARKER_COLOR })
    setMarkerPos('')
    setMarkerLabel('')
    if (chromName === locus.chrom && (position < locus.start || position >= locus.end)) {
      const span = locus.end - locus.start
      setLocus({ chrom: chromName, start: position - span / 2, end: position + span / 2 })
    }
  }

  const safeName = (): string =>
    `GeneO_${formatLocus(locus)}`.replace(/[:\s]/g, '_').replace(/,/g, '')

  const saveSnapshot = async (format: 'png' | 'svg'): Promise<void> => {
    const root = wrapRef.current
    if (!root) return
    const snapMarkers = markers
      .filter((m) => m.chrom === locus.chrom)
      .map((m) => ({ x: viewport.bpToPx(m.position), label: m.label, color: m.color ?? MARKER_COLOR }))
      .filter((m) => m.x >= -40 && m.x <= trackWidth + 40)
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

  const visibleTracks = assembly.tracks.filter((t) => trackVisibility[t.id] ?? t.visible)
  const ticks = niceTicks(locus.start, locus.end, Math.max(6, Math.round(trackWidth / 110)))
  const visibleMarkers = markers.filter(
    (m) => m.chrom === locus.chrom && m.position >= locus.start && m.position < locus.end
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
          placeholder="position e.g. 7,668,421"
          onChange={(e) => setMarkerPos(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddMarker()}
          spellCheck={false}
          style={{ width: 170, fontFamily: 'var(--mono)', fontSize: 12 }}
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
                title={`${m.chrom}:${formatBp(m.position + 1)}`}
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
          {visibleTracks.map((track) => {
            const Comp = TRACK_COMPONENTS[track.kind]
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
                    gap: 6
                  }}
                >
                  <input
                    type="checkbox"
                    checked={trackVisibility[track.id] ?? track.visible}
                    onChange={() => toggleTrack(track.id)}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ marginTop: 1 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
                    <div className="faint" style={{ fontSize: 9 }}>{track.kind}</div>
                  </div>
                </div>
                <div
                  data-geneo-track-name={track.name}
                  style={{
                    width: trackWidth,
                    overflowX: 'hidden',
                    // tall many-isoform gene tracks scroll within a capped body
                    // so the other tracks stay visible; wheel still zooms.
                    overflowY: track.kind === 'genes' ? 'auto' : 'hidden',
                    maxHeight: track.kind === 'genes' ? 340 : undefined
                  }}
                >
                  {Comp ? (
                    <Comp
                      track={track}
                      chrom={chrom}
                      viewport={viewport}
                      selectedId={selectedGenomeId}
                      hoveredId={hoveredGenomeId}
                      onSelect={setSelectedGenomeId}
                      onHover={setHoveredGenomeId}
                    />
                  ) : null}
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
