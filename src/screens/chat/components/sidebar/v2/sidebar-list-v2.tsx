'use client'

/**
 * sidebar-list-v2.tsx — day-grouped session list for the v2 sidebar.
 *
 * Phase 3c: groups prop passed from shell (no duplicate useSessionsFeed call).
 * Phase 3b: day group labels with count badges, sticky headers, Pinned section,
 * + NEW CHAT footer button.
 * Virtualization: @tanstack/react-virtual not in deps — native scroll fallback.
 */

import { Link, useRouterState } from '@tanstack/react-router'
import { SidebarCardV2 } from './sidebar-card-v2'
import type { DayGroupLabel, SessionDayGroup } from '@/screens/chat/apply-filters-and-decorate'

// ── Group label colors ────────────────────────────────────────────────────────

const GROUP_LABEL_STYLE: Record<DayGroupLabel, React.CSSProperties> = {
  Pinned: { color: 'var(--m-green-400, var(--theme-accent))' },
  Today: { color: 'var(--theme-muted)' },
  Yesterday: { color: 'var(--theme-muted)' },
  Earlier: { color: 'var(--theme-muted)' },
}

interface SidebarListV2Props {
  groups: Array<SessionDayGroup>
}

export function SidebarListV2({ groups }: SidebarListV2Props) {

  // Determine active route from router
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSessionKey = pathname.startsWith('/chat/') ? pathname.split('/chat/')[1] : null

  // Empty state
  if (groups.length === 0) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <span style={{ fontSize: 24, opacity: 0.3 }}>∅</span>
            <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>
              No sessions
            </span>
          </div>
        </div>
        <NewChatFooter />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* List */}
      <div className="flex-1 overflow-y-auto" data-testid="sessions-list-v2">
        {groups.map(({ label, items: groupItems }) => (
          <div key={label}>
            {/* Sticky group header */}
            <div
              className="flex items-center gap-2 px-3 pt-3 pb-1 sticky top-0 z-10 select-none"
              style={{
                background: 'var(--theme-sidebar)',
              }}
            >
              <span
                className="font-bold uppercase"
                style={{
                  ...GROUP_LABEL_STYLE[label],
                  letterSpacing: '0.22em',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 9,
                  opacity: 0.7,
                }}
              >
                {label}
              </span>
              <span
                className="rounded-full px-1.5 flex-shrink-0"
                style={{
                  border: '1px solid var(--m-green-500, var(--theme-accent))',
                  color: 'var(--m-green-400, var(--theme-accent))',
                  background: 'transparent',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 9,
                  lineHeight: '14px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {groupItems.length}
              </span>
              <span
                aria-hidden
                style={{
                  flex: 1,
                  height: 1,
                  background: 'var(--theme-border-subtle, var(--theme-border))',
                  opacity: 0.5,
                }}
              />
            </div>

            {/* Cards */}
            {groupItems.map((item) => {
              const rawId = item.id.split(':').slice(1).join(':')
              let isActive = false
              if (item.src === 'chat') {
                isActive = rawId === activeSessionKey
              }
              return (
                <SidebarCardV2 key={item.id} item={item} isActive={isActive} />
              )
            })}
          </div>
        ))}
      </div>

      <NewChatFooter />
    </div>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function NewChatFooter() {
  return (
    <div
      className="shrink-0 px-3 py-2"
      style={{ borderTop: '1px solid var(--theme-border)' }}
    >
      <Link
        to="/chat/$sessionKey"
        params={{ sessionKey: 'new' }}
        style={{ textDecoration: 'none', display: 'block' }}
      >
        <button
          type="button"
          className="w-full rounded py-1.5 text-xs font-bold uppercase tracking-widest transition-all"
          style={{
            background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)',
            color: 'var(--m-green-400, var(--theme-accent))',
            border: '1px solid var(--m-green-500, var(--theme-accent))',
            boxShadow: '0 0 8px var(--m-green-500, var(--theme-accent))44',
            fontFamily: 'var(--font-mono, monospace)',
            letterSpacing: '0.12em',
            cursor: 'pointer',
          }}
        >
          + NEW CHAT
        </button>
      </Link>
    </div>
  )
}
