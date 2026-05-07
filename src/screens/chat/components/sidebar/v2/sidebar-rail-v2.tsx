'use client'

/**
 * sidebar-rail-v2.tsx — collapsed 44px rail.
 * - Vertical SESSIONS label + count + live pulse.
 * - Functional source filter chips (icon-only).
 * - Highlighted "+" new chat button.
 */

import { Link } from '@tanstack/react-router'
import type { FilterAndDecorateResult } from '@/screens/chat/apply-filters-and-decorate'
import type { SessionSource, SessionSourceResult } from '@/screens/chat/sessions-feed-types'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

interface SidebarRailV2Props {
  collapsed: boolean
  onExpand: () => void
  totalCount?: number
  hasLive?: boolean
  sourceCounts?: FilterAndDecorateResult['sourceCounts']
  sourceResults?: Array<SessionSourceResult>
}

const RAIL_SOURCES: Array<{ id: SessionSource; label: string; color: string; icon: React.ReactNode }> = [
  {
    id: 'chat',
    label: 'Chat',
    color: 'var(--m-green-400, #00ff41)',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2 3h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'task',
    label: 'Task',
    color: '#ff9f5f',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5.5 7.5l1.5 1.5 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'cron',
    label: 'Cron',
    color: '#d6ff5f',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'api',
    label: 'API',
    color: '#5fcfff',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 5h10M3 8h10M3 11h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
]

export function SidebarRailV2({
  collapsed,
  onExpand,
  totalCount,
  hasLive,
  sourceCounts,
  sourceResults,
}: SidebarRailV2Props) {
  const sources = useSessionsFilterStore((s) => s.sources)
  const toggleSource = useSessionsFilterStore((s) => s.toggleSource)

  if (!collapsed) {
    return (
      <div
        className="flex flex-col items-center shrink-0"
        style={{ width: 44, borderRight: '1px solid var(--theme-border)', background: 'var(--theme-sidebar)' }}
      />
    )
  }

  // Hide chip if source-result reports unavailable
  const availableSet = new Set<string>()
  if (sourceResults) {
    for (const r of sourceResults) {
      if (r.available) availableSet.add(r.src)
    }
  }
  // chat/cron/api derive from chat source — show if chat is available OR if we have any items for the kind
  const chatAvailable = availableSet.has('chat') || (sourceCounts?.chat ?? 0) > 0 || (sourceCounts?.cron ?? 0) > 0 || (sourceCounts?.api ?? 0) > 0 || (sourceCounts?.task ?? 0) > 0

  return (
    <div
      className="flex flex-col items-center shrink-0 rounded-md my-2 mx-2"
      data-testid="sidebar-rail-v2"
      aria-label="Sessions rail"
      style={{
        width: 44,
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-sidebar)',
      }}
    >
      <div className="flex flex-col items-center justify-between h-full w-full py-3">
        {/* Top: SESSIONS label + count + live + expand */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand sessions panel"
            className="flex flex-col items-center gap-2 cursor-pointer bg-transparent border-0 p-0"
            style={{ color: 'inherit' }}
          >
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
                marginTop: 4,
              }}
            >
              SESSIONS
            </span>
            {totalCount != null && totalCount > 0 && (
              <span
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 22,
                  height: 22,
                  background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 18%, transparent)',
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
          </button>
        </div>

        {/* Middle: source filter chips (icon-only) */}
        <div className="flex flex-col items-center gap-1.5">
          {RAIL_SOURCES.map(({ id, label, color, icon }) => {
            if (!chatAvailable) return null
            const active = sources.includes(id)
            const count = sourceCounts?.[id] ?? 0
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                aria-label={`${label} — ${count}`}
                title={`${label} (${count})`}
                onClick={() => {
                  toggleSource(id)
                  onExpand()
                }}
                className="flex items-center justify-center rounded-full transition-all"
                style={{
                  width: 32,
                  height: 32,
                  background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                  color: active ? color : 'var(--theme-muted)',
                  border: `1px solid ${active ? color : 'var(--theme-border)'}`,
                  boxShadow: active ? `0 0 6px ${color}66` : 'none',
                  cursor: 'pointer',
                }}
                data-testid={`rail-chip-${id}`}
              >
                {icon}
              </button>
            )
          })}
        </div>

        {/* Bottom: New chat (highlighted) */}
        <Link
          to="/chat/$sessionKey"
          params={{ sessionKey: 'new' }}
          aria-label="New chat"
          style={{ textDecoration: 'none' }}
        >
          <span
            className="flex items-center justify-center rounded-full transition-all"
            style={{
              width: 32,
              height: 32,
              background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 22%, transparent)',
              color: 'var(--m-green-400, var(--theme-accent))',
              border: '1px solid var(--m-green-500, var(--theme-accent))',
              boxShadow: '0 0 8px color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 40%, transparent)',
              cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
        </Link>
      </div>
    </div>
  )
}
