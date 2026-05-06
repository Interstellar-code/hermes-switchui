'use client'

/**
 * sidebar-shell-v2.tsx — 3-column grid shell for the unified sessions sidebar.
 *
 * Phase 3b: wires collapsed state to filter store, passes count+live to rail,
 * count to header.
 */

import { SidebarHeaderV2 } from './sidebar-header-v2'
import { SidebarListV2 } from './sidebar-list-v2'
import { SidebarRailV2 } from './sidebar-rail-v2'
import { SidebarSearchV2 } from './sidebar-search-v2'
import { SidebarSourceChipsV2 } from './sidebar-source-chips-v2'
import { SidebarStateSegmentV2 } from './sidebar-state-segment-v2'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import { useSessionsFeed } from '@/screens/chat/sessions-feed'
import { applyFiltersAndDecorate } from '@/screens/chat/apply-filters-and-decorate'

export function SidebarShellV2() {
  const collapsed = useSessionsFilterStore((s) => s.collapsed)
  const setCollapsed = useSessionsFilterStore((s) => s.setCollapsed)
  const fSources = useSessionsFilterStore((s) => s.sources)
  const fState = useSessionsFilterStore((s) => s.state)
  const fQuery = useSessionsFilterStore((s) => s.query)
  const fDateRange = useSessionsFilterStore((s) => s.dateRange)
  const fSort = useSessionsFilterStore((s) => s.sort)

  const lPinned = useSessionsLocalStore((s) => s.pinned)
  const lStarred = useSessionsLocalStore((s) => s.starred)
  const lArchived = useSessionsLocalStore((s) => s.archived)

  const { items, sources } = useSessionsFeed({
    sources: fSources,
    state: fState,
    query: fQuery,
    dateRange: fDateRange,
    sort: fSort,
  })

  const filterState = { version: 1 as const, sources: fSources, state: fState, query: fQuery, dateRange: fDateRange, sort: fSort, collapsed }
  const localState = { version: 1 as const, pinned: lPinned, starred: lStarred, archived: lArchived }

  const { totalCount, sourceCounts } = applyFiltersAndDecorate(items, filterState, localState)
  const hasLive = items.some((i) => i.live)

  return (
    <div
      className="flex h-full overflow-hidden"
      data-testid="sidebar-shell-v2"
      style={{ background: 'var(--theme-sidebar)' }}
    >
      {/* Collapsed: 44px rail only. Expanded: full sessions panel only. */}
      {collapsed ? (
        <SidebarRailV2
          collapsed={collapsed}
          onExpand={() => setCollapsed(false)}
          totalCount={totalCount}
          hasLive={hasLive}
        />
      ) : (
        <div
          className="flex flex-col border-r shrink-0 overflow-hidden"
          data-testid="sessions-panel"
          style={{
            width: 320,
            borderColor: 'var(--theme-border)',
            background: 'var(--theme-sidebar)',
          }}
        >
          <SidebarHeaderV2 onCollapse={() => setCollapsed(true)} count={totalCount} />
          <SidebarSearchV2 />
          <SidebarSourceChipsV2 sourceResults={sources} sourceCounts={sourceCounts} />
          <SidebarStateSegmentV2 />
          <SidebarListV2 />
        </div>
      )}

    </div>
  )
}
