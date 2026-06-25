/**
 * CircularMap — the signature circular plasmid view (SnapGene-style).
 *
 * Pure inline SVG. All geometry lives in a fixed 760x760 viewBox and scales via
 * preserveAspectRatio, so no DOM measurement is needed. Reads everything from
 * the store / derived hooks.
 *
 * Coordinate convention (see core/types.ts): 0-based half-open [start,end).
 * Position 0 sits at 12 o'clock; angle increases CLOCKWISE.
 */
import { useMemo } from 'react'
import { useStore } from '@state/store'
import { useCutSites } from '../hooks/derived'
import { featureColor, isDirectional } from '@core/featureStyle'
import { spanLength } from '@core/sequence'
import type { Feature, CutSite } from '@core/types'

// ---- viewBox geometry ------------------------------------------------------
const VB = 760
const CX = VB / 2
const CY = VB / 2
const R_BACKBONE = 250
const R_TICK_OUT = R_BACKBONE
const R_TICK_IN = R_BACKBONE - 9
const R_TICK_LABEL = R_BACKBONE - 22
const FEATURE_BAND = 20 // thickness of each feature lane
const FEATURE_GAP = 6 // gap between concentric lanes
const R_FEATURE_OUTER = R_BACKBONE - 6 // outermost feature lane outer edge
const R_ENZYME_TICK_OUT = R_BACKBONE + 14
const R_ENZYME_TICK_IN = R_BACKBONE - 4
const R_ENZYME_ELBOW = R_BACKBONE + 26
const R_ENZYME_LABEL = R_BACKBONE + 40

// ---- angle / point helpers -------------------------------------------------
function angleForDeg(pos: number, len: number): number {
  return -90 + (pos / len) * 360
}
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}
function pointAt(pos: number, r: number, len: number): { x: number; y: number } {
  const a = toRad(angleForDeg(pos, len))
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
}

/**
 * Build a closed band path (an annular sector) spanning [start,end) between
 * inner radius rIn and outer radius rOut. Handles origin wrap because the swept
 * extent is computed with spanLength; the SVG large-arc-flag is derived purely
 * from whether that extent exceeds 180deg.
 */
function bandPath(
  start: number,
  end: number,
  rIn: number,
  rOut: number,
  len: number,
  topology: 'linear' | 'circular'
): string {
  const extent = spanLength(start, end, len, topology)
  const large = extent / len > 0.5 ? 1 : 0
  const o1 = pointAt(start, rOut, len)
  const o2 = pointAt(end, rOut, len)
  const i2 = pointAt(end, rIn, len)
  const i1 = pointAt(start, rIn, len)
  // outer arc clockwise (sweep=1), inner arc back counter-clockwise (sweep=0)
  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    'Z'
  ].join(' ')
}

/**
 * Band path with an arrowhead pointing at the strand-appropriate end.
 * forward (strand 1): tip at the clockwise (end) side.
 * reverse (strand -1): tip at the counter-clockwise (start) side.
 * The arrow is formed by collapsing the band to its mid-radius point at the tip.
 */
function arrowBandPath(
  start: number,
  end: number,
  rIn: number,
  rOut: number,
  len: number,
  topology: 'linear' | 'circular',
  strand: number
): string {
  const extent = spanLength(start, end, len, topology)
  const rMid = (rIn + rOut) / 2
  // arrowhead angular length, capped so it never exceeds the feature
  const headBp = Math.min(extent * 0.5, (len / 360) * 7) // ~7 degrees max
  const large = (extent - headBp) / len > 0.5 ? 1 : 0

  if (strand >= 0) {
    // tip at end side
    const bodyEnd = start + (extent - headBp)
    const o1 = pointAt(start, rOut, len)
    const o2 = pointAt(bodyEnd, rOut, len)
    const tip = pointAt(end, rMid, len)
    const i2 = pointAt(bodyEnd, rIn, len)
    const i1 = pointAt(start, rIn, len)
    return [
      `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
      `A ${rOut} ${rOut} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
      `L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
      `L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
      `A ${rIn} ${rIn} 0 ${large} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
      'Z'
    ].join(' ')
  } else {
    // tip at start side
    const bodyStart = start + headBp
    const tip = pointAt(start, rMid, len)
    const o1 = pointAt(bodyStart, rOut, len)
    const o2 = pointAt(end, rOut, len)
    const i2 = pointAt(end, rIn, len)
    const i1 = pointAt(bodyStart, rIn, len)
    return [
      `M ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
      `L ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
      `A ${rOut} ${rOut} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
      `L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
      `A ${rIn} ${rIn} 0 ${large} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
      'Z'
    ].join(' ')
  }
}

// ---- lane packing ----------------------------------------------------------
interface LinInterval {
  s: number
  e: number
}
function intervalsFor(f: Feature, len: number): LinInterval[] {
  if (f.end < f.start) {
    // wraps origin -> two linear intervals
    return [
      { s: f.start, e: len },
      { s: 0, e: f.end }
    ]
  }
  return [{ s: f.start, e: f.end }]
}
function overlaps(a: LinInterval[], b: LinInterval[]): boolean {
  for (const x of a) for (const y of b) if (x.s < y.e && y.s < x.e) return true
  return false
}

interface LaidFeature {
  feature: Feature
  lane: number
  midPos: number
}

function assignLanes(features: Feature[], len: number): { laid: LaidFeature[]; lanes: number } {
  // sort by length desc so big features take inner lanes first (stable look)
  const sorted = [...features].sort((a, b) => {
    const la = spanLength(a.start, a.end, len, 'circular')
    const lb = spanLength(b.start, b.end, len, 'circular')
    return lb - la
  })
  const laneIntervals: LinInterval[][] = []
  const laid: LaidFeature[] = []
  for (const f of sorted) {
    const iv = intervalsFor(f, len)
    let lane = 0
    while (lane < laneIntervals.length && overlaps(laneIntervals[lane], iv)) lane++
    if (lane === laneIntervals.length) laneIntervals.push([])
    laneIntervals[lane].push(...iv)
    const ext = spanLength(f.start, f.end, len, 'circular')
    const midPos = (f.start + ext / 2) % len
    laid.push({ feature: f, lane, midPos })
  }
  return { laid, lanes: laneIntervals.length }
}

// ---- ruler step ------------------------------------------------------------
function chooseStep(len: number): number {
  const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000]
  for (const s of steps) {
    const ticks = Math.floor(len / s)
    if (ticks >= 8 && ticks <= 16) return s
  }
  // fallback: pick the step giving the closest to ~12 ticks
  let best = steps[0]
  let bestDiff = Infinity
  for (const s of steps) {
    const diff = Math.abs(len / s - 12)
    if (diff < bestDiff) {
      bestDiff = diff
      best = s
    }
  }
  return best
}

function fmtBp(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`
  return String(n)
}

// ---- label de-collision ----------------------------------------------------
interface LabelLayout<T> {
  item: T
  pos: number
  anchorX: number
  anchorY: number
  elbowX: number
  elbowY: number
  labelX: number
  labelY: number
  right: boolean
}

function declutter<T>(
  items: { item: T; pos: number }[],
  len: number,
  rTickOut: number,
  rElbow: number,
  rLabel: number,
  minGap: number
): LabelLayout<T>[] {
  const laidOut: LabelLayout<T>[] = items.map(({ item, pos }) => {
    const a = pointAt(pos, rTickOut, len)
    const elbow = pointAt(pos, rElbow, len)
    const deg = angleForDeg(pos, len)
    const norm = ((deg % 360) + 360) % 360
    const right = norm < 90 || norm > 270 // right hemisphere
    return {
      item,
      pos,
      anchorX: a.x,
      anchorY: a.y,
      elbowX: elbow.x,
      elbowY: elbow.y,
      labelX: right ? CX + rLabel : CX - rLabel,
      labelY: elbow.y,
      right
    }
  })
  // push apart vertically within each side
  for (const side of [true, false]) {
    const grp = laidOut.filter((l) => l.right === side).sort((a, b) => a.labelY - b.labelY)
    for (let i = 1; i < grp.length; i++) {
      if (grp[i].labelY - grp[i - 1].labelY < minGap) {
        grp[i].labelY = grp[i - 1].labelY + minGap
      }
    }
    // keep within viewBox vertical bounds; nudge the whole stack up if it overflows
    if (grp.length) {
      const overflow = grp[grp.length - 1].labelY - (VB - 12)
      if (overflow > 0) for (const g of grp) g.labelY -= overflow
      const underflow = 12 - grp[0].labelY
      if (underflow > 0) for (const g of grp) g.labelY += underflow
    }
  }
  return laidOut
}

export function CircularMap(): JSX.Element {
  const record = useStore((s) => s.record)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const selectedFeatureId = useStore((s) => s.selectedFeatureId)
  const setSelectedFeatureId = useStore((s) => s.setSelectedFeatureId)
  const hoveredFeatureId = useStore((s) => s.hoveredFeatureId)
  const setHoveredFeatureId = useStore((s) => s.setHoveredFeatureId)
  const showEnzymeSites = useStore((s) => s.showEnzymeSites)
  const cutSites = useCutSites()

  const len = record?.sequence.length ?? 0
  const topology = record?.topology ?? 'circular'

  const { laid, lanes } = useMemo(
    () => (record && len > 0 ? assignLanes(record.features, len) : { laid: [], lanes: 0 }),
    [record, len]
  )

  // ruler ticks
  const ticks = useMemo(() => {
    if (!len) return [] as number[]
    const step = chooseStep(len)
    const out: number[] = []
    for (let p = 0; p < len; p += step) out.push(p)
    return out
  }, [len])

  // enzyme labels (only meaningful unique tick positions), deconflicted
  const enzymeLayout = useMemo(() => {
    if (!len || !showEnzymeSites) return [] as LabelLayout<CutSite>[]
    const items = cutSites
      .slice()
      .sort((a, b) => a.cutPosTop - b.cutPosTop)
      .map((c) => ({ item: c, pos: c.cutPosTop }))
    return declutter(items, len, R_ENZYME_TICK_OUT, R_ENZYME_ELBOW, R_ENZYME_LABEL, 15)
  }, [cutSites, len, showEnzymeSites])

  if (!record || len === 0) {
    return (
      <div className="empty-state">
        <div className="dim">No molecule loaded</div>
      </div>
    )
  }

  // feature lane radius: lane 0 is outermost
  const featRadius = (lane: number): { rIn: number; rOut: number } => {
    const rOut = R_FEATURE_OUTER - lane * (FEATURE_BAND + FEATURE_GAP)
    return { rIn: rOut - FEATURE_BAND, rOut }
  }

  const handleBackgroundClick = (): void => {
    setSelectedFeatureId(null)
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        overflow: 'hidden'
      }}
    >
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', fontFamily: 'var(--sans)' }}
      >
        {/* background hit target — clears selection */}
        <rect x={0} y={0} width={VB} height={VB} fill="transparent" onClick={handleBackgroundClick} />

        {/* selection arc (under features) */}
        {selection && spanLength(selection.start, selection.end, len, topology) > 0 && (
          <path
            d={bandPath(selection.start, selection.end, R_BACKBONE - 2, R_BACKBONE + 18, len, topology)}
            fill="var(--accent-soft)"
            stroke="var(--accent)"
            strokeWidth={1}
            pointerEvents="none"
          />
        )}

        {/* backbone */}
        <circle cx={CX} cy={CY} r={R_BACKBONE} fill="none" stroke="var(--border-strong)" strokeWidth={2} />

        {/* ruler ticks + bp labels */}
        <g pointerEvents="none">
          {ticks.map((p) => {
            const a = pointAt(p, R_TICK_OUT, len)
            const b = pointAt(p, R_TICK_IN, len)
            const lab = pointAt(p, R_TICK_LABEL, len)
            return (
              <g key={`tick-${p}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-strong)" strokeWidth={1} />
                <text
                  x={lab.x}
                  y={lab.y}
                  fill="var(--text-faint)"
                  fontSize={10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {fmtBp(p)}
                </text>
              </g>
            )
          })}
        </g>

        {/* features */}
        <g>
          {laid.map(({ feature, lane, midPos }) => {
            const { rIn, rOut } = featRadius(lane)
            if (rIn < 60) return null // ran out of room near the center
            const color = featureColor(feature)
            const isSel = feature.id === selectedFeatureId
            const isHov = feature.id === hoveredFeatureId
            const directional = isDirectional(feature.type)
            const d = directional
              ? arrowBandPath(feature.start, feature.end, rIn, rOut, len, topology, feature.strand)
              : bandPath(feature.start, feature.end, rIn, rOut, len, topology)

            // label leader from feature mid to outside
            const ext = spanLength(feature.start, feature.end, len, topology)
            const extDeg = (ext / len) * 360
            const showInline = extDeg > 26 // long enough to host its own label inline
            const labRMid = (rIn + rOut) / 2
            const labInline = pointAt(midPos, labRMid, len)

            return (
              <g key={feature.id}>
                <path
                  d={d}
                  fill={color}
                  fillOpacity={isSel ? 1 : isHov ? 0.95 : 0.85}
                  stroke={isSel ? 'var(--text)' : isHov ? color : 'rgba(0,0,0,0.35)'}
                  strokeWidth={isSel ? 2 : 1}
                  style={{ cursor: 'pointer', transition: 'fill-opacity 0.1s' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedFeatureId(isSel ? null : feature.id)
                    setSelection({ start: feature.start, end: feature.end })
                  }}
                  onMouseEnter={() => setHoveredFeatureId(feature.id)}
                  onMouseLeave={() => setHoveredFeatureId(null)}
                >
                  <title>
                    {feature.name} · {feature.type} · {feature.start + 1}–{feature.end} (
                    {feature.strand === 1 ? '+' : '−'})
                  </title>
                </path>
                {showInline && (
                  <text
                    x={labInline.x}
                    y={labInline.y}
                    fill="#fff"
                    fontSize={11}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 2.5 }}
                  >
                    {feature.name}
                  </text>
                )}
              </g>
            )
          })}
        </g>

        {/* leader-line labels for short features */}
        <g pointerEvents="none">
          <FeatureLeaderLabels
            laid={laid}
            len={len}
            topology={topology}
            featRadius={featRadius}
            selectedFeatureId={selectedFeatureId}
            hoveredFeatureId={hoveredFeatureId}
          />
        </g>

        {/* enzyme sites */}
        {showEnzymeSites && (
          <g>
            {enzymeLayout.map((l, i) => {
              const tIn = pointAt(l.pos, R_ENZYME_TICK_IN, len)
              const tOut = pointAt(l.pos, R_ENZYME_TICK_OUT, len)
              const cut = l.item
              return (
                <g key={`enz-${cut.enzyme}-${cut.cutPosTop}-${i}`}>
                  <line
                    x1={tIn.x}
                    y1={tIn.y}
                    x2={tOut.x}
                    y2={tOut.y}
                    stroke="var(--text-dim)"
                    strokeWidth={1.4}
                  />
                  <polyline
                    points={`${tOut.x},${tOut.y} ${l.elbowX},${l.elbowY} ${l.labelX},${l.labelY}`}
                    fill="none"
                    stroke="var(--border-strong)"
                    strokeWidth={0.8}
                  />
                  <text
                    x={l.right ? l.labelX + 4 : l.labelX - 4}
                    y={l.labelY}
                    fill="var(--text-dim)"
                    fontSize={10}
                    textAnchor={l.right ? 'start' : 'end'}
                    dominantBaseline="middle"
                    style={{ cursor: 'pointer' }}
                    pointerEvents="all"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelection({ start: cut.cutPosTop, end: cut.cutPosTop })
                    }}
                  >
                    <tspan fill="var(--text)" fontWeight={600}>
                      {cut.enzyme}
                    </tspan>
                    <tspan fill="var(--text-faint)"> ({cut.cutPosTop + 1})</tspan>
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* center label */}
        <g pointerEvents="none">
          <text
            x={CX}
            y={CY - 8}
            fill="var(--text)"
            fontSize={26}
            fontWeight={700}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {record.name}
          </text>
          <text
            x={CX}
            y={CY + 20}
            fill="var(--text-dim)"
            fontSize={14}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {len.toLocaleString()} bp
          </text>
          <text
            x={CX}
            y={CY + 40}
            fill="var(--text-faint)"
            fontSize={11}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >
            {topology}
          </text>
        </g>
      </svg>
    </div>
  )
}

// ---- leader labels for short features (sub-component) ----------------------
function FeatureLeaderLabels(props: {
  laid: LaidFeature[]
  len: number
  topology: 'linear' | 'circular'
  featRadius: (lane: number) => { rIn: number; rOut: number }
  selectedFeatureId: string | null
  hoveredFeatureId: string | null
}): JSX.Element {
  const { laid, len, topology, featRadius, selectedFeatureId, hoveredFeatureId } = props

  // only short features get leader labels (long ones are labeled inline)
  const shortItems = laid.filter(({ feature }) => {
    const ext = spanLength(feature.start, feature.end, len, topology)
    return (ext / len) * 360 <= 26
  })

  // anchor each at the OUTER edge of its lane so leaders fan outward
  const items = shortItems.map(({ feature, lane, midPos }) => {
    const { rOut } = featRadius(lane)
    return { item: feature, pos: midPos, rOut }
  })

  const layout = declutter(
    items.map((x) => ({ item: x.item, pos: x.pos })),
    len,
    R_BACKBONE + 14,
    R_BACKBONE + 30,
    R_BACKBONE + 46,
    14
  )

  return (
    <>
      {layout.map((l) => {
        const f = l.item
        const isSel = f.id === selectedFeatureId
        const isHov = f.id === hoveredFeatureId
        const color = featureColor(f)
        // start the leader from the feature band itself
        const startPt = pointAt(l.pos, R_BACKBONE - 2, len)
        return (
          <g key={`flead-${f.id}`}>
            <polyline
              points={`${startPt.x},${startPt.y} ${l.elbowX},${l.elbowY} ${l.labelX},${l.labelY}`}
              fill="none"
              stroke={isSel || isHov ? color : 'var(--border-strong)'}
              strokeWidth={isSel || isHov ? 1.2 : 0.8}
            />
            <circle cx={startPt.x} cy={startPt.y} r={2} fill={color} />
            <text
              x={l.right ? l.labelX + 4 : l.labelX - 4}
              y={l.labelY}
              fill={isSel ? 'var(--text)' : 'var(--text-dim)'}
              fontSize={11}
              fontWeight={isSel || isHov ? 700 : 500}
              textAnchor={l.right ? 'start' : 'end'}
              dominantBaseline="middle"
            >
              {f.name}
            </text>
          </g>
        )
      })}
    </>
  )
}
