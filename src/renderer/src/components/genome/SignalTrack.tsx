import { useMemo, useState } from 'react'
import type { GenomeTrackProps } from '../../genome/types'

const H = 52
const PAD_TOP = 4
const PAD_BOTTOM = 4
const PLOT_H = H - PAD_TOP - PAD_BOTTOM

/**
 * Quantitative signal track (bedGraph / wig / GC). Spans are aggregated into
 * per-pixel columns (max aggregation) so we draw one filled area path regardless
 * of how many thousands of spans overlap the viewport.
 */
export function SignalTrack({ track, viewport, onSignalSelect }: GenomeTrackProps): JSX.Element {
  const { width, bpToPx, pxToBp } = viewport
  const signal = track.signal
  const color = track.color || 'var(--good)'
  const W = Math.max(1, Math.round(width))

  const [hoverX, setHoverX] = useState<number | null>(null)

  const agg = useMemo(() => {
    if (!signal || signal.spans.length === 0) return null

    const col = new Float64Array(W)
    col.fill(-Infinity)

    let present = false
    let dataMin = Infinity
    let dataMax = -Infinity

    for (const span of signal.spans) {
      let pxA = Math.round(bpToPx(span.start))
      let pxB = Math.round(bpToPx(span.end))
      if (pxB <= pxA) pxB = pxA + 1 // ensure visible sub-pixel spans paint 1px
      if (pxB <= 0 || pxA >= W) continue // fully outside
      pxA = pxA < 0 ? 0 : pxA
      pxB = pxB > W ? W : pxB
      const v = span.value
      for (let x = pxA; x < pxB; x++) {
        if (v > col[x]) col[x] = v
      }
      present = true
      if (v < dataMin) dataMin = v
      if (v > dataMax) dataMax = v
    }

    if (!present) return null

    const vmin = signal.min ?? dataMin
    const vmax = signal.max ?? dataMax
    return { col, vmin, vmax }
  }, [signal, W, bpToPx])

  if (!signal || signal.spans.length === 0 || !agg) {
    return <svg width={width} height={30} style={{ display: 'block' }} />
  }

  const { col, vmin, vmax } = agg
  const range = vmax - vmin
  const baselineY = PAD_TOP + PLOT_H // bottom of plot (y of vmin)

  const valueToY = (v: number): number => {
    if (range === 0) return baselineY
    const t = (v - vmin) / range
    return PAD_TOP + (1 - t) * PLOT_H
  }

  // Build a single filled area path across columns that carry data. Columns
  // without data create a break (we close the current sub-path and start a new
  // one) so gaps stay empty rather than dropping to baseline across the gap.
  let d = ''
  let runStart = -1
  const flushRun = (endX: number): void => {
    if (runStart < 0) return
    // close down to baseline and back to the run start at baseline
    d += ` L ${endX},${baselineY} L ${runStart},${baselineY} Z`
    runStart = -1
  }
  for (let x = 0; x < W; x++) {
    const v = col[x]
    if (v === -Infinity) {
      flushRun(x)
      continue
    }
    const y = valueToY(v)
    if (runStart < 0) {
      runStart = x
      d += ` M ${x},${baselineY} L ${x},${y}`
    } else {
      d += ` L ${x},${y}`
    }
    // step path: hold value across the pixel width
    d += ` L ${x + 1},${y}`
  }
  flushRun(W)

  // Hover readout: value at the hovered pixel column.
  let hoverInfo: { x: number; y: number; value: number; bp: number } | null = null
  if (hoverX !== null && hoverX >= 0 && hoverX < W) {
    const v = col[hoverX]
    if (v !== -Infinity) {
      hoverInfo = {
        x: hoverX,
        y: valueToY(v),
        value: v,
        bp: Math.round(pxToBp(hoverX)),
      }
    }
  }

  const fmt = (v: number): string => {
    const a = Math.abs(v)
    if (a !== 0 && (a < 0.01 || a >= 100000)) return v.toExponential(1)
    return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }

  return (
    <svg
      width={width}
      height={H}
      style={{ display: 'block' }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setHoverX(Math.round(e.clientX - rect.left))
      }}
      onMouseLeave={() => setHoverX(null)}
      onClick={(e) => {
        if (!onSignalSelect) return
        const rect = e.currentTarget.getBoundingClientRect()
        const x = Math.round(e.clientX - rect.left)
        if (x < 0 || x >= W) return
        const v = col[x]
        if (v === -Infinity) return
        onSignalSelect({ value: v, bp: Math.round(pxToBp(x)) })
      }}
    >
      {/* baseline */}
      <line
        x1={0}
        y1={baselineY}
        x2={W}
        y2={baselineY}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {/* signal area */}
      <path d={d.trim()} fill={color} fillOpacity={0.85} stroke="none" />

      {/* axis labels */}
      <text x={3} y={PAD_TOP + 8} fontSize={9} fill="var(--text-faint)" fontFamily="var(--mono)">
        {fmt(vmax)}
      </text>
      <text
        x={3}
        y={baselineY - 2}
        fontSize={9}
        fill="var(--text-faint)"
        fontFamily="var(--mono)"
      >
        {fmt(vmin)}
      </text>

      {/* hover crosshair + readout */}
      {hoverInfo && (
        <g pointerEvents="none">
          <line
            x1={hoverInfo.x}
            y1={PAD_TOP}
            x2={hoverInfo.x}
            y2={baselineY}
            stroke="var(--border-strong)"
            strokeWidth={1}
          />
          <circle cx={hoverInfo.x} cy={hoverInfo.y} r={2.5} fill={color} stroke="var(--bg)" strokeWidth={1} />
          <text
            x={Math.min(hoverInfo.x + 5, W - 4)}
            y={PAD_TOP + 8}
            fontSize={9}
            fill="var(--text)"
            fontFamily="var(--mono)"
            textAnchor={hoverInfo.x > W - 60 ? 'end' : 'start'}
          >
            {fmt(hoverInfo.value)}
          </text>
        </g>
      )}
    </svg>
  )
}
