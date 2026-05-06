'use client'

/**
 * sidebar-list-v2.tsx — day-grouped session list for the v2 sidebar.
 *
 * Consumes `useSessionsFeed` + `applyFiltersAndDecorate`.
 * Phase 3a: renders grouped list with basic cards; virtualization in 3b.
 */

import { SidebarCardV2 } from './sidebar-card-v2'
import { applyFiltersAndDecorate } from '@/screens/chat/apply-filters-and-decorate'
import { useSessionsFeed } from '@/screens/chat/sessions-feed'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'

export function SidebarListV2() {
  const filterState = useSessionsFilterStore()
  const localState = useSessionsLocalStore()
  const { items } = useSessionsFeed({
    sources: filterState.sources,
    state: filterState.state,
    query: filterState.query,
    dateRange: filterState.dateRange,
    sort: filterState.sort,
  })

  const { groups } = applyFiltersAndDecorate(items, filterState, localState)

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs" style={{ color: 'var(--theme-muted)' }}>
          No sessions
        </span>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto" data-testid="sessions-list-v2">
      {groups.map(({ label, items: groupItems }) => (
        <div key={label}>
          <div
            className="px-3 py-1 text-xs font-semibold uppercase tracking-widest sticky top-0"
            style={{
              color: 'var(--theme-muted)',
              background: 'var(--theme-sidebar)',
              borderBottom: '1px solid var(--theme-border-subtle, var(--theme-border))',
            }}
          >
            {label}
          </div>
          {groupItems.map((item) => (
            <SidebarCardV2 key={item.id} item={item} />
          ))}
        </div>
      ))}
    </div>
  )
}
