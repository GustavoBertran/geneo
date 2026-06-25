import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@state/store'
import { useCutSites } from '../hooks/derived'
import { featureColor, isDirectional } from '@core/featureStyle'
import { spanLength } from '@core/sequence'
import type { CutSite, Feature, SeqRecord } from '@core/types'

// ---------------------------------------------------------------------------
// Layout constants (1:1 pixel coordinate model — no SVG scaling, so the zoom
// control genuinely widens the canvas and enables horizontal scroll).
// ---------------------------------------------------------------------------
const MARGIN = 44
const BACKBONE_H = 8
const LANE_H = 22
const LANE_GAP = 5
const FEATURE_H = 16
const ENZYME_TICK_H = 18
const ENZYME_LABEL_ROW_H = 13
const RULER_H = 30
const TOP_PAD = 10
const SIDE_BAND_GAP = 14 // gap between backbone and first feature lane

const ARROW_HEAD = 7 // px of the arrow point

interface Block {
  feature: Feature
  /** 0-based half-open span on the top strand (already un-wrapped). */
  segStart: number
  segEnd: number
  /** true if this block is one half of an origin-wrapping feature. */
  wrapped: boolean
  /** does the arrow head sit at this block's drawn end? */
  showHead: boolean
  lane: number
}

interface PackedSide {
  blocks: Block[]
  laneCount: number
}

/** Pick a readable text color (black/white) against a hex fill. */
function contrastText(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '#000'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.58 ? '#1a1a1a' : '#ffffff'
}

/** Nice round tick step so we get ~8–12 labelled ticks. */
function tickStep(len: number): number {
  const target = len / 10
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1))))
  const candidates = [1, 2, 5, 10].map((m) => m * pow)
  let best = candidates[0]
  for (const c of candidates) if (Math.abs(c - target) < Math.abs(best - target)) best = c
  return Math.max(best, 1)
}

/**
 * Expand a record's features into drawable blocks, splitting origin-wrapping
 * circular features into two segments. Returns blocks already separated by side.
 */
function explodeFeatures(record: SeqRecord): { fwd: Block[]; rev: Block[] } {
  const len = record.sequence.length
  const fwd: Block[] = []
  const rev: Block[] = []
  for (const feature of record.features) {
    const directional = isDirectional(feature.type)
    const wraps = record.topology === 'circular' && feature.end < feature.start
    const list = feature.strand === -1 ? rev : fwd
    if (wraps) {
      // segment A: [start, len) ; segment B: [0, end)
      // Arrow head is at the 3' end of the feature in genomic order.
      list.push({
        feature,
        segStart: feature.start,
        segEnd: len,
        wrapped: true,
        showHead: directional && feature.strand === -1, // reverse head at left of first seg
        lane: 0
      })
      list.push({
        feature,
        segStart: 0,
        segEnd: feature.end,
        wrapped: true,
        showHead: directional && feature.strand === 1, // forward head at right end
        lane: 0
      })
    } else {
      const s = Math.max(0, Math.min(feature.start, len))
      const e = Math.max(s, Math.min(feature.end, len))
      list.push({
        feature,
        segStart: s,
        segEnd: e,
        wrapped: false,
        showHead: directional,
        lane: 0
      })
    }
  }
  return { fwd, rev }
}

/** Greedy lane packing: place each block in the first lane it fits (by bp span). */
function packLanes(blocks: Block[]): PackedSide {
  const sorted = [...blocks].sort((a, b) => a.segStart - b.segStart || b.segEnd - a.segEnd)
  const laneEnds: number[] = []
  for (const blk of sorted) {
    let placed = false
    for (let i = 0; i < laneEnds.length; i++) {
      if (blk.segStart >= laneEnds[i]) {
        blk.lane = i
        laneEnds[i] = blk.segEnd
        placed = true
        break
      }
    }
    if (!placed) {
      blk.lane = laneEnds.length
      laneEnds.push(blk.segEnd)
    }
  }
  return { blocks: sorted, laneCount: laneEnds.length }
}

export function LinearMap(): JSX.Element {
  const record = useStore((s) => s.record)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const selectedFeatureId = useStore((s) => s.selectedFeatureId)
  const setSelectedFeatureId = useStore((s) => s.setSelectedFeatureId)
  const hoveredFeatureId = useStore((s) => s.hoveredFeatureId)
  const setHoveredFeatureId = useStore((s) => s.setHoveredFeatureId)
  const showEnzymeSites = useStore((s) => s.showEnzymeSites)
  const setShowEnzymeSites = useStore((s) => s.setShowEnzymeSites)
  const cutSites = useCutSites()

  const [zoom, setZoom] = useState(1)
  const [containerW, setContainerW] = useState(900)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // drag state
  const dragRef = useRef<{ anchor: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  // --- measure the container -------------------------------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        if (w > 0) setContainerW(w)
      }
    })
    ro.observe(el)
    setContainerW(el.clientWidth || 900)
    return () => ro.disconnect()
  }, [])

  const len = record?.sequence.length ?? 0
  const pixelWidth = Math.max(containerW * zoom, containerW)
  const innerWidth = Math.max(pixelWidth - MARGIN * 2, 10)

  const xFor = useCallback(
    (pos: number) => MARGIN + (pos / Math.max(len, 1)) * innerWidth,
    [len, innerWidth]
  )

  // --- pack features ---------------------------------------------------------
  const { fwd, rev, fwdLanes, revLanes } = useMemo(() => {
    if (!record) return { fwd: [] as Block[], rev: [] as Block[], fwdLanes: 0, revLanes: 0 }
    const exploded = explodeFeatures(record)
    const f = packLanes(exploded.fwd)
    const r = packLanes(exploded.rev)
    return { fwd: f.blocks, rev: r.blocks, fwdLanes: f.laneCount, revLanes: r.laneCount }
  }, [record])

  // --- enzyme label de-collision (stacked rows) ------------------------------
  const enzymeLayout = useMemo(() => {
    if (!record || !showEnzymeSites) return { items: [] as { site: CutSite; x: number; row: number }[], rows: 0 }
    const sorted = [...cutSites].sort((a, b) => a.cutPosTop - b.cutPosTop)
    const rowLastX: number[] = []
    const items = sorted.map((site) => {
      const x = MARGIN + (site.cutPosTop / Math.max(len, 1)) * innerWidth
      const labelW = site.enzyme.length * 6.4 + 10
      let row = 0
      while (row < rowLastX.length && x - rowLastX[row] < labelW) row++
      rowLastX[row] = x
      return { site, x, row }
    })
    return { items, rows: rowLastX.length }
  }, [record, cutSites, showEnzymeSites, len, innerWidth])

  // --- vertical geometry -----------------------------------------------------
  const enzymeBandH = enzymeLayout.rows > 0
    ? ENZYME_TICK_H + enzymeLayout.rows * ENZYME_LABEL_ROW_H + 6
    : 0
  const fwdBandH = fwdLanes > 0 ? fwdLanes * LANE_H + SIDE_BAND_GAP : SIDE_BAND_GAP
  const revBandH = revLanes > 0 ? revLanes * LANE_H + SIDE_BAND_GAP : SIDE_BAND_GAP

  const yEnzymeTop = TOP_PAD
  const yBackbone = yEnzymeTop + enzymeBandH + fwdBandH
  const yRevStart = yBackbone + BACKBONE_H + SIDE_BAND_GAP
  const yRuler = yRevStart + (revLanes > 0 ? revLanes * LANE_H : 0) + 4
  const contentHeight = yRuler + RULER_H + 10

  // y for a forward lane (lanes stack upward from backbone)
  const fwdLaneY = (lane: number): number =>
    yBackbone - SIDE_BAND_GAP - (lane + 1) * LANE_H + (LANE_H - FEATURE_H) / 2 + LANE_GAP
  const revLaneY = (lane: number): number =>
    yRevStart + lane * LANE_H + (LANE_H - FEATURE_H) / 2

  // --- position from mouse x -------------------------------------------------
  const posFromEvent = useCallback(
    (clientX: number): number => {
      const svg = svgRef.current
      if (!svg) return 0
      const rect = svg.getBoundingClientRect()
      const x = clientX - rect.left
      const raw = ((x - MARGIN) / innerWidth) * len
      return Math.max(0, Math.min(Math.round(raw), len))
    },
    [innerWidth, len]
  )

  // --- background drag-select ------------------------------------------------
  const onBackgroundDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const anchor = posFromEvent(e.clientX)
      dragRef.current = { anchor, moved: false }
      setDragging(true)
    },
    [posFromEvent]
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      const cur = posFromEvent(e.clientX)
      if (Math.abs(cur - d.anchor) >= 1) d.moved = true
      if (d.moved) {
        const start = Math.min(d.anchor, cur)
        const end = Math.max(d.anchor, cur)
        if (end > start) setSelection({ start, end })
      }
    }
    const onUp = (e: MouseEvent): void => {
      const d = dragRef.current
      if (d && !d.moved) {
        // treated as an empty click — clear selection + feature
        setSelection(null)
        setSelectedFeatureId(null)
      }
      dragRef.current = null
      setDragging(false)
      void e
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, posFromEvent, setSelection, setSelectedFeatureId])

  const onFeatureClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      setSelectedFeatureId(selectedFeatureId === id ? null : id)
    },
    [selectedFeatureId, setSelectedFeatureId]
  )

  // ---------------------------------------------------------------------------
  if (!record || len === 0) {
    return (
      <div className="empty-state">
        <div className="dim">No sequence loaded</div>
        <div className="faint" style={{ fontSize: 12 }}>
          Open a record to see its linear map.
        </div>
      </div>
    )
  }

  // ---- build feature block paths -------------------------------------------
  function renderBlock(blk: Block, side: 'fwd' | 'rev'): JSX.Element {
    const f = blk.feature
    const x0 = xFor(blk.segStart)
    const x1 = xFor(blk.segEnd)
    const w = Math.max(x1 - x0, 1.5)
    const y = side === 'fwd' ? fwdLaneY(blk.lane) : revLaneY(blk.lane)
    const color = featureColor(f)
    const isSel = f.id === selectedFeatureId
    const isHov = f.id === hoveredFeatureId
    const head = blk.showHead && w > ARROW_HEAD + 3 ? ARROW_HEAD : 0
    const forward = f.strand === 1

    // arrow polygon (block-arrow). Forward points right, reverse points left.
    let shape: JSX.Element
    if (head > 0) {
      const pts = forward
        ? `${x0},${y} ${x0 + w - head},${y} ${x0 + w},${y + FEATURE_H / 2} ${x0 + w - head},${y + FEATURE_H} ${x0},${y + FEATURE_H}`
        : `${x0 + w},${y} ${x0 + head},${y} ${x0},${y + FEATURE_H / 2} ${x0 + head},${y + FEATURE_H} ${x0 + w},${y + FEATURE_H}`
      shape = (
        <polygon
          points={pts}
          fill={color}
          stroke={isSel ? 'var(--accent-strong)' : isHov ? 'var(--border-strong)' : 'rgba(0,0,0,0.35)'}
          strokeWidth={isSel ? 2 : 1}
        />
      )
    } else {
      shape = (
        <rect
          x={x0}
          y={y}
          width={w}
          height={FEATURE_H}
          rx={2}
          fill={color}
          stroke={isSel ? 'var(--accent-strong)' : isHov ? 'var(--border-strong)' : 'rgba(0,0,0,0.35)'}
          strokeWidth={isSel ? 2 : 1}
        />
      )
    }

    // label: inside if it fits, else above (only on the first/primary segment)
    const labelW = f.name.length * 6.4
    const fitsInside = labelW + 8 < w - head
    const isPrimarySeg = !blk.wrapped || blk.segStart === f.start
    const showLabel = isPrimarySeg
    const labelInside = fitsInside

    return (
      <g
        key={`${f.id}-${blk.segStart}-${side}`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => onFeatureClick(e, f.id)}
        onMouseEnter={() => setHoveredFeatureId(f.id)}
        onMouseLeave={() => {
          if (hoveredFeatureId === f.id) setHoveredFeatureId(null)
        }}
        opacity={hoveredFeatureId && !isHov && !isSel ? 0.82 : 1}
      >
        {(isSel || isHov) && (
          <rect
            x={x0 - 2}
            y={y - 2}
            width={w + 4}
            height={FEATURE_H + 4}
            rx={3}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={isSel ? 1.5 : 1}
            strokeOpacity={isSel ? 0.9 : 0.5}
          />
        )}
        {shape}
        {showLabel && labelInside && (
          <text
            x={x0 + (forward ? 6 : head + 6)}
            y={y + FEATURE_H / 2 + 3.5}
            fontSize={10.5}
            fontFamily="var(--sans)"
            fill={contrastText(color)}
            style={{ pointerEvents: 'none' }}
          >
            {f.name}
          </text>
        )}
        {showLabel && !labelInside && (
          <text
            x={x0 + w / 2}
            y={side === 'fwd' ? y - 4 : y + FEATURE_H + 11}
            fontSize={10.5}
            textAnchor="middle"
            fontFamily="var(--sans)"
            fill={isSel ? 'var(--accent-strong)' : 'var(--text-dim)'}
            style={{ pointerEvents: 'none' }}
          >
            {f.name}
          </text>
        )}
        {blk.wrapped && isPrimarySeg && (
          <title>{`${f.name} — wraps the origin`}</title>
        )}
      </g>
    )
  }

  // ---- ruler ----------------------------------------------------------------
  const step = tickStep(len)
  const ticks: number[] = []
  for (let p = 0; p <= len; p += step) ticks.push(p)
  if (ticks[ticks.length - 1] !== len) ticks.push(len)

  // ---- selection band -------------------------------------------------------
  const selBand =
    selection && selection.end > selection.start ? (
      <>
        <rect
          x={xFor(selection.start)}
          y={yEnzymeTop}
          width={Math.max(xFor(selection.end) - xFor(selection.start), 1)}
          height={yRuler - yEnzymeTop + 6}
          fill="var(--accent-soft)"
          stroke="var(--accent)"
          strokeOpacity={0.5}
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      </>
    ) : null

  const selLen = selection ? spanLength(selection.start, selection.end, len, record.topology) : 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg)'
      }}
    >
      {/* toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          flexShrink: 0
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>{record.name}</div>
        <span className="tag">{len.toLocaleString()} bp</span>
        <span className="tag">{record.topology}</span>
        <div className="spacer" style={{ flex: 1 }} />
        {selection && selLen > 0 && (
          <span className="mono dim" style={{ fontSize: 12 }}>
            {selection.start + 1}–{selection.end} ({selLen.toLocaleString()} bp)
          </span>
        )}
        <label
          className="row"
          style={{ gap: 5, fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer' }}
        >
          <input
            type="checkbox"
            checked={showEnzymeSites}
            onChange={(e) => setShowEnzymeSites(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Sites
        </label>
        <div
          className="row"
          style={{
            gap: 0,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden'
          }}
        >
          {[1, 2, 4].map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              style={{
                border: 'none',
                borderRadius: 0,
                padding: '4px 10px',
                fontSize: 12,
                background: zoom === z ? 'var(--accent)' : 'transparent',
                color: zoom === z ? '#fff' : 'var(--text-dim)'
              }}
            >
              {z}×
            </button>
          ))}
        </div>
      </div>

      {/* scrollable canvas */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: zoom > 1 ? 'auto' : 'hidden',
          overflowY: 'auto'
        }}
      >
        <svg
          ref={svgRef}
          width={pixelWidth}
          height={contentHeight}
          style={{ display: 'block', userSelect: 'none' }}
        >
          {/* background capture rect for drag-select / clear */}
          <rect
            x={0}
            y={0}
            width={pixelWidth}
            height={contentHeight}
            fill="transparent"
            onMouseDown={onBackgroundDown}
            style={{ cursor: dragging ? 'col-resize' : 'text' }}
          />

          {selBand}

          {/* backbone */}
          <rect
            x={MARGIN}
            y={yBackbone}
            width={innerWidth}
            height={BACKBONE_H}
            rx={BACKBONE_H / 2}
            fill="var(--bg-active)"
            stroke="var(--border-strong)"
            strokeWidth={1}
            style={{ pointerEvents: 'none' }}
          />

          {/* ruler */}
          <line
            x1={MARGIN}
            y1={yRuler}
            x2={MARGIN + innerWidth}
            y2={yRuler}
            stroke="var(--border)"
            strokeWidth={1}
            style={{ pointerEvents: 'none' }}
          />
          {ticks.map((p, i) => {
            const x = xFor(p)
            return (
              <g key={`tick-${i}`} style={{ pointerEvents: 'none' }}>
                <line x1={x} y1={yRuler} x2={x} y2={yRuler + 5} stroke="var(--border-strong)" strokeWidth={1} />
                <text
                  x={x}
                  y={yRuler + 17}
                  fontSize={10}
                  textAnchor={i === 0 ? 'start' : p === len ? 'end' : 'middle'}
                  fill="var(--text-faint)"
                  fontFamily="var(--mono)"
                >
                  {p.toLocaleString()}
                </text>
              </g>
            )
          })}

          {/* features */}
          {fwd.map((b) => renderBlock(b, 'fwd'))}
          {rev.map((b) => renderBlock(b, 'rev'))}

          {/* enzyme cut sites */}
          {showEnzymeSites &&
            enzymeLayout.items.map((it, i) => {
              const tickTop = yEnzymeTop + enzymeBandH - ENZYME_TICK_H
              const tickBottom = yBackbone
              return (
                <g key={`enz-${it.site.enzyme}-${it.site.cutPosTop}-${i}`} style={{ pointerEvents: 'none' }}>
                  <line
                    x1={it.x}
                    y1={tickTop}
                    x2={it.x}
                    y2={tickBottom}
                    stroke="var(--text-faint)"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  <line x1={it.x} y1={tickTop} x2={it.x} y2={tickTop - 4} stroke="var(--accent-strong)" strokeWidth={1.5} />
                  <text
                    x={it.x}
                    y={yEnzymeTop + it.row * ENZYME_LABEL_ROW_H + 9}
                    fontSize={10}
                    textAnchor="middle"
                    fill="var(--text-dim)"
                    fontFamily="var(--sans)"
                  >
                    {it.site.enzyme}
                  </text>
                </g>
              )
            })}
        </svg>
      </div>

      {/* footer hint */}
      <div
        style={{
          padding: '5px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-faint)',
          fontSize: 11,
          flexShrink: 0,
          display: 'flex',
          gap: 14
        }}
      >
        <span>{record.features.length} features</span>
        {showEnzymeSites && <span>{cutSites.length} cut sites</span>}
        <div className="spacer" style={{ flex: 1 }} />
        <span>Drag the backbone to select · click a feature to inspect</span>
      </div>
    </div>
  )
}
