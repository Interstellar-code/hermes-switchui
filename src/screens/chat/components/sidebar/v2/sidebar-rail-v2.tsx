'use client'

/**
 * sidebar-rail-v2.tsx — collapsed 44px rail for the v2 sidebar.
 *
 * Phase 3b: vertical "SESSIONS" label, count badge, live-pulse indicator,
 * search/filter re-expand icons, new-chat icon at bottom.
 */

interface SidebarRailV2Props {
  collapsed: boolean
  onExpand: () => void
  totalCount?: number
  hasLive?: boolean
}

export function SidebarRailV2({ collapsed, onExpand, totalCount, hasLive }: SidebarRailV2Props) {
  return (
    <div
      className="flex flex-col items-center shrink-0"
      data-testid="sidebar-rail-v2"
      aria-label={collapsed ? 'Expand sessions panel' : 'Sessions rail'}
      style={{
        width: 44,
        borderRight: '1px solid var(--theme-border)',
        background: 'var(--theme-sidebar)',
      }}
    >
      {collapsed ? (
        /* ── Collapsed mode ── */
        <div
          className="flex flex-col items-center justify-between h-full w-full py-3 cursor-pointer"
          onClick={onExpand}
          role="button"
          tabIndex={0}
          aria-label="Expand sessions panel"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onExpand() }}
        >
          {/* Top section */}
          <div className="flex flex-col items-center gap-2">
            {/* Vertical SESSIONS label */}
            <span
              style={{
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
                transform: 'rotate(180deg)',
                color: 'var(--m-green-400, var(--theme-accent))',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: '0.15em',
                userSelect: 'none',
                marginTop: 8,
              }}
            >
              SESSIONS
            </span>

            {/* Count badge */}
            {totalCount != null && totalCount > 0 && (
              <span
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 20,
                  height: 20,
                  background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)',
                  color: 'var(--m-green-400, var(--theme-accent))',
                  border: '1px solid var(--m-green-500, var(--theme-accent))',
                  fontSize: 9,
                  fontFamily: 'var(--font-mono, monospace)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {totalCount > 99 ? '99+' : totalCount}
              </span>
            )}

            {/* Live pulse */}
            {hasLive && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--m-green-500, var(--theme-accent))',
                  boxShadow: '0 0 6px var(--m-green-500, var(--theme-accent))',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  display: 'block',
                }}
              />
            )}
          </div>

          {/* Middle icons: search + filter */}
          <div className="flex flex-col items-center gap-2">
            <RailIcon aria-label="Expand to search">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </RailIcon>
            <RailIcon aria-label="Expand to filter">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2 3h12M4 8h8M6 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </RailIcon>
          </div>

          {/* Bottom: new chat icon */}
          <RailIcon aria-label="New chat">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </RailIcon>
        </div>
      ) : (
        /* ── Expanded mode — rail is just a decorative strip ── */
        null
      )}
    </div>
  )
}

// ── Small icon helper for rail ────────────────────────────────────────────────

interface RailIconProps {
  children: React.ReactNode
  'aria-label': string
}

function RailIcon({ children, 'aria-label': ariaLabel }: RailIconProps) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className="flex items-center justify-center rounded"
      style={{
        width: 28,
        height: 28,
        color: 'var(--theme-muted)',
      }}
    >
      {children}
    </span>
  )
}
