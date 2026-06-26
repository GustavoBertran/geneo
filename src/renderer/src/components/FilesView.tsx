/**
 * FilesView — a SnapGene-style "Files" board of everything the user has worked
 * on (recently opened plasmids + genome regions), each re-openable in one click.
 *
 * Rendered as the whole center area. Reads `recentItems` from the store (already
 * most-recent-first) plus the `removeRecent` / `clearRecent` actions. Cards call
 * `reopenItem(item)`; on success the view switches and this component unmounts,
 * so per-card pending/error state is only meaningful on the failure branch.
 *
 * Local state: the active kind filter, a pending set (keyed by item.id) and an
 * error map (keyed by item.id). Relative time is computed at render from
 * Date.now() — fine for app timestamps. Filtering/sorting happens in a memo on a
 * COPY of the array (never sort the store array in place).
 */
import { useMemo, useState } from 'react'
import { useStore } from '@state/store'
import { reopenItem } from '../services/reopen'
import type { RecentItem } from '@state/store'

type KindFilter = 'all' | 'plasmid' | 'genome'

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'plasmid', label: 'Plasmids' },
  { value: 'genome', label: 'Genomes' }
]

// ---------------------------------------------------------------------------
// Relative time — robust across <1 min, minutes, hours, days, then a date.
// ---------------------------------------------------------------------------
function relativeTime(then: number, now: number): string {
  const diff = now - then
  if (!Number.isFinite(diff)) return ''
  if (diff < 0) return 'just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'yesterday'
  if (day < 7) return `${day} days ago`
  // older — a localized date, with the year only if it differs
  const d = new Date(then)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

// ---------------------------------------------------------------------------
// Kind glyphs (inline SVG).
//   plasmid -> a circular-plasmid ring with a couple of feature arcs
//   genome  -> stacked chromosome tracks
// ---------------------------------------------------------------------------
function PlasmidGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="9" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M14 5 A9 9 0 0 1 22.5 11" fill="none" stroke="var(--good)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M9 21.5 A9 9 0 0 1 5.5 16" fill="none" stroke="var(--base-g)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function GenomeGlyph(): JSX.Element {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="4" y="6" width="20" height="3.2" rx="1.6" fill="var(--accent)" />
      <rect x="4" y="12.4" width="14" height="3.2" rx="1.6" fill="var(--base-g)" />
      <rect x="4" y="18.8" width="18" height="3.2" rx="1.6" fill="var(--good)" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// One card.
// ---------------------------------------------------------------------------
interface CardProps {
  item: RecentItem
  now: number
  pending: boolean
  error?: string
  onOpen: (item: RecentItem) => void
  onRemove: (id: string) => void
}

function FileCard({ item, now, pending, error, onOpen, onRemove }: CardProps): JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={pending}
      onClick={() => !pending && onOpen(item)}
      onKeyDown={(e) => {
        if (pending) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(item)
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        gap: 10,
        padding: '12px 12px 11px',
        borderRadius: 'var(--radius)',
        border: `1px solid ${error ? 'var(--bad)' : 'var(--border)'}`,
        background: pending ? 'var(--bg-panel)' : hover ? 'var(--bg-hover)' : 'var(--bg-elevated)',
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.6 : 1,
        transition: 'background 0.12s, border-color 0.12s, opacity 0.12s',
        minWidth: 0
      }}
    >
      {/* × remove — must not bubble to the card's open handler */}
      <button
        className="ghost"
        aria-label={`Remove ${item.name}`}
        title="Remove from Files"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onRemove(item.id)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          padding: 0,
          lineHeight: '20px',
          textAlign: 'center',
          color: 'var(--text-faint)',
          opacity: hover ? 1 : 0.35
        }}
      >
        ×
      </button>

      <div style={{ flex: '0 0 auto', paddingTop: 1 }}>
        {item.kind === 'plasmid' ? <PlasmidGlyph /> : <GenomeGlyph />}
      </div>

      <div style={{ minWidth: 0, flex: 1, paddingRight: 14 }}>
        <div
          style={{
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
          title={item.name}
        >
          {item.name}
        </div>
        <div
          className="dim"
          style={{
            fontSize: 12,
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
          title={item.subtitle}
        >
          {item.subtitle}
        </div>

        <div className="row" style={{ marginTop: 9, gap: 6 }}>
          <span className="tag">{item.kind === 'plasmid' ? 'Plasmid' : 'Genome'}</span>
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {pending ? 'Opening…' : relativeTime(item.openedAt, now)}
          </span>
        </div>

        {error && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11.5,
              color: 'var(--bad)',
              whiteSpace: 'normal'
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export function FilesView(): JSX.Element {
  // Select the array and actions individually — never a derived array from the
  // selector (would allocate each render and risk update churn).
  const recentItems = useStore((s) => s.recentItems)
  const removeRecent = useStore((s) => s.removeRecent)
  const clearRecent = useStore((s) => s.clearRecent)

  const [filter, setFilter] = useState<KindFilter>('all')
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  // A single Date.now() per render is fine for these app timestamps.
  const now = Date.now()

  const counts = useMemo(() => {
    let plasmid = 0
    let genome = 0
    for (const r of recentItems) {
      if (r.kind === 'plasmid') plasmid++
      else genome++
    }
    return { all: recentItems.length, plasmid, genome }
  }, [recentItems])

  // Filter + sort on a COPY (never mutate the store array). The store already
  // returns most-recent-first; the sort is defensive.
  const visible = useMemo(() => {
    const filtered = filter === 'all' ? recentItems : recentItems.filter((r) => r.kind === filter)
    return [...filtered].sort((a, b) => b.openedAt - a.openedAt)
  }, [recentItems, filter])

  const handleOpen = (item: RecentItem): void => {
    if (pending[item.id]) return
    // optimistic: clear any prior error, mark pending
    setErrors((e) => {
      if (!e[item.id]) return e
      const { [item.id]: _drop, ...rest } = e
      return rest
    })
    setPending((p) => ({ ...p, [item.id]: true }))
    void reopenItem(item).then((res) => {
      // On success the view switches and this component unmounts — only the
      // failure branch needs to touch state.
      if (res.ok) return
      setPending((p) => {
        const { [item.id]: _drop, ...rest } = p
        return rest
      })
      setErrors((e) => ({ ...e, [item.id]: res.error ?? 'Could not open' }))
    })
  }

  const handleRemove = (id: string): void => {
    removeRecent(id)
    // also drop any stale per-card state for this id
    setPending((p) => {
      if (!p[id]) return p
      const { [id]: _drop, ...rest } = p
      return rest
    })
    setErrors((e) => {
      if (!e[id]) return e
      const { [id]: _drop, ...rest } = e
      return rest
    })
  }

  const handleClearAll = (): void => {
    if (recentItems.length === 0) return
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Clear all ${recentItems.length} item(s) from Files?`)
    if (!ok) return
    clearRecent()
    setPending({})
    setErrors({})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          padding: '14px 16px 12px',
          gap: 12,
          borderBottom: '1px solid var(--border)',
          flex: '0 0 auto'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>Files</div>
        <span className="tag" title="Total recent items">
          {counts.all}
        </span>

        <div className="row" style={{ gap: 4, marginLeft: 4 }}>
          {FILTERS.map((f) => {
            const active = filter === f.value
            const n = counts[f.value]
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={active}
                style={{
                  padding: '3px 10px',
                  fontSize: 12,
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  color: active ? 'var(--accent-strong)' : 'var(--text-dim)'
                }}
              >
                {f.label}
                <span style={{ marginLeft: 6, opacity: 0.7 }}>{n}</span>
              </button>
            )
          })}
        </div>

        <span className="spacer" />

        <button
          className="ghost"
          onClick={handleClearAll}
          disabled={recentItems.length === 0}
          title="Remove every item from Files"
          style={{ color: 'var(--text-dim)' }}
        >
          Clear all
        </button>
      </div>

      {/* Body */}
      {visible.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          {recentItems.length === 0 ? (
            <div className="dim" style={{ textAlign: 'center', maxWidth: 360, lineHeight: 1.5 }}>
              No files yet — open a plasmid or a genome and it&apos;ll show up here.
            </div>
          ) : (
            <div className="dim">No {filter === 'plasmid' ? 'plasmids' : 'genomes'} in Files.</div>
          )}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 16
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
              alignContent: 'start'
            }}
          >
            {visible.map((item) => (
              <FileCard
                key={item.id}
                item={item}
                now={now}
                pending={!!pending[item.id]}
                error={errors[item.id]}
                onOpen={handleOpen}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
