'use client'

/**
 * sidebar-archived-folder-v2.tsx — collapsible "Archived" folder, last thing in
 * the sidebar list.
 *
 * Archived chats are not a view of the main list any more: they live here, under
 * their own group header. Collapsed it costs nothing — the `archived=only`
 * pages only run while it is open — and expanded it pages the backend-archived
 * rows through the same card the main list uses, so the context menu (and with
 * it Unarchive) behaves exactly as it does everywhere else in the sidebar.
 */

import { useCallback, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { SidebarCardV2 } from './sidebar-card-v2'
import { useArchivedSessionPages } from '@/screens/chat/sessions-feed'

/** Open/closed state is a sidebar preference, so it survives reloads. */
const OPEN_KEY = 'switchui:sidebar-archived-open'

function readOpen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

interface SidebarArchivedFolderV2Props {
  /** The browsed profile; null = the active one, read unscoped. */
  profile?: string
  /** Sidebar search text. Non-empty hides the folder. */
  searchQuery?: string
}

export function SidebarArchivedFolderV2({
  profile,
  searchQuery = '',
}: SidebarArchivedFolderV2Props) {
  // Collapsed by default; no `archived=only` request until it is opened.
  const [open, setOpen] = useState(readOpen)
  const pages = useArchivedSessionPages(profile ?? null, open)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSessionKey = pathname.startsWith('/chat/')
    ? pathname.split('/chat/')[1]
    : null

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      } catch {
        /* noop */
      }
      return next
    })
  }, [])

  // A live search means "these are the results"; a folder of archived rows
  // pinned under the box contradicts it. Archived chats stay reachable — clear
  // the search.
  if (searchQuery.trim()) return null

  const { items, hasMore, loading, loadMore } = pages
  // The list response carries no total (`/api/sessions` returns just `sessions`
  // unless a profile is browsed), so the badge is loaded rows, not a server
  // count — and only once there are rows to count.
  const count = items.length
  const countLabel = `${count} archived chat${count === 1 ? '' : 's'}`

  return (
    <div data-testid="archived-folder" style={{ paddingBottom: 4 }}>
      <div
        className="flex items-center gap-1 pr-2 select-none"
        style={{ background: 'var(--theme-sidebar)' }}
      >
        <button
          type="button"
          data-testid="archived-folder-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-label={
            open
              ? `Collapse Archived, ${countLabel}`
              : `Expand Archived, ${count === 0 ? 'count unknown' : countLabel}`
          }
          className="flex min-w-0 items-center gap-2 pl-3 pt-3 pb-1 z-10"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
          }}
        >
          <span
            aria-hidden
            className="m-mono"
            style={{
              display: 'inline-block',
              fontSize: 8,
              width: 10,
              textAlign: 'center',
              color: 'var(--theme-muted)',
              opacity: 0.7,
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 120ms ease-out',
            }}
          >
            ▼
          </span>
          <span
            className="m-label truncate"
            style={{ color: 'var(--theme-muted)', opacity: 0.7 }}
          >
            Archived
          </span>
          {count > 0 && (
            <span
              className="m-mono rounded-full px-1.5 flex-shrink-0"
              style={{
                border: '1px solid var(--m-green-500, var(--theme-accent))',
                color: 'var(--m-green-400, var(--theme-accent))',
                background: 'transparent',
                lineHeight: '14px',
                fontVariantNumeric: 'tabular-nums',
              }}
              data-testid="archived-folder-count"
            >
              {count}
            </span>
          )}
        </button>
        <span
          aria-hidden
          onClick={toggle}
          className="mt-2 ml-1"
          style={{
            flex: 1,
            alignSelf: 'stretch',
            backgroundImage:
              'linear-gradient(var(--theme-border-subtle, var(--theme-border)), var(--theme-border-subtle, var(--theme-border)))',
            backgroundSize: '100% 1px',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: 0.5,
            cursor: 'pointer',
          }}
        />
      </div>

      {open && (
        <div data-testid="archived-folder-body" aria-busy={loading}>
          {items.length === 0 && (
            <div
              className="px-3 py-2 text-xs"
              data-testid={
                loading ? 'archived-folder-loading' : 'archived-folder-empty'
              }
              style={{ color: 'var(--theme-muted)' }}
            >
              {loading ? 'Loading archived chats…' : 'No archived chats'}
            </div>
          )}
          <div data-testid="archived-folder-rows">
            {items.map((item) => {
              const rawId = item.id.split(':').slice(1).join(':')
              return (
                <div key={item.id} data-testid={`archived-row-${item.id}`}>
                  <SidebarCardV2
                    item={item}
                    isActive={item.src === 'chat' && rawId === activeSessionKey}
                  />
                </div>
              )
            })}
          </div>
          {hasMore && (
            <div
              className="flex items-center justify-between gap-2 px-3 pb-2 text-xs"
              style={{ color: 'var(--theme-muted)' }}
            >
              <span className="m-mono" aria-live="polite">
                Loaded {count}
              </span>
              <button
                type="button"
                // aria-disabled, not disabled: focus stays on the button while
                // the next page loads instead of dropping back to <body>.
                aria-disabled={loading}
                aria-busy={loading}
                data-testid="archived-folder-load-more"
                onClick={() => {
                  if (!loading) loadMore()
                }}
                className="rounded px-2 py-0.5"
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-card)',
                  color: 'var(--theme-text)',
                  cursor: loading ? 'default' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
