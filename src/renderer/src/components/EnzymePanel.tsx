/**
 * EnzymePanel — restriction-enzyme analysis.
 *
 * LEFT  : searchable / filterable / sortable enzyme picker with per-enzyme
 *         recognition site (caret-annotated cut), live cut count and a checkbox
 *         bound to the store's enabledEnzymes set.
 * RIGHT : digest results for the enabled enzymes — a fragments table, a virtual
 *         agarose gel (with a standard DNA ladder) and unique-cutter / non-cutter
 *         summaries.
 *
 * All derived data comes from the shared hooks / engines; cut counts are
 * computed once with cutCounts(record, ENZYMES), memoized on record identity.
 */
import { useMemo, useState } from 'react'
import { useStore } from '@state/store'
import { useFragments } from '../hooks/derived'
import { ENZYMES, cutCounts } from '@core/enzymes'
import type { Enzyme, Fragment } from '@core/types'

// ---------------------------------------------------------------------------
// cutCountFilter encoding (local convention, store documents only "0 = no filter")
//   0  = All           -1 = Non-cutters (0 sites)
//   1  = Unique (1)      2 = Double (2)      3 = 3+  (>=3)
// ---------------------------------------------------------------------------
const FILTER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'All' },
  { value: -1, label: 'Non-cutters' },
  { value: 1, label: 'Unique' },
  { value: 2, label: 'Double' },
  { value: 3, label: '3+' }
]

const COMMON_6CUTTERS = [
  'EcoRI', 'BamHI', 'HindIII', 'XhoI', 'SalI', 'XbaI', 'NheI', 'SpeI',
  'NcoI', 'NdeI', 'KpnI', 'SacI', 'NotI', 'PstI', 'SphI', 'EcoRV'
]

/** Build a caret-annotated recognition site, e.g. EcoRI -> "G^AATTC". */
function caretSite(enz: Enzyme): string {
  const { site, cutTop } = enz
  // Type IIS / distal cutters cut outside the recognition site — a caret is
  // meaningless there, so show the cut offsets instead.
  if (cutTop < 0 || cutTop > site.length) {
    return `${site} (N${cutTop}/${enz.cutBottom})`
  }
  return `${site.slice(0, cutTop)}^${site.slice(cutTop)}`
}

function fmtBp(n: number): string {
  return n.toLocaleString('en-US')
}

// Standard DNA ladder rungs (bp), high -> low.
const LADDER = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250]

export function EnzymePanel(): JSX.Element {
  const record = useStore((s) => s.record)
  const enabledEnzymes = useStore((s) => s.enabledEnzymes)
  const toggleEnzyme = useStore((s) => s.toggleEnzyme)
  const setEnabledEnzymes = useStore((s) => s.setEnabledEnzymes)
  const cutCountFilter = useStore((s) => s.cutCountFilter)
  const setCutCountFilter = useStore((s) => s.setCutCountFilter)
  const setSelection = useStore((s) => s.setSelection)
  const selection = useStore((s) => s.selection)

  const fragments = useFragments()

  const [search, setSearch] = useState('')
  const [sortByCuts, setSortByCuts] = useState(false)

  // Computed ONCE per record over the FULL enzyme DB.
  const counts = useMemo(
    () => (record ? cutCounts(record, ENZYMES) : new Map<string, number>()),
    [record]
  )

  const enabledSet = useMemo(() => new Set(enabledEnzymes), [enabledEnzymes])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = ENZYMES.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.site.toLowerCase().includes(q)) {
        return false
      }
      const c = counts.get(e.name) ?? 0
      switch (cutCountFilter) {
        case -1: return c === 0
        case 1: return c === 1
        case 2: return c === 2
        case 3: return c >= 3
        default: return true // 0 = All
      }
    })
    list = [...list].sort((a, b) => {
      if (sortByCuts) {
        const d = (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0)
        if (d !== 0) return d
      }
      return a.name.localeCompare(b.name)
    })
    return list
  }, [search, counts, cutCountFilter, sortByCuts])

  // ---- digest summaries (hooks must run before the early return) ------------
  const sortedFragments = useMemo(
    () => [...fragments].sort((a, b) => b.length - a.length),
    [fragments]
  )
  const enabledObjs = useMemo(
    () => ENZYMES.filter((e) => enabledSet.has(e.name)),
    [enabledSet]
  )

  if (!record) {
    return (
      <div className="empty-state">
        <div className="dim">No sequence open</div>
        <div className="faint" style={{ fontSize: 12 }}>
          Open a construct to analyze restriction sites.
        </div>
      </div>
    )
  }

  const seqLen = record.sequence.length

  const selectUnique = (): void =>
    setEnabledEnzymes(ENZYMES.filter((e) => (counts.get(e.name) ?? 0) === 1).map((e) => e.name))
  const clearAll = (): void => setEnabledEnzymes([])
  const selectCommon6 = (): void => {
    const have = new Set(ENZYMES.map((e) => e.name))
    setEnabledEnzymes(COMMON_6CUTTERS.filter((n) => have.has(n)))
  }

  const totalBp = sortedFragments.reduce((s, f) => s + f.length, 0)
  const uniqueCutters = enabledObjs.filter((e) => (counts.get(e.name) ?? 0) === 1).map((e) => e.name)
  const nonCutters = enabledObjs.filter((e) => (counts.get(e.name) ?? 0) === 0).map((e) => e.name)

  // ---- colors per checkbox state -------------------------------------------
  const countColor = (c: number): string => {
    if (c === 0) return 'var(--text-faint)'
    if (c === 1) return 'var(--good)'
    return 'var(--text-dim)'
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* ================= LEFT: picker ================= */}
      <div
        style={{
          width: 340,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        <div className="panel-title">Restriction Enzymes</div>

        {/* search + filters */}
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or site…"
            spellCheck={false}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {FILTER_OPTIONS.map((o) => {
              const active = cutCountFilter === o.value
              return (
                <button
                  key={o.value}
                  onClick={() => setCutCountFilter(o.value)}
                  style={{
                    padding: '3px 9px',
                    fontSize: 11.5,
                    background: active ? 'var(--accent)' : 'var(--bg-input)',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    color: active ? '#fff' : 'var(--text-dim)'
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setSortByCuts((v) => !v)}
              style={{ padding: '3px 9px', fontSize: 11.5 }}
              title="Toggle sort order"
            >
              Sort: {sortByCuts ? 'cuts' : 'name'}
            </button>
            <span className="spacer" />
            <span className="faint" style={{ fontSize: 11 }}>
              {visible.length} / {ENZYMES.length}
            </span>
          </div>
        </div>

        {/* quick actions */}
        <div style={{ padding: '0 12px 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button onClick={selectUnique} style={{ padding: '3px 8px', fontSize: 11.5 }}>
            Unique cutters
          </button>
          <button onClick={selectCommon6} style={{ padding: '3px 8px', fontSize: 11.5 }}>
            Common 6-cutters
          </button>
          <button onClick={clearAll} style={{ padding: '3px 8px', fontSize: 11.5 }}>
            Clear
          </button>
        </div>

        {/* enzyme list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 6px 10px' }}>
          {visible.length === 0 ? (
            <div className="faint" style={{ padding: 16, fontSize: 12, textAlign: 'center' }}>
              No enzymes match.
            </div>
          ) : (
            visible.map((e) => {
              const c = counts.get(e.name) ?? 0
              const on = enabledSet.has(e.name)
              return (
                <label
                  key={e.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr auto',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 8px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    background: on ? 'var(--accent-soft)' : 'transparent'
                  }}
                  onMouseEnter={(ev) => {
                    if (!on) (ev.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(ev) => {
                    ;(ev.currentTarget as HTMLElement).style.background = on
                      ? 'var(--accent-soft)'
                      : 'transparent'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleEnzyme(e.name)}
                    style={{ width: 14, height: 14, accentColor: 'var(--accent)' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{e.name}</div>
                    <div
                      className="mono"
                      style={{ fontSize: 11.5, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
                    >
                      {caretSite(e)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 12,
                      fontWeight: 600,
                      color: countColor(c),
                      minWidth: 22,
                      textAlign: 'right'
                    }}
                    title={`${c} cut site${c === 1 ? '' : 's'}`}
                  >
                    {c}
                  </div>
                </label>
              )
            })
          )}
        </div>
      </div>

      {/* ================= RIGHT: digest ================= */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          className="panel-title"
          style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
        >
          <span>Digest</span>
          <span className="spacer" />
          <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontWeight: 500 }}>
            {enabledObjs.length} enzyme{enabledObjs.length === 1 ? '' : 's'} ·{' '}
            {fmtBp(seqLen)} bp {record.topology}
          </span>
        </div>

        {enabledObjs.length === 0 ? (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="dim">No enzymes enabled</div>
            <div className="faint" style={{ fontSize: 12 }}>
              Check enzymes on the left to run a virtual digest.
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
            {/* fragments table */}
            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 12px 14px' }}>
              <FragmentTable
                fragments={sortedFragments}
                seqLen={seqLen}
                totalBp={totalBp}
                selection={selection}
                onPick={(f) => setSelection({ start: f.start, end: f.end })}
              />

              {/* summaries */}
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SummaryLine label="Unique cutters" names={uniqueCutters} accent="var(--good)" />
                <SummaryLine label="Non-cutters" names={nonCutters} accent="var(--text-faint)" />
              </div>
            </div>

            {/* gel */}
            <div
              style={{
                width: 210,
                flexShrink: 0,
                borderLeft: '1px solid var(--border)',
                padding: '8px 0 14px',
                overflowY: 'auto'
              }}
            >
              <Gel fragments={sortedFragments} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fragments table
// ---------------------------------------------------------------------------
function FragmentTable(props: {
  fragments: Fragment[]
  seqLen: number
  totalBp: number
  selection: { start: number; end: number } | null
  onPick: (f: Fragment) => void
}): JSX.Element {
  const { fragments, totalBp, selection, onPick } = props
  const th: React.CSSProperties = {
    textAlign: 'left',
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-faint)',
    fontWeight: 600,
    padding: '4px 8px',
    position: 'sticky',
    top: 0,
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)'
  }
  const td: React.CSSProperties = { padding: '4px 8px', fontSize: 12 }

  if (fragments.length === 0) {
    return (
      <div className="faint" style={{ padding: 16, fontSize: 12 }}>
        No cut sites for the enabled enzymes — molecule is undigested.
      </div>
    )
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
      <thead>
        <tr>
          <th style={{ ...th, width: 28 }}>#</th>
          <th style={{ ...th, textAlign: 'right' }}>Size (bp)</th>
          <th style={th}>Ends</th>
          <th style={{ ...th, textAlign: 'right' }}>Position</th>
        </tr>
      </thead>
      <tbody>
        {fragments.map((f, i) => {
          const left = f.leftEnzyme ?? '—'
          const right = f.rightEnzyme ?? '—'
          // 1-based display; wrap-aware for origin-spanning circular fragments.
          const wraps = f.start > f.end
          const posLabel = `${f.start + 1}…${f.end}${wraps ? ' ↻' : ''}`
          const isSel =
            selection != null && selection.start === f.start && selection.end === f.end
          return (
            <tr
              key={`${f.start}-${f.end}-${i}`}
              onClick={() => onPick(f)}
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
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtBp(f.length)}</td>
              <td style={{ ...td, color: 'var(--text-dim)' }}>
                <span style={{ color: f.leftEnzyme ? 'var(--accent-strong)' : 'var(--text-faint)' }}>
                  {left}
                </span>
                <span style={{ color: 'var(--text-faint)' }}> – </span>
                <span style={{ color: f.rightEnzyme ? 'var(--accent-strong)' : 'var(--text-faint)' }}>
                  {right}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'right', color: 'var(--text-dim)' }} className="mono">
                {posLabel}
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td style={{ ...td, color: 'var(--text-faint)', fontWeight: 600 }}>{fragments.length}</td>
          <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
            {fmtBp(totalBp)}
          </td>
          <td style={{ ...td, color: 'var(--text-faint)' }} colSpan={2}>
            total
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Summary line (unique cutters / non-cutters)
// ---------------------------------------------------------------------------
function SummaryLine(props: { label: string; names: string[]; accent: string }): JSX.Element {
  const { label, names, accent } = props
  return (
    <div style={{ fontSize: 12 }}>
      <span
        style={{
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-faint)',
          fontWeight: 600,
          marginRight: 8
        }}
      >
        {label} ({names.length})
      </span>
      {names.length === 0 ? (
        <span className="faint">none</span>
      ) : (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, verticalAlign: 'middle' }}>
          {names.map((n) => (
            <span
              key={n}
              className="tag"
              style={{ color: accent, background: 'var(--bg-active)' }}
            >
              {n}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Virtual agarose gel
// ---------------------------------------------------------------------------
function Gel(props: { fragments: Fragment[] }): JSX.Element {
  const { fragments } = props

  const W = 200
  const H = 460
  const topPad = 24
  const botPad = 18
  const laneW = 64
  const ladderX = 30
  const sampleX = 118

  // log10 domain clamped to ladder range so off-scale bands stay on the lane.
  const minBp = LADDER[LADDER.length - 1]
  const maxBp = LADDER[0]
  const lo = Math.log10(minBp)
  const hi = Math.log10(maxBp)
  const yFor = (bp: number): number => {
    const clamped = Math.min(maxBp, Math.max(minBp, bp))
    const t = (Math.log10(clamped) - lo) / (hi - lo) // 0 at minBp .. 1 at maxBp
    // larger fragments migrate less -> sit HIGHER (smaller y)
    return topPad + (1 - t) * (H - topPad - botPad)
  }

  const maxLen = fragments.reduce((m, f) => Math.max(m, f.length), 1)

  return (
    <div>
      <div className="panel-title" style={{ paddingLeft: 16 }}>
        Gel
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', maxWidth: 200, margin: '0 auto' }}
        role="img"
        aria-label="virtual agarose gel"
      >
        {/* gel slab */}
        <rect
          x={6}
          y={topPad - 14}
          width={W - 12}
          height={H - topPad - botPad + 22}
          rx={6}
          fill="#0e1014"
          stroke="var(--border)"
        />
        {/* lane labels */}
        <text x={ladderX} y={topPad - 4} fontSize={9} fill="var(--text-faint)" textAnchor="middle">
          ladder
        </text>
        <text x={sampleX} y={topPad - 4} fontSize={9} fill="var(--text-faint)" textAnchor="middle">
          digest
        </text>

        {/* ladder rungs */}
        {LADDER.map((bp) => {
          const y = yFor(bp)
          return (
            <g key={bp}>
              <rect
                x={ladderX - laneW / 2 + 4}
                y={y - 1.4}
                width={laneW - 8}
                height={2.8}
                rx={1.4}
                fill="#7d8694"
                opacity={0.85}
              />
              <text
                x={ladderX - laneW / 2 - 2}
                y={y + 3}
                fontSize={8}
                fill="var(--text-faint)"
                textAnchor="end"
              >
                {bp >= 1000 ? `${bp / 1000}k` : bp}
              </text>
            </g>
          )
        })}

        {/* sample bands */}
        {fragments.map((f, i) => {
          const y = yFor(f.length)
          // brightness ∝ mass ∝ length, normalized to the biggest fragment.
          const intensity = 0.32 + 0.68 * (f.length / maxLen)
          const offScale = f.length < minBp || f.length > maxBp
          return (
            <g key={`${f.start}-${i}`}>
              <rect
                x={sampleX - laneW / 2 + 4}
                y={y - 1.7}
                width={laneW - 8}
                height={3.4}
                rx={1.7}
                fill="var(--accent-strong)"
                opacity={intensity}
              />
              {/* glow for the brightest bands */}
              {intensity > 0.7 && (
                <rect
                  x={sampleX - laneW / 2 + 2}
                  y={y - 3}
                  width={laneW - 4}
                  height={6}
                  rx={3}
                  fill="var(--accent-strong)"
                  opacity={(intensity - 0.7) * 0.5}
                />
              )}
              {/* label prominent bands (top ~6 by size) */}
              {i < 6 && (
                <text
                  x={sampleX + laneW / 2 - 1}
                  y={y + 3}
                  fontSize={8}
                  fill={offScale ? 'var(--warn)' : 'var(--text-dim)'}
                  textAnchor="start"
                >
                  {fmtBp(f.length)}
                </text>
              )}
            </g>
          )
        })}

        {fragments.length === 0 && (
          <text x={W / 2} y={H / 2} fontSize={10} fill="var(--text-faint)" textAnchor="middle">
            no fragments
          </text>
        )}
      </svg>
    </div>
  )
}
