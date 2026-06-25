/**
 * OrfPanel — ORF / translation analysis.
 *
 * TOP BAR : minimum ORF length (aa) with quick presets, a "require ATG start"
 *           toggle, a strand filter (both / forward / reverse) and a sort toggle
 *           (length / start position).
 * HEADLINE: count summary + the longest ORF surfaced prominently.
 * STRIP   : a compact six-frame map — three forward + three reverse tracks drawn
 *           as inline SVG across the whole molecule. ORFs render as colored bars
 *           (top-strand coords straight from findOrfs); stop codons render as
 *           faint ticks (from sixFrameTranslate). Clicking a bar selects the ORF.
 * TABLE   : every ORF (strand-filtered, sorted) — index, strand arrow, frame,
 *           1-based start..end (wrap-aware), aa length, MW (kDa), and the protein
 *           sequence (truncated, click to expand). Row click selects the span;
 *           a per-row "+ CDS" button annotates the ORF as a feature.
 *
 * findOrfs is called directly (memoized on record + options) so the panel owns
 * the minAA / requireStart parameters. `orf.length` is the aa count EXCLUDING the
 * stop; `orf.protein` already carries the trailing stop as '*'.
 */
import { useMemo, useState } from 'react'
import { useStore } from '@state/store'
import { findOrfs, sixFrameTranslate, molecularWeightProtein } from '@core/translation'
import type { Orf } from '@core/types'

type StrandFilter = 'both' | 'fwd' | 'rev'
type SortKey = 'length' | 'start'

const PRESETS = [30, 75, 100, 150]
const PROTEIN_PREVIEW = 60

// Forward bars warm, reverse bars cool — matched to the strand arrows.
const FWD_COLOR = '#cf8d3a'
const REV_COLOR = '#9d6bcf'

function fmtBp(n: number): string {
  return n.toLocaleString('en-US')
}

/** A unique-per-render identity for an ORF (coordinates are unique by frame). */
function orfKey(o: Orf): string {
  return `${o.start}:${o.end}:${o.strand}:${o.frame}`
}

export function OrfPanel(): JSX.Element {
  const record = useStore((s) => s.record)
  const setSelection = useStore((s) => s.setSelection)
  const setSelectedFeatureId = useStore((s) => s.setSelectedFeatureId)
  const addFeature = useStore((s) => s.addFeature)
  const selection = useStore((s) => s.selection)

  const [minAA, setMinAA] = useState(75)
  const [requireStart, setRequireStart] = useState(true)
  const [strandFilter, setStrandFilter] = useState<StrandFilter>('both')
  const [sortBy, setSortBy] = useState<SortKey>('length')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedOrf, setSelectedOrf] = useState<string | null>(null)

  // Direct, parameterized call (the shared useOrfs hook can't carry requireStart).
  const allOrfs = useMemo(
    () => (record ? findOrfs(record, { minAA, requireStart }) : []),
    [record, minAA, requireStart]
  )

  // Strand-filtered + sorted list. All headline stats derive from THIS list so
  // the summary always matches what the table shows.
  const orfs = useMemo(() => {
    let list = allOrfs
    if (strandFilter === 'fwd') list = list.filter((o) => o.strand === 1)
    else if (strandFilter === 'rev') list = list.filter((o) => o.strand === -1)
    const sorted = [...list]
    if (sortBy === 'length') sorted.sort((a, b) => b.length - a.length || a.start - b.start)
    else sorted.sort((a, b) => a.start - b.start || b.length - a.length)
    return sorted
  }, [allOrfs, strandFilter, sortBy])

  // Six-frame stop ticks for the strip (forward + reverse), memoized on sequence.
  const frames = useMemo(
    () => (record ? sixFrameTranslate(record.sequence) : []),
    [record]
  )

  if (!record) {
    return (
      <div className="empty-state">
        <div className="dim">No sequence open</div>
        <div className="faint" style={{ fontSize: 12 }}>
          Open a construct to scan for open reading frames.
        </div>
      </div>
    )
  }

  const seqLen = record.sequence.length

  const longest = orfs.reduce<Orf | null>(
    (best, o) => (best === null || o.length > best.length ? o : best),
    null
  )
  const fwdCount = orfs.filter((o) => o.strand === 1).length
  const revCount = orfs.length - fwdCount

  const pickOrf = (o: Orf): void => {
    setSelection({ start: o.start, end: o.end })
    setSelectedFeatureId(null)
    setSelectedOrf(orfKey(o))
  }

  const toggleExpand = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const annotate = (o: Orf, rowIndex: number): void => {
    addFeature({
      name: `ORF ${rowIndex + 1}`,
      type: 'CDS',
      start: o.start,
      end: o.end,
      strand: o.strand,
      translation: o.protein
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ================= top bar ================= */}
      <div
        className="panel-title"
        style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
      >
        <span>Open Reading Frames</span>
        <span className="spacer" />
        <span
          style={{
            textTransform: 'none',
            letterSpacing: 0,
            color: 'var(--text-dim)',
            fontWeight: 500
          }}
        >
          {fmtBp(seqLen)} bp {record.topology}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          padding: '0 12px 10px',
          rowGap: 8
        }}
      >
        {/* min length */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="faint" style={{ fontSize: 11.5 }}>
            Min length (aa)
          </span>
          <input
            type="number"
            min={1}
            value={minAA}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              setMinAA(Number.isFinite(v) && v > 0 ? v : 1)
            }}
            style={{ width: 62, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          />
          <div style={{ display: 'flex', gap: 3 }}>
            {PRESETS.map((p) => {
              const active = minAA === p
              return (
                <button
                  key={p}
                  onClick={() => setMinAA(p)}
                  style={{
                    padding: '3px 8px',
                    fontSize: 11.5,
                    background: active ? 'var(--accent)' : 'var(--bg-input)',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    color: active ? '#fff' : 'var(--text-dim)'
                  }}
                >
                  {p}
                </button>
              )
            })}
          </div>
        </div>

        {/* require ATG start */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          title="Require an ATG start codon (otherwise read stop-to-stop)"
        >
          <input
            type="checkbox"
            checked={requireStart}
            onChange={(e) => setRequireStart(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 12 }}>Require ATG start</span>
        </label>

        {/* strand filter */}
        <Segmented
          value={strandFilter}
          onChange={setStrandFilter}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'fwd', label: '▶ Fwd' },
            { value: 'rev', label: '◀ Rev' }
          ]}
        />

        {/* sort */}
        <Segmented
          value={sortBy}
          onChange={setSortBy}
          options={[
            { value: 'length', label: 'Length' },
            { value: 'start', label: 'Position' }
          ]}
        />
      </div>

      {/* ================= headline summary ================= */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 10,
          padding: '0 12px 10px'
        }}
      >
        <StatCard
          big={String(orfs.length)}
          label={`ORF${orfs.length === 1 ? '' : 's'} found`}
          sub={`${fwdCount} fwd · ${revCount} rev`}
        />
        {longest ? (
          <div
            onClick={() => pickOrf(longest)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              cursor: 'pointer'
            }}
            title="Select the longest ORF"
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-faint)',
                  fontWeight: 600
                }}
              >
                Longest ORF
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                <span
                  style={{
                    color: longest.strand === 1 ? FWD_COLOR : REV_COLOR,
                    fontWeight: 700,
                    fontSize: 13
                  }}
                >
                  {longest.strand === 1 ? '▶' : '◀'} {fmtBp(longest.length)} aa
                </span>
                <span className="mono faint" style={{ fontSize: 11.5 }}>
                  {longest.start + 1}…{longest.end}
                  {longest.start > longest.end ? ' ↻' : ''}
                </span>
                <span className="faint" style={{ fontSize: 11.5 }}>
                  {(molecularWeightProtein(longest.protein) / 1000).toFixed(1)} kDa
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-faint)',
              fontSize: 12
            }}
          >
            No ORFs at the current threshold.
          </div>
        )}
      </div>

      {/* ================= six-frame strip ================= */}
      <SixFrameStrip
        orfs={orfs}
        frames={frames}
        seqLen={seqLen}
        selectedOrf={selectedOrf}
        onPick={pickOrf}
      />

      {/* ================= table ================= */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 16px' }}>
        {orfs.length === 0 ? (
          <div className="faint" style={{ padding: 20, fontSize: 12, textAlign: 'center' }}>
            No open reading frames match the current filters. Try lowering the
            minimum length or disabling “Require ATG start”.
          </div>
        ) : (
          <OrfTable
            orfs={orfs}
            expanded={expanded}
            selectedOrf={selectedOrf}
            selection={selection}
            onPick={pickOrf}
            onToggleExpand={toggleExpand}
            onAnnotate={annotate}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Segmented control (strand / sort)
// ---------------------------------------------------------------------------
function Segmented<T extends string>(props: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}): JSX.Element {
  const { value, onChange, options } = props
  return (
    <div
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden'
      }}
    >
      {options.map((o, i) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: '4px 10px',
              fontSize: 11.5,
              border: 'none',
              borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
              borderRadius: 0,
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-dim)'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard(props: { big: string; label: string; sub: string }): JSX.Element {
  return (
    <div
      style={{
        flexShrink: 0,
        minWidth: 96,
        padding: '8px 14px',
        borderRadius: 'var(--radius)',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text)'
        }}
      >
        {props.big}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>{props.label}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 1 }}>{props.sub}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Six-frame map strip
// ---------------------------------------------------------------------------
function SixFrameStrip(props: {
  orfs: Orf[]
  frames: { frame: number; strand: 1 | -1; protein: string }[]
  seqLen: number
  selectedOrf: string | null
  onPick: (o: Orf) => void
}): JSX.Element {
  const { orfs, frames, seqLen, selectedOrf, onPick } = props

  const padL = 38
  const padR = 12
  const W = 720
  const trackH = 13
  const trackGap = 4
  const groupGap = 10
  const topPad = 16
  const innerW = W - padL - padR

  // Frame rows top→bottom: fwd +1,+2,+3 then reverse -1,-2,-3.
  const rows: { strand: 1 | -1; frame: number; label: string }[] = [
    { strand: 1, frame: 0, label: '+1' },
    { strand: 1, frame: 1, label: '+2' },
    { strand: 1, frame: 2, label: '+3' },
    { strand: -1, frame: 0, label: '−1' },
    { strand: -1, frame: 1, label: '−2' },
    { strand: -1, frame: 2, label: '−3' }
  ]

  const rowY = (i: number): number => {
    const extra = i >= 3 ? groupGap : 0
    return topPad + i * (trackH + trackGap) + extra
  }
  const H = rowY(rows.length - 1) + trackH + 8

  const xFor = (base: number): number =>
    padL + (Math.max(0, Math.min(seqLen, base)) / seqLen) * innerW

  // Stop-codon ticks per row, mapped to top-strand x positions.
  const stopTicks = (strand: 1 | -1, frame: number): number[] => {
    const ft = frames.find((f) => f.strand === strand && f.frame === frame)
    if (!ft) return []
    const xs: number[] = []
    const prot = ft.protein
    for (let k = 0; k < prot.length; k++) {
      if (prot[k] !== '*') continue
      // k-th residue of frame f.
      let base: number
      if (strand === 1) base = frame + 3 * k
      // reverse: rc[f+3k] maps to top base L-1-(f+3k); the codon's LEFT edge
      // on the top strand is L - f - 3k - 3.
      else base = seqLen - frame - 3 * k - 3
      xs.push(xFor(base + 1.5)) // center of the stop codon
    }
    return xs
  }

  // Bars for ORFs grouped by their (strand,frame) row.
  const barsForRow = (strand: 1 | -1, frame: number): Orf[] =>
    orfs.filter((o) => o.strand === strand && o.frame === frame)

  return (
    <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
      <div className="panel-title" style={{ padding: '0 0 4px' }}>
        Six-frame map
      </div>
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '2px 0'
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block' }}
          role="img"
          aria-label="six-frame ORF map"
        >
          {rows.map((row, i) => {
            const y = rowY(i)
            const fwd = row.strand === 1
            const color = fwd ? FWD_COLOR : REV_COLOR
            const bars = barsForRow(row.strand, row.frame)
            const ticks = stopTicks(row.strand, row.frame)
            return (
              <g key={row.label}>
                {/* row label */}
                <text
                  x={padL - 8}
                  y={y + trackH / 2 + 3}
                  fontSize={9.5}
                  fill="var(--text-faint)"
                  textAnchor="end"
                  style={{ fontFamily: 'var(--mono)' }}
                >
                  {row.label}
                </text>
                {/* baseline track */}
                <rect
                  x={padL}
                  y={y}
                  width={innerW}
                  height={trackH}
                  rx={2}
                  fill="var(--bg-input)"
                />
                {/* stop ticks */}
                {ticks.map((tx, ti) => (
                  <line
                    key={ti}
                    x1={tx}
                    x2={tx}
                    y1={y + 1.5}
                    y2={y + trackH - 1.5}
                    stroke="var(--text-faint)"
                    strokeWidth={0.75}
                    opacity={0.5}
                  />
                ))}
                {/* ORF bars (drawn on top) */}
                {bars.map((o) => {
                  const wraps = o.start > o.end
                  const isSel = selectedOrf === orfKey(o)
                  // For wrapping ORFs draw two segments: [start, L) and [0, end).
                  const segs: [number, number][] = wraps
                    ? [
                        [o.start, seqLen],
                        [0, o.end]
                      ]
                    : [[o.start, o.end]]
                  return (
                    <g
                      key={orfKey(o)}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onPick(o)}
                    >
                      {segs.map(([s, e], si) => {
                        const x = xFor(s)
                        const w = Math.max(1.5, xFor(e) - x)
                        return (
                          <rect
                            key={si}
                            x={x}
                            y={y + 1}
                            width={w}
                            height={trackH - 2}
                            rx={2}
                            fill={color}
                            opacity={isSel ? 1 : 0.78}
                            stroke={isSel ? 'var(--text)' : 'none'}
                            strokeWidth={isSel ? 1 : 0}
                          >
                            <title>
                              {`${fwd ? '▶' : '◀'} ${o.length} aa · ${o.start + 1}…${o.end}${
                                wraps ? ' (wraps origin)' : ''
                              }`}
                            </title>
                          </rect>
                        )
                      })}
                    </g>
                  )
                })}
              </g>
            )
          })}
          {/* origin / end ruler ticks */}
          <line
            x1={padL}
            x2={padL}
            y1={topPad - 4}
            y2={H - 4}
            stroke="var(--border-strong)"
            strokeWidth={0.75}
          />
          <text x={padL} y={H - 0.5} fontSize={8} fill="var(--text-faint)" textAnchor="start">
            1
          </text>
          <text
            x={padL + innerW}
            y={H - 0.5}
            fontSize={8}
            fill="var(--text-faint)"
            textAnchor="end"
          >
            {fmtBp(seqLen)}
          </text>
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ORF table
// ---------------------------------------------------------------------------
function OrfTable(props: {
  orfs: Orf[]
  expanded: Set<string>
  selectedOrf: string | null
  selection: { start: number; end: number } | null
  onPick: (o: Orf) => void
  onToggleExpand: (key: string) => void
  onAnnotate: (o: Orf, rowIndex: number) => void
}): JSX.Element {
  const { orfs, expanded, selectedOrf, selection, onPick, onToggleExpand, onAnnotate } = props

  const th: React.CSSProperties = {
    textAlign: 'left',
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-faint)',
    fontWeight: 600,
    padding: '5px 8px',
    position: 'sticky',
    top: 0,
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    zIndex: 1
  }
  const td: React.CSSProperties = {
    padding: '5px 8px',
    fontSize: 12,
    verticalAlign: 'top'
  }

  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontVariantNumeric: 'tabular-nums',
        tableLayout: 'fixed'
      }}
    >
      <colgroup>
        <col style={{ width: 28 }} />
        <col style={{ width: 34 }} />
        <col style={{ width: 44 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 64 }} />
        <col style={{ width: 64 }} />
        <col />
        <col style={{ width: 52 }} />
      </colgroup>
      <thead>
        <tr>
          <th style={th}>#</th>
          <th style={{ ...th, textAlign: 'center' }} title="Strand">
            ±
          </th>
          <th style={th}>Frame</th>
          <th style={th}>Start…End</th>
          <th style={{ ...th, textAlign: 'right' }}>aa</th>
          <th style={{ ...th, textAlign: 'right' }}>kDa</th>
          <th style={th}>Protein</th>
          <th style={th} />
        </tr>
      </thead>
      <tbody>
        {orfs.map((o, i) => {
          const key = orfKey(o)
          const fwd = o.strand === 1
          const wraps = o.start > o.end
          const isExpanded = expanded.has(key)
          const isSel =
            selectedOrf === key ||
            (selection != null && selection.start === o.start && selection.end === o.end)
          // orf.protein carries the trailing '*'; the aa count is orf.length.
          const prot = o.protein
          const truncated = !isExpanded && prot.length > PROTEIN_PREVIEW
          const shown = truncated ? prot.slice(0, PROTEIN_PREVIEW) : prot
          const mw = molecularWeightProtein(prot) / 1000
          const color = fwd ? FWD_COLOR : REV_COLOR

          return (
            <tr
              key={key}
              onClick={() => onPick(o)}
              style={{
                cursor: 'pointer',
                background: isSel ? 'var(--accent-soft)' : 'transparent',
                borderBottom: '1px solid var(--border)'
              }}
              onMouseEnter={(e) => {
                if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = isSel
                  ? 'var(--accent-soft)'
                  : 'transparent'
              }}
            >
              <td style={{ ...td, color: 'var(--text-faint)' }}>{i + 1}</td>
              <td
                style={{
                  ...td,
                  textAlign: 'center',
                  color,
                  fontWeight: 700
                }}
                title={fwd ? 'Forward (top) strand' : 'Reverse (bottom) strand'}
              >
                {fwd ? '▶' : '◀'}
              </td>
              <td style={{ ...td, color: 'var(--text-dim)' }} className="mono">
                {fwd ? '+' : '−'}
                {o.frame + 1}
              </td>
              <td style={{ ...td, color: 'var(--text-dim)' }} className="mono">
                {o.start + 1}…{o.end}
                {wraps && (
                  <span
                    title="Wraps the origin"
                    style={{ color: 'var(--warn)', marginLeft: 4 }}
                  >
                    ↻
                  </span>
                )}
              </td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                {fmtBp(o.length)}
              </td>
              <td style={{ ...td, textAlign: 'right', color: 'var(--text-dim)' }}>
                {mw.toFixed(1)}
              </td>
              <td style={td}>
                <span
                  className="mono"
                  onClick={(e) => {
                    if (prot.length > PROTEIN_PREVIEW) {
                      e.stopPropagation()
                      onToggleExpand(key)
                    }
                  }}
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-dim)',
                    wordBreak: 'break-all',
                    cursor: prot.length > PROTEIN_PREVIEW ? 'pointer' : 'default'
                  }}
                  title={
                    prot.length > PROTEIN_PREVIEW
                      ? isExpanded
                        ? 'Click to collapse'
                        : 'Click to expand full sequence'
                      : undefined
                  }
                >
                  {shown}
                  {truncated && (
                    <span style={{ color: 'var(--accent)' }}>… +{prot.length - PROTEIN_PREVIEW}</span>
                  )}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onAnnotate(o, i)
                  }}
                  title="Annotate this ORF as a CDS feature"
                  style={{
                    padding: '2px 7px',
                    fontSize: 11,
                    whiteSpace: 'nowrap'
                  }}
                >
                  + CDS
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
