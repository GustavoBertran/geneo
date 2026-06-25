import { useStore } from '@state/store'
import { gcContent, subsequence } from '@core/sequence'

export function StatusBar(): JSX.Element {
  const record = useStore((s) => s.record)
  const selection = useStore((s) => s.selection)
  const dirty = useStore((s) => s.dirty)

  let selInfo = 'No selection'
  if (record && selection) {
    const sub = subsequence(record.sequence, selection.start, selection.end, record.topology)
    const gc = (gcContent(sub) * 100).toFixed(0)
    selInfo = `${selection.start + 1}–${selection.end} · ${sub.length} bp · GC ${gc}%`
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '4px 14px',
        fontSize: 11,
        color: 'var(--text-dim)',
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border)'
      }}
    >
      {record ? (
        <>
          <span className="mono">{record.sequence.length.toLocaleString()} bp</span>
          <span>{record.topology}</span>
          <span>GC {(gcContent(record.sequence) * 100).toFixed(1)}%</span>
          <span className="spacer" />
          <span className="mono">{selInfo}</span>
          {dirty && <span style={{ color: 'var(--warn)' }}>● unsaved</span>}
        </>
      ) : (
        <span>Ready</span>
      )}
    </div>
  )
}
