import type { GenomeTrackProps, GenomeFeature } from '../../genome/types'

const LANE_H = 15
const SIMPLE_H = 10
const THIN_H = 4
const THICK_H = 10
const PAD_TOP = 3
const MIN_W = 2
const DEFAULT_COLOR = '#c0a040'

/** Greedy interval packing: assign each feature the lowest lane whose last end <= its start. */
function packLanes(features: GenomeFeature[]): Map<string, number> {
  const sorted = [...features].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  const lane = new Map<string, number>()
  for (const f of sorted) {
    let placed = -1
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= f.start) {
        placed = i
        break
      }
    }
    if (placed === -1) {
      placed = laneEnds.length
      laneEnds.push(f.end)
    } else {
      laneEnds[placed] = f.end
    }
    lane.set(f.id, placed)
  }
  return lane
}

export function FeatureTrack(props: GenomeTrackProps): JSX.Element {
  const { track, viewport, selectedId, hoveredId, onSelect, onHover } = props
  const features = track.features ?? []
  const { width, bpToPx } = viewport

  if (features.length === 0) {
    return <svg width={width} height={22} style={{ display: 'block' }} />
  }

  // Cull features fully off-screen (allow a small margin for labels/arrowheads).
  const visible = features.filter((f) => {
    const x0 = bpToPx(f.start)
    const x1 = bpToPx(f.end)
    return x1 >= -20 && x0 <= width + 20
  })

  const lane = packLanes(features)
  let laneCount = 0
  for (const v of lane.values()) laneCount = Math.max(laneCount, v + 1)
  const height = Math.max(22, laneCount * LANE_H + 6)

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {visible.map((f) => {
        const laneIdx = lane.get(f.id) ?? 0
        const laneTop = PAD_TOP + laneIdx * LANE_H
        const midY = laneTop + LANE_H / 2

        const x0 = bpToPx(f.start)
        const x1 = bpToPx(f.end)
        const isSel = selectedId === f.id
        const isHov = hoveredId === f.id
        const color = f.color || track.color || DEFAULT_COLOR
        const stroke = isSel ? 'var(--accent-strong)' : isHov ? 'var(--accent)' : 'none'
        const strokeW = isSel ? 1.5 : isHov ? 1 : 0
        const opacity = isSel || isHov ? 1 : 0.92

        const titleText = `${f.name ?? f.id} ${f.chrom}:${f.start}-${f.end} (${
          f.strand === 1 ? '+' : f.strand === -1 ? '-' : '.'
        })`

        const handleClick = (): void => onSelect(isSel ? null : f.id)
        const handleEnter = (): void => onHover(f.id)
        const handleLeave = (): void => onHover(null)

        // Label fits inside if there's enough room.
        const labelW = (f.name?.length ?? 0) * 6
        const showLabel = f.name && x1 - x0 > labelW + 6
        const labelX = Math.max(x0, 1) + 3

        const glyphs: JSX.Element[] = []

        if (f.blocks && f.blocks.length > 0) {
          // BED12-style gene model: connector + per-block rects, thick over CDS range.
          glyphs.push(
            <line
              key="conn"
              x1={x0}
              y1={midY}
              x2={x1}
              y2={midY}
              stroke={color}
              strokeWidth={1.5}
              opacity={opacity}
            />
          )
          const hasThick =
            typeof f.thickStart === 'number' && typeof f.thickEnd === 'number' && f.thickEnd > f.thickStart
          for (let i = 0; i < f.blocks.length; i++) {
            const b = f.blocks[i]
            const bx0 = bpToPx(b.start)
            const bx1 = bpToPx(b.end)
            // Thin block (whole block as UTR-style baseline).
            glyphs.push(
              <rect
                key={`b${i}-thin`}
                x={bx0}
                y={midY - THIN_H / 2}
                width={Math.max(MIN_W, bx1 - bx0)}
                height={THIN_H}
                fill={color}
                opacity={opacity}
              />
            )
            // Thick (CDS) portion = intersection of block with [thickStart, thickEnd).
            if (hasThick) {
              const ts = Math.max(b.start, f.thickStart as number)
              const te = Math.min(b.end, f.thickEnd as number)
              if (te > ts) {
                const tx0 = bpToPx(ts)
                const tx1 = bpToPx(te)
                glyphs.push(
                  <rect
                    key={`b${i}-thick`}
                    x={tx0}
                    y={midY - THICK_H / 2}
                    width={Math.max(MIN_W, tx1 - tx0)}
                    height={THICK_H}
                    fill={color}
                    opacity={opacity}
                  />
                )
              }
            }
          }
          // Direction chevrons along the connector.
          if (f.strand !== 0) {
            const dir = f.strand === 1 ? 1 : -1
            const cStart = Math.max(x0, 0)
            const cEnd = Math.min(x1, width)
            const step = 18
            for (let cx = cStart + step / 2; cx < cEnd; cx += step) {
              glyphs.push(
                <path
                  key={`chev${cx.toFixed(0)}`}
                  d={`M${cx - dir * 2.5},${midY - 2.5} L${cx + dir * 2.5},${midY} L${cx - dir * 2.5},${
                    midY + 2.5
                  }`}
                  fill="none"
                  stroke="var(--bg)"
                  strokeWidth={1}
                  opacity={opacity}
                />
              )
            }
          }
        } else {
          // Simple rounded interval rect.
          const w = Math.max(MIN_W, x1 - x0)
          glyphs.push(
            <rect
              key="rect"
              x={x0}
              y={midY - SIMPLE_H / 2}
              width={w}
              height={SIMPLE_H}
              rx={2}
              ry={2}
              fill={color}
              opacity={opacity}
            />
          )
          // Strand arrowhead on the appropriate end.
          if (f.strand !== 0 && w > 6) {
            const ah = SIMPLE_H / 2
            if (f.strand === 1) {
              const tip = x1 + 4
              glyphs.push(
                <path
                  key="arr"
                  d={`M${x1},${midY - ah} L${tip},${midY} L${x1},${midY + ah} Z`}
                  fill={color}
                  opacity={opacity}
                />
              )
            } else {
              const tip = x0 - 4
              glyphs.push(
                <path
                  key="arr"
                  d={`M${x0},${midY - ah} L${tip},${midY} L${x0},${midY + ah} Z`}
                  fill={color}
                  opacity={opacity}
                />
              )
            }
          }
        }

        return (
          <g
            key={f.id}
            onClick={handleClick}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            style={{ cursor: 'pointer' }}
          >
            <title>{titleText}</title>
            {/* Selection/hover halo behind glyphs. */}
            {(isSel || isHov) && (
              <rect
                x={x0 - 2}
                y={laneTop + 1}
                width={Math.max(MIN_W, x1 - x0) + 4}
                height={LANE_H - 2}
                rx={3}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeW}
              />
            )}
            {glyphs}
            {showLabel && (
              <text
                x={labelX}
                y={midY + 3.5}
                fontSize={10}
                fill="var(--text-dim)"
                fontFamily="var(--mono)"
                style={{ pointerEvents: 'none' }}
              >
                {f.name}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
