import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@state/store'
import { useCutSites } from '../hooks/derived'
import { featureColor } from '@core/featureStyle'
import { complement, reverseComplement, spanLength } from '@core/sequence'
import { translate as translateDna } from '@core/translation'
import type { CutSite, Feature } from '@core/types'

const BASES_PER_ROW = 60
const CHAR_W = 8.4 // px, monospace; refined from a measured ref at runtime
const BASE_LINE_H = 17 // px per base text row
const POS_W = 64 // gutter width

/** A row segment of a feature, clipped to a single rendered row. */
interface FeatSeg {
  feature: Feature
  /** column offset within the row [0, BASES_PER_ROW) */
  col: number
  /** number of bases this segment covers in the row */
  span: number
  /** true if this segment contains the feature's biological start */
  hasStart: boolean
  /** stacking lane within the row */
  lane: number
}

function baseColorVar(b: string): string {
  switch (b) {
    case 'A':
      return 'var(--base-a)'
    case 'C':
      return 'var(--base-c)'
    case 'G':
      return 'var(--base-g)'
    case 'T':
    case 'U':
      return 'var(--base-t)'
    default:
      return 'var(--text-dim)'
  }
}

/** Enumerate the absolute base indices covered by a (possibly wrapping) feature. */
function featureCovers(f: Feature, len: number, circular: boolean): [number, number][] {
  if (circular && f.end <= f.start) {
    // wraps origin: [start,len) ++ [0,end)
    const segs: [number, number][] = []
    if (f.start < len) segs.push([f.start, len])
    if (f.end > 0) segs.push([0, f.end])
    return segs
  }
  const s = Math.max(0, Math.min(f.start, len))
  const e = Math.max(s, Math.min(f.end, len))
  return e > s ? [[s, e]] : []
}

export function SequenceView(): JSX.Element {
  const record = useStore((s) => s.record)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const selectedFeatureId = useStore((s) => s.selectedFeatureId)
  const setSelectedFeatureId = useStore((s) => s.setSelectedFeatureId)
  const hoveredFeatureId = useStore((s) => s.hoveredFeatureId)
  const setHoveredFeatureId = useStore((s) => s.setHoveredFeatureId)
  const showTranslation = useStore((s) => s.showTranslation)
  const setShowTranslation = useStore((s) => s.setShowTranslation)
  const showEnzymeSites = useStore((s) => s.showEnzymeSites)
  const addFeature = useStore((s) => s.addFeature)
  const cutSites = useCutSites()

  const [showComplement, setShowComplement] = useState(true)
  const [showReverseFrames, setShowReverseFrames] = useState(false)
  const [gotoValue, setGotoValue] = useState('')
  const [charW, setCharW] = useState(CHAR_W)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const dragging = useRef<{ anchor: number } | null>(null)

  // Measure the real monospace character width for accurate hit-testing.
  useLayoutEffect(() => {
    if (measureRef.current) {
      const w = measureRef.current.getBoundingClientRect().width / 10
      if (w > 0 && Number.isFinite(w)) setCharW(w)
    }
  }, [])

  const seq = record?.sequence ?? ''
  const len = seq.length
  const circular = record?.topology === 'circular'
  const comp = useMemo(() => (record ? complement(seq) : ''), [record, seq])

  // ---- forward 3-frame translation strips (whole sequence) -----------------
  // For each frame, an array of single AA letters positioned at the FIRST base
  // of each codon. We build a per-base lookup: frame -> Map<baseIndex, aa>.
  const frameTranslations = useMemo(() => {
    if (!showTranslation || !seq) return null
    const fwd = [0, 1, 2].map((frame) => {
      const protein = translateDna(seq, frame)
      return { frame, strand: 1 as const, protein }
    })
    const rev = showReverseFrames
      ? [0, 1, 2].map((frame) => {
          // translate reads 5'->3'; for reverse frames translate the
          // reverse-complement, then map each AA back to a top-strand
          // codon-start coordinate when rendering.
          const protein = translateDna(reverseComplement(seq), frame)
          return { frame, strand: -1 as const, protein }
        })
      : []
    return { fwd, rev }
  }, [showTranslation, showReverseFrames, seq])

  // ---- features arranged into row segments with lane stacking --------------
  const features = record?.features ?? []
  const rowCount = Math.ceil(len / BASES_PER_ROW)

  const { segsByRow, maxLaneByRow } = useMemo(() => {
    const byRow: FeatSeg[][] = Array.from({ length: rowCount }, () => [])
    const maxLane: number[] = new Array(rowCount).fill(-1)
    if (!record) return { segsByRow: byRow, maxLaneByRow: maxLane }

    // Assign a stable global lane to each feature so a feature keeps the same
    // sub-row across all rows it spans. Greedy interval packing.
    const sorted = [...features].sort((a, b) => {
      const sa = spanLength(a.start, a.end, len, record.topology)
      const sb = spanLength(b.start, b.end, len, record.topology)
      return sb - sa // widest first so big features get low lanes
    })
    const laneEnds: number[] = [] // last covered base (absolute, expanded) per lane
    const laneOf = new Map<string, number>()
    for (const f of sorted) {
      const covers = featureCovers(f, len, circular)
      // crude occupancy: use the min start / max end footprint for packing
      const starts = covers.map((c) => c[0])
      const minStart = Math.min(...starts, len)
      let lane = 0
      while (lane < laneEnds.length && laneEnds[lane] > minStart) lane++
      const maxEnd = Math.max(...covers.map((c) => c[1]), 0)
      laneEnds[lane] = maxEnd
      laneOf.set(f.id, lane)
    }

    for (const f of features) {
      const lane = laneOf.get(f.id) ?? 0
      const covers = featureCovers(f, len, circular)
      // Anchor base where the feature's NAME label is drawn: the 5' end of the
      // feature on its own strand. Forward / wrapping-circular -> biological
      // start; reverse (non-wrapping) -> the last covered base (f.end - 1) so
      // every feature shows its name exactly once.
      const wraps = circular && f.end <= f.start
      const labelAnchor =
        f.strand === -1 && !wraps ? Math.max(0, f.end - 1) : f.start
      for (const [cs, ce] of covers) {
        for (let abs = cs; abs < ce; ) {
          const row = Math.floor(abs / BASES_PER_ROW)
          const col = abs % BASES_PER_ROW
          const rowEndAbs = (row + 1) * BASES_PER_ROW
          const segEnd = Math.min(ce, rowEndAbs)
          const span = segEnd - abs
          const hasStart = labelAnchor >= abs && labelAnchor < segEnd
          byRow[row].push({ feature: f, col, span, hasStart, lane })
          if (lane > maxLane[row]) maxLane[row] = lane
          abs = segEnd
        }
      }
    }
    return { segsByRow: byRow, maxLaneByRow: maxLane }
  }, [record, features, len, circular, rowCount])

  // ---- cut sites grouped by row --------------------------------------------
  const cutsByRow = useMemo(() => {
    const byRow: CutSite[][] = Array.from({ length: rowCount }, () => [])
    if (!showEnzymeSites) return byRow
    for (const c of cutSites) {
      const p = c.cutPosTop
      const row = Math.floor(p / BASES_PER_ROW)
      if (row >= 0 && row < rowCount) byRow[row].push(c)
    }
    return byRow
  }, [cutSites, showEnzymeSites, rowCount])

  // ---- windowing for very long sequences -----------------------------------
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const windowed = len > 50000

  // Precompute each row's height & cumulative top offset (layout is variable
  // because feature lanes / translation tracks differ per row).
  const rowLayout = useMemo(() => {
    const heights: number[] = new Array(rowCount)
    const offsets: number[] = new Array(rowCount)
    let acc = 0
    const transFwd = showTranslation ? 3 : 0
    const transRev = showTranslation && showReverseFrames ? 3 : 0
    for (let r = 0; r < rowCount; r++) {
      const lanes = maxLaneByRow[r] + 1
      const hasCuts = cutsByRow[r] && cutsByRow[r].length > 0
      let h = 0
      h += hasCuts ? 16 : 0 // cut marker track above
      h += transRev * 14 // reverse frames above top strand
      h += BASE_LINE_H // top strand
      h += showComplement ? BASE_LINE_H : 0
      h += transFwd * 14 // forward frames below
      h += lanes * 13 // feature lanes
      h += 22 // row spacing
      offsets[r] = acc
      heights[r] = h
      acc += h
    }
    return { heights, offsets, total: acc }
  }, [rowCount, maxLaneByRow, cutsByRow, showComplement, showTranslation, showReverseFrames])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Visible row range (for windowing).
  const [firstRow, lastRow] = useMemo(() => {
    if (!windowed) return [0, rowCount - 1] as [number, number]
    const { offsets } = rowLayout
    let lo = 0
    let hi = rowCount - 1
    // binary-ish linear scan (rowCount can be large; do a binary search)
    const top = scrollTop - 200
    const bottom = scrollTop + viewportH + 200
    // binary search for first visible
    let a = 0
    let b = rowCount - 1
    while (a < b) {
      const m = (a + b) >> 1
      if (offsets[m] + rowLayout.heights[m] < top) a = m + 1
      else b = m
    }
    lo = a
    // linear forward for last
    hi = lo
    while (hi < rowCount - 1 && offsets[hi] < bottom) hi++
    return [lo, hi] as [number, number]
  }, [windowed, rowCount, rowLayout, scrollTop, viewportH])

  // ---- pointer -> absolute base index --------------------------------------
  const indexFromPointer = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = scrollRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left - POS_W - 8 + el.scrollLeft
      const y = clientY - rect.top + el.scrollTop
      if (y < 0) return null
      // find row by offsets
      const { offsets, heights } = rowLayout
      let row = 0
      // binary search
      let a = 0
      let b = rowCount - 1
      while (a < b) {
        const m = (a + b + 1) >> 1
        if (offsets[m] <= y) a = m
        else b = m - 1
      }
      row = a
      if (row < 0 || row >= rowCount) return null
      void heights
      let col = Math.round(x / charW)
      if (col < 0) col = 0
      if (col > BASES_PER_ROW) col = BASES_PER_ROW
      const abs = row * BASES_PER_ROW + col
      return Math.max(0, Math.min(abs, len))
    },
    [rowLayout, rowCount, charW, len]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      const idx = indexFromPointer(e.clientX, e.clientY)
      if (idx == null) return
      dragging.current = { anchor: idx }
      setSelection({ start: idx, end: idx })
      e.preventDefault()
    },
    [indexFromPointer, setSelection]
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      const idx = indexFromPointer(e.clientX, e.clientY)
      if (idx == null) return
      const a = dragging.current.anchor
      const start = Math.min(a, idx)
      const end = Math.max(a, idx)
      setSelection({ start, end })
    },
    [indexFromPointer, setSelection]
  )

  useEffect(() => {
    const up = (): void => {
      dragging.current = null
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // double click -> select feature under pointer
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const idx = indexFromPointer(e.clientX, e.clientY)
      if (idx == null || !record) return
      // find smallest feature covering idx
      let best: Feature | null = null
      let bestLen = Infinity
      for (const f of features) {
        const covers = featureCovers(f, len, circular)
        const inside = covers.some(([s, en]) => idx >= s && idx < en)
        if (inside) {
          const l = spanLength(f.start, f.end, len, record.topology)
          if (l < bestLen) {
            best = f
            bestLen = l
          }
        }
      }
      if (best) {
        setSelectedFeatureId(best.id)
        setSelection({ start: best.start, end: best.end })
      }
    },
    [indexFromPointer, record, features, len, circular, setSelectedFeatureId, setSelection]
  )

  const doGoto = useCallback(() => {
    const n = parseInt(gotoValue, 10)
    if (!Number.isFinite(n) || n < 1) return
    const target = Math.min(Math.max(n - 1, 0), Math.max(len - 1, 0))
    const row = Math.floor(target / BASES_PER_ROW)
    const el = scrollRef.current
    if (el) el.scrollTo({ top: Math.max(0, rowLayout.offsets[row] - 40), behavior: 'smooth' })
    setSelection({ start: target, end: target + 1 })
  }, [gotoValue, len, rowLayout, setSelection])

  const newFeatureFromSelection = useCallback(() => {
    if (!selection || selection.start === selection.end) return
    addFeature({
      name: 'New feature',
      type: 'misc_feature',
      start: selection.start,
      end: selection.end,
      strand: 1
    })
  }, [selection, addFeature])

  // ---- empty state ---------------------------------------------------------
  if (!record || len === 0) {
    return (
      <div className="empty-state">
        <div className="dim">No sequence to display.</div>
      </div>
    )
  }

  const selStart = selection ? Math.min(selection.start, selection.end) : -1
  const selEnd = selection ? Math.max(selection.start, selection.end) : -1
  const selLen = selStart >= 0 ? selEnd - selStart : 0

  // ---- render one row ------------------------------------------------------
  function renderRow(row: number): JSX.Element {
    const rowStart = row * BASES_PER_ROW
    const rowEnd = Math.min(rowStart + BASES_PER_ROW, len)
    const n = rowEnd - rowStart
    const top = rowLayout.offsets[row]
    const rowCuts = cutsByRow[row] ?? []
    const segs = segsByRow[row] ?? []
    const lanes = maxLaneByRow[row] + 1
    const transFwd = showTranslation ? 3 : 0
    const transRev = showTranslation && showReverseFrames ? 3 : 0
    const hasCutTrack = rowCuts.length > 0

    // vertical cursor within the row
    let yCursor = 0
    const cutY = hasCutTrack ? yCursor : -1
    if (hasCutTrack) yCursor += 16
    const revY = yCursor
    yCursor += transRev * 14
    const topY = yCursor
    yCursor += BASE_LINE_H
    const compY = showComplement ? yCursor : -1
    if (showComplement) yCursor += BASE_LINE_H
    const fwdY = yCursor
    yCursor += transFwd * 14
    const laneY = yCursor

    const rowW = POS_W + 8 + BASES_PER_ROW * charW + 30

    const els: JSX.Element[] = []

    // selection highlight band (behind bases)
    if (selStart >= 0) {
      const a = Math.max(selStart, rowStart)
      const b = Math.min(selEnd, rowEnd)
      if (b > a) {
        const x = POS_W + 8 + (a - rowStart) * charW
        const w = (b - a) * charW
        const bandTop = topY - 1
        const bandH = (showComplement ? BASE_LINE_H * 2 : BASE_LINE_H) + 2
        els.push(
          <div
            key="sel"
            style={{
              position: 'absolute',
              left: x,
              top: bandTop,
              width: w,
              height: bandH,
              background: 'var(--accent-soft)',
              borderLeft: a === selStart ? '2px solid var(--accent)' : 'none',
              borderRight: b === selEnd ? '2px solid var(--accent)' : 'none',
              pointerEvents: 'none'
            }}
          />
        )
      } else if (selLen === 0 && selStart >= rowStart && selStart <= rowEnd) {
        // caret
        const x = POS_W + 8 + (selStart - rowStart) * charW
        els.push(
          <div
            key="caret"
            style={{
              position: 'absolute',
              left: x - 1,
              top: topY - 1,
              width: 2,
              height: (showComplement ? BASE_LINE_H * 2 : BASE_LINE_H) + 2,
              background: 'var(--accent)',
              pointerEvents: 'none'
            }}
          />
        )
      }
    }

    // position gutter (1-based)
    els.push(
      <div
        key="pos"
        style={{
          position: 'absolute',
          left: 0,
          top: topY,
          width: POS_W - 6,
          textAlign: 'right',
          color: 'var(--text-faint)',
          fontFamily: 'var(--mono)',
          fontSize: 12,
          lineHeight: `${BASE_LINE_H}px`,
          pointerEvents: 'none'
        }}
      >
        {rowStart + 1}
      </div>
    )

    // top strand bases
    const topChars: JSX.Element[] = []
    for (let i = 0; i < n; i++) {
      const abs = rowStart + i
      topChars.push(
        <span key={i} style={{ position: 'absolute', left: i * charW, width: charW, textAlign: 'center', color: baseColorVar(seq[abs]) }}>
          {seq[abs]}
        </span>
      )
    }
    els.push(
      <div
        key="top"
        style={{
          position: 'absolute',
          left: POS_W + 8,
          top: topY,
          height: BASE_LINE_H,
          lineHeight: `${BASE_LINE_H}px`,
          fontFamily: 'var(--mono)',
          fontSize: 13,
          letterSpacing: 0,
          whiteSpace: 'pre'
        }}
      >
        {topChars}
      </div>
    )

    // bottom (complement) strand 3'->5'
    if (showComplement) {
      const compChars: JSX.Element[] = []
      for (let i = 0; i < n; i++) {
        const abs = rowStart + i
        compChars.push(
          <span key={i} style={{ position: 'absolute', left: i * charW, width: charW, textAlign: 'center', color: 'var(--text-faint)' }}>
            {comp[abs]}
          </span>
        )
      }
      els.push(
        <div
          key="comp"
          style={{
            position: 'absolute',
            left: POS_W + 8,
            top: compY,
            height: BASE_LINE_H,
            lineHeight: `${BASE_LINE_H}px`,
            fontFamily: 'var(--mono)',
            fontSize: 13,
            whiteSpace: 'pre'
          }}
        >
          {compChars}
        </div>
      )
    }

    // forward translation frames (below complement)
    if (showTranslation && frameTranslations) {
      frameTranslations.fwd.forEach((ft, fi) => {
        const y = fwdY + fi * 14
        const chars: JSX.Element[] = []
        // codon starting at absolute position p = ft.frame + 3*k; AA index k.
        // place AA letter centered over the 3 codon columns if codon start in row.
        for (let abs = rowStart; abs < rowEnd; abs++) {
          if ((abs - ft.frame) % 3 !== 0 || abs < ft.frame) continue
          const k = (abs - ft.frame) / 3
          const aa = ft.protein[k]
          if (!aa) continue
          const col = abs - rowStart
          chars.push(
            <span
              key={abs}
              style={{
                position: 'absolute',
                left: col * charW,
                width: charW * 3,
                textAlign: 'center',
                color: aa === '*' ? 'var(--bad)' : 'var(--text-dim)'
              }}
            >
              {aa}
            </span>
          )
        }
        els.push(
          <div
            key={`fwd${fi}`}
            style={{
              position: 'absolute',
              left: POS_W + 8,
              top: y,
              height: 13,
              lineHeight: '13px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              whiteSpace: 'pre'
            }}
          >
            {chars}
          </div>
        )
      })
    }

    // reverse translation frames (above top strand)
    if (showTranslation && showReverseFrames && frameTranslations) {
      const L = len
      frameTranslations.rev.forEach((ft, fi) => {
        const y = revY + fi * 14
        const chars: JSX.Element[] = []
        // protein index k -> rc codon start rcPos = ft.frame + 3k.
        // map rc coordinate q to top-strand coordinate: top = L-1-q.
        // codon occupies rc [rcPos, rcPos+3) -> top [L-rcPos-3+1 ... ] ; its
        // left-most top coordinate is L - (rcPos+3).
        for (let k = 0; k < ft.protein.length; k++) {
          const rcPos = ft.frame + 3 * k
          const topLeft = L - (rcPos + 3)
          if (topLeft < 0) continue
          if (topLeft >= rowStart && topLeft < rowEnd) {
            const aa = ft.protein[k]
            if (!aa) continue
            const col = topLeft - rowStart
            chars.push(
              <span
                key={k}
                style={{
                  position: 'absolute',
                  left: col * charW,
                  width: charW * 3,
                  textAlign: 'center',
                  color: aa === '*' ? 'var(--bad)' : 'var(--text-faint)'
                }}
              >
                {aa}
              </span>
            )
          }
        }
        els.push(
          <div
            key={`rev${fi}`}
            style={{
              position: 'absolute',
              left: POS_W + 8,
              top: y,
              height: 13,
              lineHeight: '13px',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              whiteSpace: 'pre'
            }}
          >
            {chars}
          </div>
        )
      })
    }

    // feature lane bars
    for (const sg of segs) {
      const f = sg.feature
      const color = featureColor(f)
      const y = laneY + sg.lane * 13
      const x = POS_W + 8 + sg.col * charW
      const w = sg.span * charW
      const active = f.id === selectedFeatureId || f.id === hoveredFeatureId
      els.push(
        <div
          key={`fbar-${f.id}-${sg.col}`}
          onMouseEnter={() => setHoveredFeatureId(f.id)}
          onMouseLeave={() => setHoveredFeatureId(null)}
          title={`${f.name} (${f.type})`}
          style={{
            position: 'absolute',
            left: x,
            top: y + 2,
            width: Math.max(w, 2),
            height: 7,
            background: color,
            opacity: active ? 1 : 0.78,
            borderRadius: 2,
            boxShadow: active ? `0 0 0 1px var(--accent)` : 'none',
            cursor: 'pointer'
          }}
        />
      )
      if (sg.hasStart) {
        els.push(
          <div
            key={`flabel-${f.id}`}
            style={{
              position: 'absolute',
              left: x,
              top: y - 9,
              fontSize: 10,
              color: 'var(--text-dim)',
              fontFamily: 'var(--sans)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              maxWidth: BASES_PER_ROW * charW,
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {f.strand === -1 ? '◄ ' : ''}
            {f.name}
            {f.strand === 1 ? ' ►' : ''}
          </div>
        )
      }
    }

    // enzyme cut markers (above the top strand)
    for (const c of rowCuts) {
      const col = c.cutPosTop - rowStart
      const x = POS_W + 8 + col * charW
      els.push(
        <div key={`cut-${c.enzyme}-${c.cutPosTop}`} style={{ position: 'absolute', left: x - 0.5, top: cutY, pointerEvents: 'none' }}>
          <div
            style={{
              position: 'absolute',
              left: -3,
              top: 11,
              width: 0,
              height: 0,
              borderLeft: '3px solid transparent',
              borderRight: '3px solid transparent',
              borderTop: '4px solid var(--warn)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 4,
              top: -1,
              fontSize: 9.5,
              color: 'var(--warn)',
              fontFamily: 'var(--sans)',
              whiteSpace: 'nowrap'
            }}
          >
            {c.enzyme}
          </div>
        </div>
      )
    }

    return (
      <div key={row} style={{ position: 'absolute', top, left: 0, height: rowLayout.heights[row], width: rowW }}>
        {els}
      </div>
    )
  }

  const rowsToRender: JSX.Element[] = []
  for (let r = firstRow; r <= lastRow && r < rowCount; r++) rowsToRender.push(renderRow(r))

  const contentW = POS_W + 8 + BASES_PER_ROW * charW + 30

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg)' }}>
      {/* toolbar */}
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
        <ToggleBtn active={showComplement} onClick={() => setShowComplement((v) => !v)} label="Complement" />
        <ToggleBtn active={showTranslation} onClick={() => setShowTranslation(!showTranslation)} label="Translation" />
        {showTranslation && (
          <ToggleBtn active={showReverseFrames} onClick={() => setShowReverseFrames((v) => !v)} label="Rev frames" />
        )}
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
          {selLen > 0 ? `${selStart + 1}–${selEnd} (${selLen} bp)` : `${len.toLocaleString()} bp · ${circular ? 'circular' : 'linear'}`}
        </span>
        <input
          value={gotoValue}
          onChange={(e) => setGotoValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doGoto()
          }}
          placeholder="Go to…"
          style={{ width: 78, fontSize: 12, padding: '4px 7px' }}
        />
        <button onClick={doGoto} style={{ fontSize: 12 }}>
          Go
        </button>
        <button
          className="primary"
          disabled={!selection || selStart === selEnd}
          onClick={newFeatureFromSelection}
          style={{ fontSize: 12 }}
          title="Create a misc_feature from the current selection"
        >
          + Feature
        </button>
      </div>

      {/* scrollable sequence body */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onDoubleClick={onDoubleClick}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', cursor: 'text', padding: '14px 0 40px' }}
      >
        {/* hidden measuring element for char width */}
        <span
          ref={measureRef}
          style={{
            position: 'absolute',
            visibility: 'hidden',
            fontFamily: 'var(--mono)',
            fontSize: 13,
            whiteSpace: 'pre',
            top: 0,
            left: 0
          }}
        >
          MMMMMMMMMM
        </span>
        <div style={{ position: 'relative', height: rowLayout.total + 14, width: contentW, margin: '0 auto' }}>
          {rowsToRender}
        </div>
      </div>
    </div>
  )
}

function ToggleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        background: active ? 'var(--accent-soft)' : 'var(--bg-input)',
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        color: active ? 'var(--accent-strong)' : 'var(--text-dim)'
      }}
    >
      {label}
    </button>
  )
}
