/**
 * PrimerPanel — primer design & PCR workbench.
 *
 * Three stacked cards:
 *   1. Primer analysis — live Tm/GC/clamp/hairpin/self-dimer readout for a typed
 *      oligo, a colored base track, the warnings list, and a binding-site search
 *      against the open template (clicking a hit selects its footprint).
 *   2. Design primers — grow forward/reverse primers across a region (defaults to
 *      the current selection) toward a target Tm, with copy / send-to actions.
 *   3. PCR simulation — amplify with a forward + reverse primer (0/1/2 mismatch),
 *      list products (origin-wrap aware), click a product to select its span.
 *
 * All thermodynamics / search / design come from the verified @core/primers
 * engine; this file owns only local input + result state.
 */
import { useMemo, useState } from 'react'
import { useStore } from '@state/store'
import {
  analyzePrimer,
  calcTm,
  calcGc,
  findPrimerBindingSites,
  simulatePcr,
  designPrimers
} from '@core/primers'
import { cleanSequence } from '@core/sequence'
import type { PrimerBindingSite, PcrProduct, Strand } from '@core/types'

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------
const BASE_COLOR: Record<string, string> = {
  A: 'var(--base-a)',
  C: 'var(--base-c)',
  G: 'var(--base-g)',
  T: 'var(--base-t)'
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10
}

const cardTitle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-faint)',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  gap: 8
}

const microLabel: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-faint)',
  fontWeight: 600
}

function tmColor(tm: number): string {
  if (tm >= 55 && tm <= 65) return 'var(--good)'
  if (tm >= 50 && tm <= 70) return 'var(--warn)'
  return 'var(--bad)'
}
function gcColor(gc: number): string {
  if (gc >= 40 && gc <= 60) return 'var(--good)'
  if (gc >= 30 && gc <= 70) return 'var(--warn)'
  return 'var(--bad)'
}

/** A small metric pill: big number + unit + caption, color-coded. */
function Metric(props: {
  label: string
  value: string
  color?: string
  title?: string
}): JSX.Element {
  return (
    <div
      title={props.title}
      style={{
        flex: '1 1 0',
        minWidth: 60,
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}
    >
      <span style={microLabel}>{props.label}</span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: props.color ?? 'var(--text)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1
        }}
      >
        {props.value}
      </span>
    </div>
  )
}

/** good/warn/bad status chip. */
function FlagChip(props: { label: string; bad: boolean }): JSX.Element {
  const color = props.bad ? 'var(--bad)' : 'var(--good)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        color,
        background: props.bad ? 'rgba(216,105,77,0.14)' : 'rgba(88,192,138,0.14)',
        border: `1px solid ${color}`
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: color
        }}
      />
      {props.label}: {props.bad ? 'yes' : 'no'}
    </span>
  )
}

/** Colored per-base track for visual primer feedback. */
function BaseBar(props: { seq: string }): JSX.Element {
  const seq = props.seq
  if (!seq) {
    return (
      <div
        style={{
          height: 22,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-input)',
          border: '1px dashed var(--border)'
        }}
      />
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        height: 22,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'var(--bg-input)'
      }}
    >
      {seq.split('').map((b, i) => (
        <div
          key={i}
          style={{
            flex: '1 1 0',
            minWidth: 2,
            background: BASE_COLOR[b] ?? 'var(--text-faint)',
            opacity: 0.92
          }}
          title={`${i + 1}: ${b}`}
        />
      ))}
    </div>
  )
}

/** Monospace sequence with per-base coloring (for design / product readouts). */
function ColoredSeq(props: { seq: string; max?: number }): JSX.Element {
  const { seq, max } = props
  const truncated = max != null && seq.length > max
  const shown = truncated ? seq.slice(0, max) : seq
  return (
    <span className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', lineHeight: 1.5 }}>
      {shown.split('').map((b, i) => (
        <span key={i} style={{ color: BASE_COLOR[b] ?? 'var(--text-dim)' }}>
          {b}
        </span>
      ))}
      {truncated && <span style={{ color: 'var(--text-faint)' }}>…</span>}
    </span>
  )
}

const MISMATCH_OPTS = [0, 1, 2]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PrimerPanel(): JSX.Element {
  const record = useStore((s) => s.record)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)

  // --- Section 1 state ------------------------------------------------------
  const [primer1, setPrimer1] = useState('')
  const [bindMm, setBindMm] = useState(0)
  const [bindResults, setBindResults] = useState<PrimerBindingSite[] | null>(null)

  // --- Section 2 state ------------------------------------------------------
  const [regStart, setRegStart] = useState('') // 1-based, as text
  const [regEnd, setRegEnd] = useState('')
  const [targetTm, setTargetTm] = useState('60')
  const [design, setDesign] = useState<ReturnType<typeof designPrimers> | null>(null)
  const [designErr, setDesignErr] = useState<string | null>(null)

  // --- Section 3 state ------------------------------------------------------
  const [pcrFwd, setPcrFwd] = useState('')
  const [pcrRev, setPcrRev] = useState('')
  const [pcrMm, setPcrMm] = useState(0)
  const [pcrResults, setPcrResults] = useState<PcrProduct[] | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  // Live analysis of the section-1 primer.
  const clean1 = useMemo(() => cleanSequence(primer1), [primer1])
  const analysis = useMemo(
    () => (clean1.length > 0 ? analyzePrimer(clean1) : null),
    [clean1]
  )

  if (!record) {
    return (
      <div className="empty-state">
        <div className="dim">No sequence open</div>
        <div className="faint" style={{ fontSize: 12 }}>
          Open a construct to design primers and simulate PCR.
        </div>
      </div>
    )
  }

  const seqLen = record.sequence.length

  // ---- Section 1 actions ---------------------------------------------------
  const runBinding = (): void => {
    if (clean1.length === 0) {
      setBindResults([])
      return
    }
    const hits = findPrimerBindingSites(
      record,
      { id: 'p', name: 'primer', sequence: clean1 },
      bindMm
    )
    setBindResults(hits)
  }
  const selectSite = (site: PrimerBindingSite): void => {
    // engine: start is 0-based, end is 1-based-inclusive == 0-based-exclusive.
    setSelection({ start: site.start, end: site.end })
  }

  // ---- Section 2 actions ---------------------------------------------------
  const useSelectionRegion = (): void => {
    if (!selection) return
    setRegStart(String(selection.start + 1))
    setRegEnd(String(selection.end))
  }
  const runDesign = (): void => {
    setDesignErr(null)
    setDesign(null)
    const s1 = parseInt(regStart, 10)
    const e1 = parseInt(regEnd, 10)
    const tt = parseFloat(targetTm)
    if (!Number.isFinite(s1) || !Number.isFinite(e1)) {
      setDesignErr('Enter a numeric start and end.')
      return
    }
    // Convert displayed 1-based start to 0-based half-open region.
    const start = s1 - 1
    const end = e1
    if (start < 0 || end < 0 || start >= seqLen || end > seqLen) {
      setDesignErr(`Region out of range (1…${seqLen}).`)
      return
    }
    if (record.topology !== 'circular' && end <= start) {
      setDesignErr('End must be greater than start.')
      return
    }
    const res = designPrimers(
      record,
      { start, end },
      { targetTm: Number.isFinite(tt) ? tt : 60 }
    )
    if (!res) {
      setDesignErr('Could not design primers for this region.')
      return
    }
    setDesign(res)
  }

  // ---- Section 3 actions ---------------------------------------------------
  const runPcr = (): void => {
    setExpanded(null)
    const f = cleanSequence(pcrFwd)
    const r = cleanSequence(pcrRev)
    if (f.length === 0 || r.length === 0) {
      setPcrResults([])
      return
    }
    setPcrResults(simulatePcr(record, f, r, pcrMm))
  }
  const selectProduct = (p: PcrProduct): void => {
    // start 0-based, end == reverse footprint end (0-based-exclusive). Half-open.
    setSelection({ start: p.start, end: p.end })
  }

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text)
  }

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 14
      }}
    >
      {/* ===================== SECTION 1: ANALYSIS ===================== */}
      <div style={cardStyle}>
        <div style={cardTitle}>
          <span>Primer Analysis</span>
          <span className="spacer" />
          {analysis && (
            <span className="faint" style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>
              5′ → 3′
            </span>
          )}
        </div>

        <input
          value={primer1}
          onChange={(e) => {
            setPrimer1(e.target.value)
            setBindResults(null)
          }}
          placeholder="Type a primer sequence (5′→3′)…"
          spellCheck={false}
          className="mono"
          style={{ width: '100%', letterSpacing: '0.04em' }}
        />

        {clean1.length > 0 && clean1.length !== primer1.replace(/\s/g, '').length && (
          <div className="faint" style={{ fontSize: 11 }}>
            Non-DNA characters were ignored.
          </div>
        )}

        <BaseBar seq={clean1} />

        {analysis ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Metric label="Length" value={`${analysis.length}`} title="oligo length (nt)" />
              <Metric
                label="Tm"
                value={`${calcTm(clean1).toFixed(1)}°`}
                color={tmColor(analysis.tm)}
                title="nearest-neighbor melting temperature"
              />
              <Metric
                label="GC"
                value={`${calcGc(clean1).toFixed(0)}%`}
                color={gcColor(analysis.gc)}
                title="GC content"
              />
              <Metric
                label="3′ clamp"
                value={`${analysis.gcClamp}`}
                color={
                  analysis.gcClamp === 0 || analysis.gcClamp >= 4 ? 'var(--warn)' : 'var(--good)'
                }
                title="G/C count in the last 5 bases"
              />
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <FlagChip label="hairpin" bad={analysis.hairpin} />
              <FlagChip label="self-dimer" bad={analysis.selfDimer} />
            </div>

            {analysis.warnings.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  background: 'rgba(216,164,60,0.08)',
                  border: '1px solid var(--warn)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '7px 9px'
                }}
              >
                <span style={{ ...microLabel, color: 'var(--warn)' }}>
                  {analysis.warnings.length} warning{analysis.warnings.length === 1 ? '' : 's'}
                </span>
                {analysis.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                    • {w}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--good)' }}>
                ✓ No warnings — primer looks good.
              </div>
            )}

            {/* binding-site search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button className="primary" onClick={runBinding} style={{ padding: '5px 12px' }}>
                Find binding sites
              </button>
              <span style={microLabel}>max mismatch</span>
              <MismatchSelect value={bindMm} onChange={setBindMm} />
              <button onClick={() => copy(clean1)} style={{ padding: '5px 10px' }}>
                Copy
              </button>
            </div>

            {bindResults && (
              <BindingResults
                hits={bindResults}
                seqLen={seqLen}
                selection={selection}
                onPick={selectSite}
              />
            )}
          </>
        ) : (
          <div className="faint" style={{ fontSize: 12 }}>
            Enter a sequence to see Tm, GC content, 3′ clamp and structural warnings.
          </div>
        )}
      </div>

      {/* ===================== SECTION 2: DESIGN ===================== */}
      <div style={cardStyle}>
        <div style={cardTitle}>
          <span>Design Primers</span>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>
            {record.topology} · {seqLen.toLocaleString()} bp
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Start (1-based)">
            <input
              value={regStart}
              onChange={(e) => setRegStart(e.target.value)}
              placeholder="1"
              inputMode="numeric"
              className="mono"
              style={{ width: 84 }}
            />
          </Field>
          <Field label="End">
            <input
              value={regEnd}
              onChange={(e) => setRegEnd(e.target.value)}
              placeholder={String(seqLen)}
              inputMode="numeric"
              className="mono"
              style={{ width: 84 }}
            />
          </Field>
          <Field label="Target Tm (°C)">
            <input
              value={targetTm}
              onChange={(e) => setTargetTm(e.target.value)}
              inputMode="decimal"
              className="mono"
              style={{ width: 70 }}
            />
          </Field>
          <button
            onClick={useSelectionRegion}
            disabled={!selection}
            title={selection ? 'Use current selection' : 'No selection'}
            style={{ padding: '5px 10px' }}
          >
            Use selection
          </button>
          <button className="primary" onClick={runDesign} style={{ padding: '5px 14px' }}>
            Design
          </button>
        </div>

        {!selection && !regStart && !regEnd && (
          <div className="faint" style={{ fontSize: 11.5 }}>
            Tip: select a region on the map or sequence view, then “Use selection”.
          </div>
        )}

        {designErr && (
          <div style={{ fontSize: 11.5, color: 'var(--bad)' }}>{designErr}</div>
        )}

        {design && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DesignPrimerCard
              label="Forward"
              accent="var(--accent-strong)"
              seq={design.forward.sequence}
              onCopy={() => copy(design.forward.sequence)}
              onToAnalysis={() => {
                setPrimer1(design.forward.sequence)
                setBindResults(null)
              }}
              onToPcr={() => setPcrFwd(design.forward.sequence)}
            />
            <DesignPrimerCard
              label="Reverse"
              accent="var(--base-g)"
              seq={design.reverse.sequence}
              onCopy={() => copy(design.reverse.sequence)}
              onToAnalysis={() => {
                setPrimer1(design.reverse.sequence)
                setBindResults(null)
              }}
              onToPcr={() => setPcrRev(design.reverse.sequence)}
            />
            <button
              onClick={() => {
                setPcrFwd(design.forward.sequence)
                setPcrRev(design.reverse.sequence)
              }}
              style={{ padding: '5px 10px', alignSelf: 'flex-start' }}
            >
              Send pair to PCR ↓
            </button>
          </div>
        )}
      </div>

      {/* ===================== SECTION 3: PCR ===================== */}
      <div style={cardStyle}>
        <div style={cardTitle}>
          <span>PCR Simulation</span>
          <span className="spacer" />
          {record.topology === 'circular' && (
            <span className="faint" style={{ fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>
              circular — products may wrap origin
            </span>
          )}
        </div>

        <Field label="Forward primer (5′→3′)">
          <input
            value={pcrFwd}
            onChange={(e) => {
              setPcrFwd(e.target.value)
              setPcrResults(null)
            }}
            placeholder="forward primer…"
            spellCheck={false}
            className="mono"
            style={{ width: '100%', letterSpacing: '0.04em' }}
          />
        </Field>
        <Field label="Reverse primer (5′→3′)">
          <input
            value={pcrRev}
            onChange={(e) => {
              setPcrRev(e.target.value)
              setPcrResults(null)
            }}
            placeholder="reverse primer…"
            spellCheck={false}
            className="mono"
            style={{ width: '100%', letterSpacing: '0.04em' }}
          />
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={microLabel}>max mismatch</span>
          <MismatchSelect value={pcrMm} onChange={setPcrMm} />
          <span className="spacer" />
          <button className="primary" onClick={runPcr} style={{ padding: '5px 14px' }}>
            Simulate PCR
          </button>
        </div>

        {pcrResults && (
          <PcrResults
            products={pcrResults}
            seqLen={seqLen}
            selection={selection}
            expanded={expanded}
            setExpanded={setExpanded}
            onPick={selectProduct}
            onCopy={copy}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function Field(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 auto' }}>
      <span style={microLabel}>{props.label}</span>
      {props.children}
    </label>
  )
}

function MismatchSelect(props: { value: number; onChange: (n: number) => void }): JSX.Element {
  return (
    <div style={{ display: 'inline-flex', gap: 3 }}>
      {MISMATCH_OPTS.map((m) => {
        const active = props.value === m
        return (
          <button
            key={m}
            onClick={() => props.onChange(m)}
            style={{
              padding: '3px 10px',
              fontSize: 11.5,
              fontVariantNumeric: 'tabular-nums',
              background: active ? 'var(--accent)' : 'var(--bg-input)',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
              color: active ? '#fff' : 'var(--text-dim)'
            }}
          >
            {m}
          </button>
        )
      })}
    </div>
  )
}

function StrandBadge(props: { strand: Strand }): JSX.Element {
  const fwd = props.strand === 1
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        color: fwd ? 'var(--accent-strong)' : 'var(--base-g)',
        background: fwd ? 'var(--accent-soft)' : 'rgba(201,136,58,0.16)'
      }}
    >
      {fwd ? '→ fwd' : '← rev'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Section 2 — designed primer readout
// ---------------------------------------------------------------------------
function DesignPrimerCard(props: {
  label: string
  accent: string
  seq: string
  onCopy: () => void
  onToAnalysis: () => void
  onToPcr: () => void
}): JSX.Element {
  const { label, accent, seq } = props
  const tm = calcTm(seq)
  const gc = calcGc(seq)
  return (
    <div
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>{label}</span>
        <span className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {seq.length} nt
        </span>
        <span style={{ fontSize: 11, color: tmColor(tm), fontVariantNumeric: 'tabular-nums' }}>
          Tm {tm.toFixed(1)}°
        </span>
        <span style={{ fontSize: 11, color: gcColor(gc), fontVariantNumeric: 'tabular-nums' }}>
          GC {gc.toFixed(0)}%
        </span>
      </div>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: '5px 7px' }}>
        <ColoredSeq seq={seq} />
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <button onClick={props.onCopy} style={{ padding: '3px 9px', fontSize: 11.5 }}>
          Copy
        </button>
        <button onClick={props.onToAnalysis} style={{ padding: '3px 9px', fontSize: 11.5 }}>
          → Analyze
        </button>
        <button onClick={props.onToPcr} style={{ padding: '3px 9px', fontSize: 11.5 }}>
          → PCR
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 1 — binding-site results
// ---------------------------------------------------------------------------
function BindingResults(props: {
  hits: PrimerBindingSite[]
  seqLen: number
  selection: { start: number; end: number } | null
  onPick: (s: PrimerBindingSite) => void
}): JSX.Element {
  const { hits, selection, onPick } = props
  if (hits.length === 0) {
    return (
      <div className="faint" style={{ fontSize: 12 }}>
        No binding sites found on this template.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={microLabel}>
        {hits.length} binding site{hits.length === 1 ? '' : 's'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {hits.map((h, i) => {
          const isSel = selection != null && selection.start === h.start && selection.end === h.end
          const startDisp = h.start + 1
          const wraps = h.end <= h.start
          return (
            <div
              key={`${h.start}-${h.strand}-${i}`}
              onClick={() => onPick(h)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: 12,
                background: isSel ? 'var(--accent-soft)' : 'var(--bg-input)',
                border: '1px solid var(--border)'
              }}
              onMouseEnter={(e) => {
                if (!isSel) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = isSel
                  ? 'var(--accent-soft)'
                  : 'var(--bg-input)'
              }}
            >
              <StrandBadge strand={h.strand} />
              <span
                className="mono"
                style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
              >
                {startDisp}…{h.end}
                {wraps ? ' ↻' : ''}
              </span>
              <span className="spacer" />
              <span
                style={{
                  fontSize: 11,
                  color: h.mismatches === 0 ? 'var(--good)' : 'var(--warn)',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {h.mismatches} mm
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: tmColor(h.tm),
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 52,
                  textAlign: 'right'
                }}
              >
                Tm {h.tm.toFixed(1)}°
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section 3 — PCR products
// ---------------------------------------------------------------------------
function PcrResults(props: {
  products: PcrProduct[]
  seqLen: number
  selection: { start: number; end: number } | null
  expanded: number | null
  setExpanded: (i: number | null) => void
  onPick: (p: PcrProduct) => void
  onCopy: (text: string) => void
}): JSX.Element {
  const { products, selection, expanded, setExpanded, onPick, onCopy } = props
  if (products.length === 0) {
    return (
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--bad)',
          background: 'rgba(216,105,77,0.10)',
          border: '1px solid var(--bad)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px'
        }}
      >
        No product — primers do not amplify this template.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={microLabel}>
        {products.length} product{products.length === 1 ? '' : 's'}
      </span>
      {products.map((p, i) => {
        const isSel = selection != null && selection.start === p.start && selection.end === p.end
        const wraps = p.end <= p.start
        const isOpen = expanded === i
        return (
          <div
            key={`${p.start}-${p.end}-${i}`}
            style={{
              border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)',
              background: isSel ? 'var(--accent-soft)' : 'var(--bg-input)',
              overflow: 'hidden'
            }}
          >
            <div
              onClick={() => onPick(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 9px',
                cursor: 'pointer'
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-dim)' }}>
                #{i + 1}
              </span>
              <span
                className="mono"
                style={{ fontSize: 12, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
              >
                {p.start + 1}…{p.end}
                {wraps ? ' ↻' : ''}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--accent-strong)',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {p.length.toLocaleString()} bp
              </span>
              <span className="spacer" />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy(p.sequence)
                }}
                style={{ padding: '2px 8px', fontSize: 11 }}
              >
                Copy
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(isOpen ? null : i)
                }}
                style={{ padding: '2px 8px', fontSize: 11 }}
              >
                {isOpen ? 'Hide' : 'Seq'}
              </button>
            </div>
            <div style={{ padding: '0 9px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span
                className="tag"
                style={{ color: 'var(--accent-strong)', background: 'var(--bg-active)' }}
                title="forward primer"
              >
                F: {p.forwardPrimer.slice(0, 18)}
                {p.forwardPrimer.length > 18 ? '…' : ''}
              </span>
              <span
                className="tag"
                style={{ color: 'var(--base-g)', background: 'var(--bg-active)' }}
                title="reverse primer"
              >
                R: {p.reversePrimer.slice(0, 18)}
                {p.reversePrimer.length > 18 ? '…' : ''}
              </span>
            </div>
            {isOpen && (
              <div
                style={{
                  padding: '6px 9px 9px',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--bg)'
                }}
              >
                <ColoredSeq seq={p.sequence} max={600} />
                {p.sequence.length > 600 && (
                  <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                    showing first 600 of {p.sequence.length.toLocaleString()} bp — use Copy for full
                    sequence
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
