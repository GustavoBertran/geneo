/**
 * Snapshot export for the genome browser. Composes the live track <svg>
 * elements (ruler + tracks) into one self-contained SVG document — redrawing
 * gutter labels and position markers, and resolving CSS custom properties to
 * concrete values so the result rasterizes correctly out of document context.
 */

/** CSS custom properties referenced by the genome renderers. */
const TOKEN_NAMES = [
  '--bg', '--bg-elevated', '--bg-panel', '--bg-input', '--bg-hover', '--bg-active',
  '--border', '--border-strong', '--text', '--text-dim', '--text-faint',
  '--accent', '--accent-strong', '--accent-soft', '--good', '--warn', '--bad',
  '--base-a', '--base-c', '--base-g', '--base-t', '--mono'
]

/** Read the current theme's token values from :root. */
export function getThemeTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const name of TOKEN_NAMES) {
    const v = cs.getPropertyValue(name).trim()
    if (v) out[name] = v
  }
  return out
}

/** Replace every var(--token) / var(--token, fallback) with a concrete value. */
export function resolveCssVars(markup: string, tokens: Record<string, string>): string {
  return markup.replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)/gi, (_m, name, fallback) => {
    return tokens[name] ?? (fallback ? String(fallback).trim() : 'transparent')
  })
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
}

function svgHeight(el: SVGSVGElement): number {
  const attr = Number(el.getAttribute('height'))
  if (Number.isFinite(attr) && attr > 0) return attr
  const r = el.getBoundingClientRect()
  return Math.max(1, Math.round(r.height))
}

export interface SnapshotMarker {
  /** x within the track area (px from track-area left). */
  x: number
  /** Optional range end x; when set, the marker is drawn as a bar [x, x2). */
  x2?: number
  label: string
  color: string
}

export interface SnapshotOptions {
  gutter: number
  trackWidth: number
  rulerHeight: number
  chromName: string
  locusLabel: string
  markers: SnapshotMarker[]
}

export interface SnapshotResult {
  svg: string
  width: number
  height: number
}

/**
 * Build a composite SVG of the current browser view. `root` must contain the
 * ruler svg (data-geneo-ruler) and the track svgs (data-geneo-track-name).
 */
export function buildSnapshotSvg(root: HTMLElement, opts: SnapshotOptions): SnapshotResult {
  const tokens = getThemeTokens()
  const serializer = new XMLSerializer()
  const { gutter, trackWidth, rulerHeight, chromName, locusLabel, markers } = opts
  const width = gutter + trackWidth
  const labelColor = tokens['--text-dim'] ?? '#aab2c0'
  const faintColor = tokens['--text-faint'] ?? '#6f7888'
  const borderColor = tokens['--border'] ?? '#313640'
  const mono = tokens['--mono'] ?? 'monospace'

  const parts: string[] = []
  let y = 0

  // --- ruler row ---
  const rulerEl = root.querySelector<SVGSVGElement>('svg[data-geneo-ruler]')
  if (rulerEl) {
    const h = svgHeight(rulerEl)
    parts.push(`<text x="8" y="${y + h - 10}" font-size="10" font-family="${mono}" fill="${faintColor}">${escapeXml(chromName)}</text>`)
    parts.push(`<g transform="translate(${gutter}, ${y})">${serializer.serializeToString(rulerEl)}</g>`)
    y += h
  }

  // --- track rows (each cell carries its name; the svg is the child renderer) ---
  const trackCells = Array.from(root.querySelectorAll<HTMLElement>('[data-geneo-track-name]'))
  for (const cell of trackCells) {
    const el = cell.querySelector('svg')
    if (!el) continue
    const h = svgHeight(el)
    const name = cell.getAttribute('data-geneo-track-name') ?? ''
    parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${borderColor}" stroke-width="1"/>`)
    parts.push(`<text x="8" y="${y + 16}" font-size="11" font-weight="600" font-family="sans-serif" fill="${labelColor}">${escapeXml(name)}</text>`)
    parts.push(`<g transform="translate(${gutter}, ${y})">${serializer.serializeToString(el)}</g>`)
    y += h
  }

  const totalHeight = Math.max(y, rulerHeight + 20)

  // --- markers overlay (drawn last, on top) ---
  for (const m of markers) {
    const mx = gutter + m.x
    if (m.x2 != null && m.x2 !== m.x) {
      // range marker → highlighted bar
      const left = gutter + Math.min(m.x, m.x2)
      const right = gutter + Math.max(m.x, m.x2)
      const w = Math.max(1, right - left)
      parts.push(`<rect x="${left}" y="${rulerHeight}" width="${w}" height="${totalHeight - rulerHeight}" fill="${m.color}" fill-opacity="0.13"/>`)
      parts.push(`<rect x="${left}" y="${rulerHeight}" width="${w}" height="5" fill="${m.color}"/>`)
      parts.push(`<line x1="${left}" y1="${rulerHeight}" x2="${left}" y2="${totalHeight}" stroke="${m.color}" stroke-width="1.5" stroke-dasharray="4 3"/>`)
      parts.push(`<line x1="${right}" y1="${rulerHeight}" x2="${right}" y2="${totalHeight}" stroke="${m.color}" stroke-width="1.5" stroke-dasharray="4 3"/>`)
      parts.push(`<text x="${left + 4}" y="${rulerHeight + 14}" font-size="10" font-family="sans-serif" fill="${m.color}">${escapeXml(m.label)}</text>`)
    } else {
      parts.push(`<line x1="${mx}" y1="${rulerHeight}" x2="${mx}" y2="${totalHeight}" stroke="${m.color}" stroke-width="1.5" stroke-dasharray="4 3"/>`)
      parts.push(`<path d="M ${mx - 4} ${rulerHeight} L ${mx + 4} ${rulerHeight} L ${mx} ${rulerHeight + 6} Z" fill="${m.color}"/>`)
      parts.push(`<text x="${mx + 6}" y="${rulerHeight + 13}" font-size="10" font-family="sans-serif" fill="${m.color}">${escapeXml(m.label)}</text>`)
    }
  }

  const bg = tokens['--bg'] ?? '#16181d'
  const body = parts.join('\n')
  const raw =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}">` +
    `<rect x="0" y="0" width="${width}" height="${totalHeight}" fill="${bg}"/>` +
    `<text x="${width - 8}" y="14" text-anchor="end" font-size="10" font-family="${mono}" fill="${faintColor}">${escapeXml(locusLabel)}</text>` +
    body +
    `</svg>`

  return { svg: resolveCssVars(raw, tokens), width, height: totalHeight }
}

/** Rasterize an SVG string to a PNG data URL via an offscreen canvas. */
export async function rasterizeSvgToPng(
  svg: string,
  width: number,
  height: number,
  scale = 2
): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to render snapshot image'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Browser fallback download (used when not running under Electron). */
export function downloadInBrowser(dataOrText: string, filename: string, mime: string): void {
  const a = document.createElement('a')
  if (mime === 'image/png') {
    a.href = dataOrText // already a data URL
  } else {
    a.href = URL.createObjectURL(new Blob([dataOrText], { type: mime }))
  }
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
