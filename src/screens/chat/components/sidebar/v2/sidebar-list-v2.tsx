'use client'

/**
 * sidebar-list-v2.tsx — day-grouped session list for the v2 sidebar.
 *
 * Phase 3c: groups prop passed from shell (no duplicate useSessionsFeed call).
 * Phase 3b: day group labels with count badges, sticky headers, Pinned section,
 * + NEW CHAT footer button.
 * Phase 6: virtualized grouped list via @tanstack/react-virtual.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual'
import { SidebarCardV2 } from './sidebar-card-v2'
import type { DayGroupLabel, SessionDayGroup } from '@/screens/chat/apply-filters-and-decorate'

const COLLAPSED_KEY = 'hermes.sessions.groups.collapsed'
const HEADER_ESTIMATE = 36
const CARD_ESTIMATE = 74

function readCollapsedMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeCollapsedMap(map: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(map))
  } catch {
    /* noop */
  }
}

const GROUP_LABEL_STYLE: Record<DayGroupLabel, React.CSSProperties> = {
  Pinned: { color: 'var(--m-green-400, var(--theme-accent))' },
  Today: { color: 'var(--theme-muted)' },
  Yesterday: { color: 'var(--theme-muted)' },
  Earlier: { color: 'var(--theme-muted)' },
}

type RowModel =
  | { type: 'header'; key: string; label: DayGroupLabel; count: number; collapsed: boolean }
  | { type: 'card'; key: string; groupLabel: DayGroupLabel; item: SessionDayGroup['items'][number]; isActive: boolean }

interface SidebarListV2Props {
  groups: Array<SessionDayGroup>
}

export function SidebarListV2({ groups }: SidebarListV2Props) {
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(readCollapsedMap)
  const toggleGroup = (label: DayGroupLabel) => {
    setCollapsedMap((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      writeCollapsedMap(next)
      return next
    })
  }

  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSessionKey = pathname.startsWith('/chat/') ? pathname.split('/chat/')[1] : null
  const parentRef = useRef<HTMLDivElement | null>(null)
  // Tracks the header index that should be pinned at the top of the
  // viewport for the current scroll offset. Driven by `rangeExtractor`
  // so the active header is always kept in the virtual window (it would
  // otherwise unmount once scrolled past, and `position: sticky` cannot
  // work on the `absolute`+`translateY` rows the virtualizer emits).
  const activeStickyIndexRef = useRef(0)

  const rows = useMemo<RowModel[]>(() => {
    const next: RowModel[] = []
    for (const { label, items: groupItems } of groups) {
      const isCollapsed = collapsedMap[label] === true
      next.push({
        type: 'header',
        key: `header:${label}`,
        label,
        count: groupItems.length,
        collapsed: isCollapsed,
      })
      if (!isCollapsed) {
        for (const item of groupItems) {
          const rawId = item.id.split(':').slice(1).join(':')
          const isActive =
            (item.src === 'chat' || item.src === 'recovered' || item.src === 'cron' || item.src === 'api' || item.src === 'task') &&
            rawId === activeSessionKey
          next.push({
            type: 'card',
            key: item.id,
            groupLabel: label,
            item,
            isActive,
          })
        }
      }
    }
    return next
  }, [groups, collapsedMap, activeSessionKey])

  const stickyIndexes = useMemo(
    () => rows.flatMap((row, i) => (row.type === 'header' ? [i] : [])),
    [rows],
  )

  const rangeExtractor = useCallback(
    (range: Range) => {
      // Pin the nearest preceding header so it stays mounted and can be
      // rendered as a sticky overlay even after its rows scroll past.
      let active = stickyIndexes[0] ?? 0
      for (const idx of stickyIndexes) {
        if (idx <= range.startIndex) active = idx
        else break
      }
      activeStickyIndexRef.current = active
      const next = new Set([active, ...defaultRangeExtractor(range)])
      return [...next].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === 'header' ? HEADER_ESTIMATE : CARD_ESTIMATE),
    overscan: 8,
    rangeExtractor,
  })

  useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, rows.length])

  // Auto-scroll the active session into view. With virtualization the
  // active row may not be mounted at all, so the browser can't reach it
  // on its own — drive the virtualizer to the index explicitly.
  useEffect(() => {
    if (!activeSessionKey) return
    const idx = rows.findIndex((row) => row.type === 'card' && row.isActive)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' })
    // Only when the active session changes, not on every rows rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionKey])

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
      <div ref={parentRef} className="flex-1 overflow-y-auto" data-testid="sessions-list-v2">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null
            const isStickyHeader =
              row.type === 'header' &&
              activeStickyIndexRef.current === virtualRow.index
            return (
              <div
                key={row.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={
                  isStickyHeader
                    ? {
                        // Pinned header: real `position: sticky` works here
                        // because this element is in normal flow relative to
                        // the scroll container (no transform offset).
                        position: 'sticky',
                        top: 0,
                        left: 0,
                        width: '100%',
                        zIndex: 2,
                      }
                    : {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }
                }
              >
                {row.type === 'header' ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(row.label)}
                    aria-expanded={!row.collapsed}
                    aria-controls={`group-${row.label}`}
                    className="flex items-center gap-2 px-3 pt-3 pb-1 z-10 select-none w-full"
                    style={{
                      background: 'var(--theme-sidebar)',
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
                        transform: row.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        transition: 'transform 120ms ease-out',
                      }}
                    >
                      ▼
                    </span>
                    <span
                      className="m-label"
                      style={{
                        ...GROUP_LABEL_STYLE[row.label],
                        opacity: 0.7,
                      }}
                    >
                      {row.label}
                    </span>
                    <span
                      className="m-mono rounded-full px-1.5 flex-shrink-0"
                      style={{
                        border: '1px solid var(--m-green-500, var(--theme-accent))',
                        color: 'var(--m-green-400, var(--theme-accent))',
                        background: 'transparent',
                        lineHeight: '14px',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.count}
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
                  </button>
                ) : (
                  <div id={`group-${row.groupLabel}`}>
                    <SidebarCardV2 item={row.item} isActive={row.isActive} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <NewChatFooter />
    </div>
  )
}

function NewChatFooter() {
  return (
    <div className="shrink-0 px-3 py-2" style={{ borderTop: '1px solid var(--theme-border)' }}>
      <Link to="/chat/$sessionKey" params={{ sessionKey: 'new' }} style={{ textDecoration: 'none', display: 'block' }}>
        <button
          type="button"
          className="m-label w-full rounded py-1.5 font-bold transition-all"
          style={{
            background: 'color-mix(in srgb, var(--m-green-500, var(--theme-accent)) 20%, transparent)',
            color: 'var(--m-green-400, var(--theme-accent))',
            border: '1px solid var(--m-green-500, var(--theme-accent))',
            boxShadow: '0 0 8px var(--m-green-500, var(--theme-accent))44',
            cursor: 'pointer',
          }}
        >
          + NEW CHAT
        </button>
      </Link>
    </div>
  )
}
