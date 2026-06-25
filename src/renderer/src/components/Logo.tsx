/**
 * GeneO logo mark — a circular plasmid map: a backbone ring with three colored
 * feature arcs and a small A/C/G/T base-pair ladder at the core. Drawn in a
 * 512-unit space so it scales crisply. `withTile` adds the dark app-icon tile.
 */
interface LogoProps {
  size?: number
  withTile?: boolean
  title?: string
}

export function Logo({ size = 24, withTile = false, title = 'GeneO' }: LogoProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {withTile && (
        <rect x="16" y="16" width="480" height="480" rx="112" fill="#1b1e25" stroke="#313a47" strokeWidth={4} />
      )}
      <circle cx="256" cy="256" r="150" fill="none" stroke="#3f4857" strokeWidth={14} />
      <path d="M302.4 113.3 A150 150 0 0 1 405.9 261.2" fill="none" stroke="#5cc066" strokeWidth={30} strokeLinecap="round" />
      <path d="M395.1 312.2 A150 150 0 0 1 307.3 397" fill="none" stroke="#d6953f" strokeWidth={30} strokeLinecap="round" />
      <path d="M229.9 403.7 A150 150 0 0 1 159.5 141.1" fill="none" stroke="#4f9dde" strokeWidth={30} strokeLinecap="round" />
      <g strokeLinecap="round" strokeWidth={9}>
        <line x1="244" y1="228" x2="268" y2="228" stroke="#5cc066" />
        <line x1="240" y1="242" x2="272" y2="242" stroke="#4f8fde" />
        <line x1="238" y1="256" x2="274" y2="256" stroke="#d6953f" />
        <line x1="240" y1="270" x2="272" y2="270" stroke="#d65f5f" />
        <line x1="244" y1="284" x2="268" y2="284" stroke="#5cc066" />
      </g>
    </svg>
  )
}
