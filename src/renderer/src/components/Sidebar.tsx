import { useStore } from '@state/store'
import { gcContent, spanLength } from '@core/sequence'
import { featureColor } from '@core/featureStyle'

export function Sidebar(): JSX.Element {
  const record = useStore((s) => s.record)
  const selectedFeatureId = useStore((s) => s.selectedFeatureId)
  const setSelectedFeatureId = useStore((s) => s.setSelectedFeatureId)
  const setHoveredFeatureId = useStore((s) => s.setHoveredFeatureId)
  const setSelection = useStore((s) => s.setSelection)

  if (!record) {
    return <div style={{ background: 'var(--bg-panel)', borderRight: '1px solid var(--border)' }} />
  }

  const gc = (gcContent(record.sequence) * 100).toFixed(1)
  const features = [...record.features].sort((a, b) => a.start - b.start)

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ padding: '14px 12px 10px' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{record.name}</div>
        {record.description && (
          <div className="dim" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.35 }}>
            {record.description}
          </div>
        )}
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="tag">{record.sequence.length.toLocaleString()} bp</span>
          <span className="tag">{record.topology}</span>
          <span className="tag">GC {gc}%</span>
        </div>
      </div>

      <div className="panel-title">Features ({features.length})</div>
      <div style={{ padding: '0 6px 12px' }}>
        {features.map((f) => {
          const len = spanLength(f.start, f.end, record.sequence.length, record.topology)
          const active = f.id === selectedFeatureId
          return (
            <div
              key={f.id}
              onClick={() => setSelectedFeatureId(active ? null : f.id)}
              onDoubleClick={() => setSelection({ start: f.start, end: f.end })}
              onMouseEnter={() => setHoveredFeatureId(f.id)}
              onMouseLeave={() => setHoveredFeatureId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: active ? 'var(--accent-soft)' : 'transparent'
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: featureColor(f),
                  flexShrink: 0
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </div>
                <div className="faint" style={{ fontSize: 10 }}>
                  {f.type} · {len} bp · {f.strand === 1 ? '→' : '←'}
                </div>
              </div>
            </div>
          )
        })}
        {features.length === 0 && <div className="faint" style={{ padding: '4px 8px' }}>No features</div>}
      </div>
    </div>
  )
}
