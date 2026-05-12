/**
 * PixelAvatar — minimal stub replacing the deleted swarm pixel-avatar component.
 * Renders a simple colored circle as a lightweight agent avatar.
 */

export type PixelAvatarStatus = 'idle' | 'thinking' | 'running' | 'complete' | 'failed' | 'queued'

export type PixelAvatarProps = {
  color?: string
  accentColor?: string
  size?: number
  status?: PixelAvatarStatus
  className?: string
}

export function PixelAvatar({
  color = '#3b82f6',
  accentColor,
  size = 24,
  status,
  className,
}: PixelAvatarProps) {
  const isActive = status === 'running' || status === 'thinking'
  const fill = isActive ? (accentColor ?? color) : color

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="10" fill={fill} opacity={0.85} />
      <circle cx="12" cy="12" r="6" fill={color} opacity={0.6} />
    </svg>
  )
}

// Persona color palette used by agent-card for avatar coloring
export const PERSONA_COLORS: Record<string, { body: string; accent: string }> = {
  alice: { body: '#6366f1', accent: '#a5b4fc' },
  bob: { body: '#10b981', accent: '#6ee7b7' },
  carol: { body: '#f59e0b', accent: '#fcd34d' },
  dave: { body: '#ef4444', accent: '#fca5a5' },
  eve: { body: '#8b5cf6', accent: '#c4b5fd' },
  frank: { body: '#06b6d4', accent: '#67e8f9' },
  grace: { body: '#ec4899', accent: '#f9a8d4' },
  heidi: { body: '#84cc16', accent: '#bef264' },
  ivan: { body: '#f97316', accent: '#fdba74' },
  judy: { body: '#14b8a6', accent: '#5eead4' },
}
