'use client'

/**
 * sidebar-shell-v2.tsx — 3-column grid shell for the unified sessions sidebar.
 *
 * Phase 3b: wires collapsed state to filter store, passes count+live to rail,
 * count to header.
 */

import { useEffect, useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { SidebarHeaderV2 } from './sidebar-header-v2'
import { SidebarListV2 } from './sidebar-list-v2'
import { SidebarRailV2 } from './sidebar-rail-v2'
import { SidebarSearchV2 } from './sidebar-search-v2'
import { SidebarSourceChipsV2 } from './sidebar-source-chips-v2'
import {
  isSessionUpdateUnseen,
  useSessionsLocalStore,
} from '@/stores/sessions-local-store'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import { useSessionsFeed } from '@/screens/chat/sessions-feed'
import { applyFiltersAndDecorate } from '@/screens/chat/apply-filters-and-decorate'

export function SidebarShellV2() {
  const collapsed = useSessionsFilterStore((s) => s.collapsed)
  const setCollapsed = useSessionsFilterStore((s) => s.setCollapsed)
  const fSources = useSessionsFilterStore((s) => s.sources)
  const fQuery = useSessionsFilterStore((s) => s.query)
  const fDateRange = useSessionsFilterStore((s) => s.dateRange)
  const fSort = useSessionsFilterStore((s) => s.sort)
  const fUpdatesOnly = useSessionsFilterStore((s) => s.updatesOnly)
  const toggleUpdatesOnly = useSessionsFilterStore((s) => s.toggleUpdatesOnly)

  const lPinned = useSessionsLocalStore((s) => s.pinned)
  const lStarred = useSessionsLocalStore((s) => s.starred)
  const lArchived = useSessionsLocalStore((s) => s.archived)
  const lastSeenUpdate = useSessionsLocalStore((s) => s.lastSeenUpdate)
  const seenUpdatesInitialized = useSessionsLocalStore(
    (s) => s.seenUpdatesInitialized,
  )
  const initializeSeenUpdates = useSessionsLocalStore(
    (s) => s.initializeSeenUpdates,
  )
  const markSessionSeen = useSessionsLocalStore((s) => s.markSessionSeen)
  const markSessionsSeen = useSessionsLocalStore((s) => s.markSessionsSeen)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Single feed subscription — SidebarListV2 consumes groups via prop (no duplicate hook)
  const { items, sources } = useSessionsFeed({ raw: true, query: fQuery })

  useEffect(() => {
    if (!sources.some((source) => source.src === 'chat' && source.available))
      return
    initializeSeenUpdates(items)
  }, [initializeSeenUpdates, items, sources])

  useEffect(() => {
    const sessionKey = pathname.match(/^\/chat\/(.+)$/)?.[1]
    if (!sessionKey) return
    const item = items.find(
      (candidate) => candidate.id.split(':').slice(1).join(':') === sessionKey,
    )
    if (item) markSessionSeen(item.id, item.when)
  }, [items, markSessionSeen, pathname])

  // Memoize to avoid new object refs on every render
  const { groups, totalCount, sourceCounts } = useMemo(
    () =>
      applyFiltersAndDecorate(
        items,
        {
          sources: fSources,
          state: 'all',
          query: fQuery,
          dateRange: fDateRange,
          sort: fSort,
          updatesOnly: fUpdatesOnly,
        },
        {
          pinned: lPinned,
          starred: lStarred,
          archived: lArchived,
          lastSeenUpdate,
          seenUpdatesInitialized,
        },
      ),
    [
      items,
      fSources,
      fQuery,
      fDateRange,
      fSort,
      fUpdatesOnly,
      lPinned,
      lStarred,
      lArchived,
      lastSeenUpdate,
      seenUpdatesInitialized,
    ],
  )

  const hasLive = useMemo(() => items.some((i) => i.live), [items])
  const attention = useMemo(() => {
    const next: Partial<
      Record<(typeof items)[number]['src'], { live: boolean; updated: boolean }>
    > = {}
    for (const item of items) {
      if (lArchived.includes(item.id) || item.state === 'archived') continue
      const current = next[item.src] ?? { live: false, updated: false }
      current.live ||= item.live
      current.updated ||=
        !item.live &&
        isSessionUpdateUnseen(item.id, item.when, {
          lastSeenUpdate,
          seenUpdatesInitialized,
        })
      next[item.src] = current
    }
    return next
  }, [items, lArchived, lastSeenUpdate, seenUpdatesInitialized])

  return (
    <div
      className="relative flex h-full overflow-hidden"
      data-testid="sidebar-shell-v2"
      style={{ background: 'var(--theme-sidebar)' }}
    >
      {collapsed ? (
        <SidebarRailV2
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
          totalCount={totalCount}
          hasLive={hasLive}
          sourceCounts={sourceCounts}
          sourceResults={sources}
        />
      ) : (
        <div
          className="flex flex-col shrink-0 overflow-hidden rounded-md my-2 mx-2"
          data-testid="sessions-panel"
          style={{
            width: 320,
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-sidebar)',
          }}
        >
          <SidebarHeaderV2
            onCollapse={() => setCollapsed(true)}
            count={totalCount}
          />
          <SidebarSearchV2 />
          <SidebarSourceChipsV2
            sourceResults={sources}
            sourceCounts={sourceCounts}
            attention={attention}
          />
          <SidebarListV2
            groups={groups}
            updatesOnly={fUpdatesOnly}
            hasPendingUpdates={Object.values(attention).some(
              ({ updated }) => updated,
            )}
            onToggleUpdatesOnly={toggleUpdatesOnly}
            onMarkAllRead={() => markSessionsSeen(items)}
          />
        </div>
      )}
    </div>
  )
}
