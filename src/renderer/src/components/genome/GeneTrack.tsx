import type { GenomeTrackProps, Transcript, GStrand } from '../../genome/types'

// Lane / glyph geometry (px).
const LANE_H = 17
const PAD_TOP = 4
const THICK_H = 11 // CDS rect height
const THIN_H = 6 // UTR / non-coding rect height
const LABEL_MARGIN = 60 // reserved x-space to the left for a label when packing
const CHEVRON_SPACING = 28 // px between direction chevrons
const CHEVRON_HALF = 3 // chevron half-extent (px)

/** Biotype -> fill color. Falls back to the muted secondary tone. */
function biotypeColor(biotype: string | undefined): string {
  const b = (biotype ?? '').toLowerCase()
  if (b === 'protein_coding') return '#4f9dde'
  if (
    b === 'nonsense_mediated_decay' ||
    b === 'retained_intron' ||
    b === 'processed_transcript'
  ) {
    return '#8aa0b8'
  }
  if (b === 'lncrna' || b.endsWith('rna') || b === 'non_coding' || b === 'noncoding') {
    return '#9d6bcf'
  }
  return '#8aa0b8'
}

interface Packed {
  t: Transcript
  lane: number
  x0: number
  x1: number
}

/** Greedy lane packing: sort by start, place in first lane that has room. */
function packLanes(
  transcripts: Transcript[],
  bpToPx: (bp: number) => number
): { packed: Packed[]; laneCount: number } {
  const sorted = [...transcripts].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnd: number[] = [] // right-most occupied x per lane (incl. label margin)
  const packed: Packed[] = []
  for (const t of sorted) {
    const x0 = bpToPx(t.start)
    const x1 = bpToPx(t.end)
    // Space the label needs sits to the left of x0.
    const leftEdge = x0 - LABEL_MARGIN
    let lane = 0
    while (lane < laneEnd.length && laneEnd[lane] > leftEdge) lane++
    laneEnd[lane] = x1
    packed.push({ t, lane, x0, x1 })
  }
  return { packed, laneCount: Math.max(1, laneEnd.length) }
}

/** Chevron path (a small ">" or "<") centered at (cx, cy). */
function chevron(cx: number, cy: number, strand: GStrand): string {
  if (strand === -1) {
    // "<" pointing left
    return `M ${cx + CHEVRON_HALF} ${cy - CHEVRON_HALF} L ${cx - CHEVRON_HALF} ${cy} L ${cx + CHEVRON_HALF} ${cy + CHEVRON_HALF}`
  }
  // ">" pointing right (default for strand 1)
  return `M ${cx - CHEVRON_HALF} ${cy - CHEVRON_HALF} L ${cx + CHEVRON_HALF} ${cy} L ${cx - CHEVRON_HALF} ${cy + CHEVRON_HALF}`
}

export function GeneTrack(props: GenomeTrackProps): JSX.Element {
  const { track, viewport, selectedId, hoveredId, onSelect, onHover } = props
  const { width, bpToPx } = viewport
  const transcripts = track.transcripts ?? []

  if (transcripts.length === 0) {
    return <svg width={width} height={LANE_H + 8} style={{ display: 'block' }} />
  }

  const { packed, laneCount } = packLanes(transcripts, bpToPx)
  const height = laneCount * LANE_H + 8

  const rows: JSX.Element[] = []

  for (const { t, lane, x0, x1 } of packed) {
    // Cull transcripts fully outside the drawing area.
    if (x1 < -20 || x0 > width + 20) continue

    const cy = PAD_TOP + lane * LANE_H + LANE_H / 2
    const isSelected = t.id === selectedId
    const isHovered = t.id === hoveredId
    const baseColor = biotypeColor(t.biotype)
    const color = isSelected ? '#7fc0ff' : baseColor
    const outline = isSelected ? 'var(--text)' : isHovered ? 'var(--border-strong)' : 'none'
    const emphasis = isHovered || isSelected ? 1 : 0.92

    const strandLabel = t.strand === 1 ? '+' : t.strand === -1 ? '-' : '.'
    const titleText = `${t.geneName || t.name}${
      t.biotype ? ` · ${t.biotype}` : ''
    } · strand ${strandLabel} · ${t.chrom}:${t.start}-${t.end}`

    const exonEls: JSX.Element[] = []

    // CDS bounds (thick region). Empty cds => non-coding (all thin).
    const hasCds = t.cds.length > 0
    let cdsStart = 0
    let cdsEnd = 0
    if (hasCds) {
      cdsStart = t.cds[0].start
      cdsEnd = t.cds[0].end
      for (const c of t.cds) {
        if (c.start < cdsStart) cdsStart = c.start
        if (c.end > cdsEnd) cdsEnd = c.end
      }
    }

    // Decide collapse: if average exon would render < ~1px, draw one slim box.
    const exonCount = t.exons.length
    const spanPx = Math.max(0, x1 - x0)
    const avgExonPx = exonCount > 0 ? spanPx / exonCount : spanPx
    const collapse = exonCount === 0 || avgExonPx < 1

    // INTRON LINE across the full transcript extent.
    const lineX0 = Math.max(-20, x0)
    const lineX1 = Math.min(width + 20, x1)
    exonEls.push(
      <line
        key="intron"
        x1={lineX0}
        y1={cy}
        x2={lineX1}
        y2={cy}
        stroke={baseColor}
        strokeOpacity={0.55}
        strokeWidth={1}
      />
    )

    // Direction chevrons along the visible portion of the line.
    if (t.strand !== 0 && lineX1 - lineX0 > CHEVRON_SPACING) {
      const start = Math.ceil(lineX0 / CHEVRON_SPACING) * CHEVRON_SPACING
      for (let cx = start; cx < lineX1 - CHEVRON_HALF; cx += CHEVRON_SPACING) {
        if (cx - CHEVRON_HALF < lineX0) continue
        exonEls.push(
          <path
            key={`chev-${cx}`}
            d={chevron(cx, cy, t.strand)}
            fill="none"
            stroke={baseColor}
            strokeOpacity={0.7}
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      }
    }

    if (collapse) {
      // One slim box spanning the whole transcript.
      const bx = Math.max(-20, x0)
      const bw = Math.max(1, Math.min(width + 20, x1) - bx)
      exonEls.push(
        <rect
          key="collapsed"
          x={bx}
          y={cy - THIN_H / 2}
          width={bw}
          height={THIN_H}
          fill={color}
          fillOpacity={emphasis}
          rx={1}
        />
      )
    } else {
      for (let i = 0; i < t.exons.length; i++) {
        const ex = t.exons[i]
        const ex0 = bpToPx(ex.start)
        const ex1 = bpToPx(ex.end)
        const ew = Math.max(1, ex1 - ex0)
        // THIN rect for the whole exon (UTR baseline).
        exonEls.push(
          <rect
            key={`thin-${i}`}
            x={ex0}
            y={cy - THIN_H / 2}
            width={ew}
            height={THIN_H}
            fill={color}
            fillOpacity={emphasis}
          />
        )
        // THICK overlay for the coding portion intersecting [cdsStart, cdsEnd).
        if (hasCds) {
          const cs = Math.max(ex.start, cdsStart)
          const ce = Math.min(ex.end, cdsEnd)
          if (ce > cs) {
            const tx0 = bpToPx(cs)
            const tx1 = bpToPx(ce)
            exonEls.push(
              <rect
                key={`thick-${i}`}
                x={tx0}
                y={cy - THICK_H / 2}
                width={Math.max(1, tx1 - tx0)}
                height={THICK_H}
                fill={color}
                fillOpacity={emphasis}
              />
            )
          }
        }
      }
    }

    // LABEL: left of x0, or above the line if there's no room on the left.
    const label = t.geneName || t.name
    let labelEl: JSX.Element | null = null
    if (label) {
      if (x0 >= 40) {
        labelEl = (
          <text
            x={x0 - 4}
            y={cy + 3}
            textAnchor="end"
            fontSize={10}
            fill="var(--text-dim)"
            fontFamily="var(--mono)"
            style={{ pointerEvents: 'none' }}
          >
            {label}
          </text>
        )
      } else {
        labelEl = (
          <text
            x={Math.max(2, x0)}
            y={cy - THICK_H / 2 - 2}
            textAnchor="start"
            fontSize={10}
            fill="var(--text-dim)"
            fontFamily="var(--mono)"
            style={{ pointerEvents: 'none' }}
          >
            {label}
          </text>
        )
      }
    }

    const handleClick = (): void => onSelect(isSelected ? null : t.id)
    const handleEnter = (): void => onHover(t.id)
    const handleLeave = (): void => onHover(null)

    // Generous invisible hit area covering the row span.
    const hitX = Math.max(-20, x0)
    const hitW = Math.max(2, Math.min(width + 20, x1) - hitX)

    rows.push(
      <g
        key={t.id}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{ cursor: 'pointer' }}
      >
        <title>{titleText}</title>
        <rect
          x={hitX}
          y={cy - LANE_H / 2}
          width={hitW}
          height={LANE_H}
          fill="transparent"
        />
        {outline !== 'none' && (
          <rect
            x={hitX}
            y={cy - LANE_H / 2 + 1}
            width={hitW}
            height={LANE_H - 2}
            fill="none"
            stroke={outline}
            strokeOpacity={isSelected ? 0.9 : 0.5}
            strokeWidth={1}
            rx={2}
          />
        )}
        {exonEls}
        {labelEl}
      </g>
    )
  }

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {rows}
    </svg>
  )
}
