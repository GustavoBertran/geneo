import type { GenomeTrackProps } from '../../genome/types'
import { complementBase } from '../../core/sequence'

/** Per-base background/text color by nucleotide. */
function baseColor(b: string): string {
  switch (b.toUpperCase()) {
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
      return 'var(--text-faint)'
  }
}

/** Minimum px/bp at which letters become legible. */
const LEGIBLE = 7
/** Px/bp at which we also render a complement row. */
const COMPLEMENT = 14

/** A short hint-only svg (height 20) with centered faint text. */
function hint(width: number, text: string): JSX.Element {
  return (
    <svg width={width} height={20} style={{ display: 'block' }}>
      <text
        x={width / 2}
        y={13}
        textAnchor="middle"
        fontFamily="var(--sans)"
        fontSize={11}
        fill="var(--text-faint)"
      >
        {text}
      </text>
    </svg>
  )
}

export function SequenceTrack({ chrom, viewport }: GenomeTrackProps): JSX.Element {
  const { width, pxPerBp, locus, bpToPx } = viewport
  const seq = chrom.seq

  // Zoom-gated: too small to read.
  if (pxPerBp < LEGIBLE) {
    return hint(width, 'Zoom in to see sequence')
  }
  // No bundled reference sequence at all.
  if (!seq || seq.bases.length === 0) {
    return hint(width, 'No reference sequence')
  }

  const seqEnd = seq.start + seq.bases.length
  // Visible base range, clipped strictly to the available window.
  const vStart = Math.max(Math.floor(locus.start), seq.start)
  const vEnd = Math.min(Math.ceil(locus.end), seqEnd)

  // Locus may be entirely outside the bundled window -> nothing to draw.
  if (vEnd <= vStart) {
    return hint(width, 'No reference sequence here')
  }

  const showComplement = pxPerBp >= COMPLEMENT
  const H = showComplement ? 38 : 22
  const topY = 14 // baseline for letters in the forward row
  const cellTop = 2
  const cellH = 18
  const compTopY = 31 // baseline for complement letters
  const compCellTop = 20
  // Slightly smaller font when cells are narrow so glyphs don't overflow.
  const fontSize = Math.min(13, Math.max(9, pxPerBp * 0.85))

  const cells: JSX.Element[] = []
  for (let p = vStart; p < vEnd; p++) {
    const b = seq.bases[p - seq.start]
    if (b === undefined) continue
    const x0 = bpToPx(p)
    const x1 = bpToPx(p + 1)
    const w = x1 - x0
    const cx = x0 + w / 2
    const color = baseColor(b)

    cells.push(
      <g key={p}>
        <rect x={x0} y={cellTop} width={w} height={cellH} fill={color} opacity={0.16} />
        <text
          x={cx}
          y={topY}
          textAnchor="middle"
          fontFamily="var(--mono)"
          fontSize={fontSize}
          fontWeight={600}
          fill={color}
        >
          {b.toUpperCase()}
        </text>
        {showComplement &&
          (() => {
            const cb = complementBase(b)
            return (
              <>
                <rect
                  x={x0}
                  y={compCellTop}
                  width={w}
                  height={cellH}
                  fill={baseColor(cb)}
                  opacity={0.08}
                />
                <text
                  x={cx}
                  y={compTopY}
                  textAnchor="middle"
                  fontFamily="var(--mono)"
                  fontSize={fontSize}
                  fill={baseColor(cb)}
                  opacity={0.75}
                >
                  {cb}
                </text>
              </>
            )
          })()}
      </g>
    )
  }

  return (
    <svg width={width} height={H} style={{ display: 'block' }}>
      {cells}
    </svg>
  )
}
