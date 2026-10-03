'use client'

/**
 * sidebar-shell-v2.tsx — 3-column grid shell for the unified sessions sidebar.
 *
 * Phase 3b: wires collapsed state to filter store, passes count+live to rail,
 * count to header.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { SidebarHeaderV2 } from './sidebar-header-v2'
import { SidebarListV2 } from './sidebar-list-v2'
import { SidebarRailV2 } from './sidebar-rail-v2'
import { SidebarSearchV2 } from './sidebar-search-v2'
import { SidebarSourceChipsV2 } from './sidebar-source-chips-v2'
import {
  SidebarResizeHandleV2,
  clampSidebarWidth,
} from './sidebar-resize-handle-v2'
import { SidebarGroupToggleV2 } from './sidebar-folders-v2'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { useSessionProjectMap } from '@/lib/projects-api'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'
import {
  isSessionUpdateUnseen,
  useSessionsLocalStore,
} from '@/stores/sessions-local-store'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import {
  addUnloadedSourceCounts,
  mergeSessionFeedItems,
  useProfileSessionTotals,
  useSessionSourceTotals,
  useSessionWindowPages,
  useSessionsFeed,
  visibleSourceProgress,
} from '@/screens/chat/sessions-feed'
import { applyFiltersAndDecorate } from '@/screens/chat/apply-filters-and-decorate'
import { DEFAULT_SESSION_LIST_LIMIT } from '@/screens/chat/chat-queries'

export function SidebarShellV2() {
  const collapsed = useSessionsFilterStore((s) => s.collapsed)
  const setCollapsed = useSessionsFilterStore((s) => s.setCollapsed)
  const storedWidth = useSessionsFilterStore((s) => s.sidebarWidth)
  const setSidebarWidth = useSessionsFilterStore((s) => s.setSidebarWidth)
  const panelRef = useRef<HTMLDivElement>(null)
  // Static clamp only (SSR-safe); the 50vw cap is the panel's CSS max-width.
  const sidebarWidth = clampSidebarWidth(storedWidth)
  const fSources = useSessionsFilterStore((s) => s.sources)
  const fQuery = useSessionsFilterStore((s) => s.query)
  const fDateRange = useSessionsFilterStore((s) => s.dateRange)
  const fSort = useSessionsFilterStore((s) => s.sort)
  const fUpdatesOnly = useSessionsFilterStore((s) => s.updatesOnly)
  const toggleUpdatesOnly = useSessionsFilterStore((s) => s.toggleUpdatesOnly)
  const groupBy = useSessionsFilterStore((s) => s.groupBy)

  // Folders = the browsed profile's projects; map only fetched in project mode.
  const profile = useResolvedProfile() ?? undefined
  const { data: folderMap } = useSessionProjectMap(
    profile,
    groupBy === 'project',
  )
  const exitSelect = useSessionsSelectionStore((s) => s.exit)
  useEffect(() => exitSelect(), [profile, exitSelect])

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
  const { items: baseItems, sources } = useSessionsFeed({
    raw: true,
    query: fQuery,
  })
  const { totals: profileTotals } = useProfileSessionTotals()

  // The feed holds only the newest window per source; chips count the real
  // server totals and the list pages in the rest on demand.
  const sourceTotals = useSessionSourceTotals(profile ?? null)
  const hiddenSources: Array<string> = fSources
  const countFiltered =
    Boolean(fQuery.trim()) ||
    Boolean(fDateRange.from || fDateRange.to) ||
    fUpdatesOnly
  // Clicking chips one by one would otherwise key (and auto-fetch) a window
  // per intermediate selection.
  const [windowSources, setWindowSources] = useState(fSources)
  useEffect(() => {
    const timer = setTimeout(() => setWindowSources(fSources), 300)
    return () => clearTimeout(timer)
  }, [fSources])
  // A narrowed selection whose visible server sources have rows the base
  // windows did not load fetches its own window straight away.
  const autoLoad = useMemo(() => {
    if (windowSources.length === 0 || !sourceTotals) return false
    const { loaded, total } = visibleSourceProgress(
      baseItems,
      sourceTotals,
      windowSources,
    )
    return loaded < total
  }, [baseItems, sourceTotals, windowSources])
  const windowPages = useSessionWindowPages(
    profile ?? null,
    windowSources,
    autoLoad,
  )
  const items = useMemo(
    () =>
      windowPages.items.length > 0
        ? mergeSessionFeedItems(windowPages.items, baseItems)
        : baseItems,
    [baseItems, windowPages.items],
  )

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
  const {
    groups,
    totalCount,
    sourceCounts: loadedSourceCounts,
  } = useMemo(
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
        { groupBy, map: folderMap },
      ),
    [
      groupBy,
      folderMap,
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

  // Server totals only when nothing narrows the count the server can't see
  // (search, date window, updates-only); otherwise count what is loaded.
  const sourceCounts = useMemo(
    () =>
      countFiltered
        ? loadedSourceCounts
        : addUnloadedSourceCounts(loadedSourceCounts, items, sourceTotals),
    [countFiltered, loadedSourceCounts, items, sourceTotals],
  )
  // Progress per visible SERVER source (not per-chip remainders), so hiding
  // CHAT while API stays visible still pages api_server.
  const progress = useMemo(
    () =>
      sourceTotals
        ? visibleSourceProgress(items, sourceTotals, fSources)
        : null,
    [items, sourceTotals, fSources],
  )
  const loadedVisible = Object.entries(loadedSourceCounts).reduce(
    (sum, [src, n]) => (hiddenSources.includes(src) ? sum : sum + n),
    0,
  )
  // Filters keep "Load more" (older pages can match a date window or search)
  // but drop the "of M": the server total ignores those filters. Without a
  // total, offer it only once a full first window came back.
  const showTotal = progress !== null && !countFiltered
  const loadMore =
    windowPages.hasMore &&
    (progress
      ? progress.loaded < progress.total
      : items.length >= DEFAULT_SESSION_LIST_LIMIT)
      ? {
          loaded: showTotal ? progress.loaded : loadedVisible,
          total: showTotal ? progress.total : null,
          loading: windowPages.loading,
          onLoadMore: windowPages.loadMore,
        }
      : undefined

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
        <div className="relative flex shrink-0 my-2 mx-2">
          <div
            className="flex flex-col overflow-hidden rounded-md"
            ref={panelRef}
            data-testid="sessions-panel"
            style={{
              width: sidebarWidth,
              maxWidth: 'max(260px, 50vw)',
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-sidebar)',
            }}
          >
            <SidebarHeaderV2
              onCollapse={() => setCollapsed(true)}
              count={totalCount}
              totals={profileTotals}
            />
            <SidebarSearchV2 />
            <SidebarSourceChipsV2
              sourceResults={sources}
              sourceCounts={sourceCounts}
              attention={attention}
            />
            <SidebarGroupToggleV2 profile={profile} map={folderMap} />
            <SidebarListV2
              groups={groups}
              updatesOnly={fUpdatesOnly}
              hasPendingUpdates={Object.values(attention).some(
                ({ updated }) => updated,
              )}
              onToggleUpdatesOnly={toggleUpdatesOnly}
              onMarkAllRead={() => markSessionsSeen(items)}
              loadMore={loadMore}
            />
          </div>
          <SidebarResizeHandleV2
            width={sidebarWidth}
            onResize={setSidebarWidth}
            panelRef={panelRef}
          />
        </div>
      )}
    </div>
  )
}
