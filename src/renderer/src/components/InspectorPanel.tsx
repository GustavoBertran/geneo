import { useStore } from '@state/store'
import { gcContent, reverseComplement, subsequence } from '@core/sequence'
import { FEATURE_TYPES, featureColor } from '@core/featureStyle'
import { calcTm } from '@core/primers'
import { translate } from '@core/translation'
import type { Strand } from '@core/types'

export function InspectorPanel(): JSX.Element {
  const record = useStore((s) => s.record)
  const selectedFeatureId = useStore((s) => s.selectedFeatureId)
  const selection = useStore((s) => s.selection)
  const updateFeature = useStore((s) => s.updateFeature)
  const removeFeature = useStore((s) => s.removeFeature)
  const setSelectedFeatureId = useStore((s) => s.setSelectedFeatureId)

  const feature = record?.features.find((f) => f.id === selectedFeatureId) ?? null

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {feature && record ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="panel-title" style={{ padding: 0 }}>Feature</div>
          <label style={lbl}>
            Name
            <input value={feature.name} onChange={(e) => updateFeature(feature.id, { name: e.target.value })} />
          </label>
          <label style={lbl}>
            Type
            <select value={feature.type} onChange={(e) => updateFeature(feature.id, { type: e.target.value })}>
              {FEATURE_TYPES.includes(feature.type) ? null : <option value={feature.type}>{feature.type}</option>}
              {FEATURE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="row" style={{ gap: 10 }}>
            <label style={{ ...lbl, flex: 1 }}>
              Strand
              <select
                value={feature.strand}
                onChange={(e) => updateFeature(feature.id, { strand: Number(e.target.value) as Strand })}
              >
                <option value={1}>→ forward</option>
                <option value={-1}>← reverse</option>
              </select>
            </label>
            <label style={{ ...lbl, width: 64 }}>
              Color
              <input
                type="color"
                value={featureColor(feature)}
                onChange={(e) => updateFeature(feature.id, { color: e.target.value })}
                style={{ padding: 1, height: 30 }}
              />
            </label>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <label style={{ ...lbl, flex: 1 }}>
              Start (1-based)
              <input
                type="number"
                value={feature.start + 1}
                onChange={(e) => updateFeature(feature.id, { start: Math.max(0, Number(e.target.value) - 1) })}
              />
            </label>
            <label style={{ ...lbl, flex: 1 }}>
              End
              <input
                type="number"
                value={feature.end}
                onChange={(e) => updateFeature(feature.id, { end: Number(e.target.value) })}
              />
            </label>
          </div>
          {feature.qualifiers?.product && (
            <div className="dim" style={{ fontSize: 11 }}>Product: {feature.qualifiers.product}</div>
          )}
          {feature.type === 'CDS' && (
            <div>
              <div className="faint" style={{ fontSize: 10, marginBottom: 3 }}>Translation</div>
              <div
                className="mono"
                style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--text-dim)', maxHeight: 120, overflow: 'auto' }}
              >
                {translate(
                  feature.strand === 1
                    ? subsequence(record.sequence, feature.start, feature.end, record.topology)
                    : reverseComplement(subsequence(record.sequence, feature.start, feature.end, record.topology))
                ) || '—'}
              </div>
            </div>
          )}
          <button onClick={() => { removeFeature(feature.id); setSelectedFeatureId(null) }} style={{ color: 'var(--bad)' }}>
            Delete feature
          </button>
        </div>
      ) : selection && record ? (
        <SelectionInfo />
      ) : (
        <div style={{ padding: 12 }}>
          <div className="panel-title" style={{ padding: 0 }}>Inspector</div>
          <div className="dim" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
            Select a feature to edit it, or drag across the sequence/map to inspect a region.
          </div>
        </div>
      )}
    </div>
  )
}

function SelectionInfo(): JSX.Element {
  const record = useStore((s) => s.record)!
  const selection = useStore((s) => s.selection)!
  const sub = subsequence(record.sequence, selection.start, selection.end, record.topology)
  const rc = reverseComplement(sub)
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="panel-title" style={{ padding: 0 }}>Selection</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="tag">{selection.start + 1}–{selection.end}</span>
        <span className="tag">{sub.length} bp</span>
        <span className="tag">GC {(gcContent(sub) * 100).toFixed(0)}%</span>
        <span className="tag">Tm {calcTm(sub).toFixed(1)}°C</span>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 10, marginBottom: 3 }}>5'→3'</div>
        <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', maxHeight: 100, overflow: 'auto' }}>{sub}</div>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 10, marginBottom: 3 }}>Reverse complement</div>
        <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', maxHeight: 100, overflow: 'auto', color: 'var(--text-dim)' }}>{rc}</div>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 10, marginBottom: 3 }}>Translation (frame 1)</div>
        <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--text-dim)' }}>{translate(sub) || '—'}</div>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: 'var(--text-dim)'
}
