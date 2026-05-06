'use client'

/**
 * sidebar-header-v2.tsx — header row for the sessions panel.
 *
 * Shows: "SESSIONS" title, session count · N, refresh / date-filter / filter / collapse icons.
 * Phase 3b: full mockup fidelity.
 */

interface SidebarHeaderV2Props {
  onCollapse?: () => void
  count?: number
}

export function SidebarHeaderV2({ onCollapse, count }: SidebarHeaderV2Props) {
  return (
    <div
      className="flex items-center justify-between shrink-0 px-3"
      data-testid="sessions-panel-header"
      style={{
        height: 44,
        borderBottom: '1px solid var(--theme-border)',
        background: 'var(--theme-sidebar)',
      }}
    >
      {/* Left: title + count */}
      <div className="flex items-center gap-1 min-w-0">
        <span
          className="text-xs font-bold uppercase select-none"
          style={{
            color: 'var(--m-green-400, var(--theme-accent))',
            letterSpacing: '0.12em',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          SESSIONS
        </span>
        {count != null && (
          <span
            className="text-xs select-none"
            style={{
              color: 'var(--theme-muted)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            · {count}
          </span>
        )}
      </div>

      {/* Right: action icons */}
      <div className="flex items-center gap-0.5">
        {/* Refresh */}
        <IconButton aria-label="Refresh sessions">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.07-3.43L10 6h4V2l-0.35 0.35z" fill="currentColor"/>
          </svg>
        </IconButton>

        {/* Calendar / date filter */}
        <IconButton aria-label="Date filter">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="1" y="3" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M1 6h14" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </IconButton>

        {/* Filter (active glow) */}
        <IconButton aria-label="Filter sessions" active>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 3h12M4 8h8M6 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </IconButton>

        {/* Collapse / fold */}
        <IconButton aria-label="Collapse sessions panel" onClick={onCollapse}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </IconButton>
      </div>
    </div>
  )
}

// ── Small icon button helper ──────────────────────────────────────────────────

interface IconButtonProps {
  children: React.ReactNode
  'aria-label': string
  onClick?: () => void
  active?: boolean
}

function IconButton({ children, 'aria-label': ariaLabel, onClick, active }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex items-center justify-center rounded transition-colors"
      style={{
        width: 24,
        height: 24,
        color: active ? 'var(--m-green-400, var(--theme-accent))' : 'var(--theme-muted)',
        background: 'transparent',
        boxShadow: active ? '0 0 6px var(--m-green-500, var(--theme-accent))' : 'none',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
