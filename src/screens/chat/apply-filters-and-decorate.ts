/**
 * apply-filters-and-decorate.ts — Phase 3 (S5) of the Sessions Sidebar plan.
 *
 * Pure function: filters feed items, applies local pin/star/archive state,
 * groups by day, and returns per-source counts for chip badges.
 */

import { sortItems } from './sessions-feed'
import { matchesSessionSearch } from './session-search'
import type { SessionFeedItem, SessionSource } from './sessions-feed-types'
import type { FilterState } from '@/stores/sessions-filter-store'
import type { LocalState } from '@/stores/sessions-local-store'

// ── Group label type ───────────────────────────────────────────────────────────

export type DayGroupLabel = 'Pinned' | 'Today' | 'Yesterday' | 'Earlier'

export type SessionDayGroup = {
  label: DayGroupLabel
  items: Array<SessionFeedItem>
}

export type FilterAndDecorateResult = {
  groups: Array<SessionDayGroup>
  totalCount: number
  /** Count of items visible if only that source were selected (state+search+date applied; source filter ignored). */
  sourceCounts: Partial<Record<SessionSource, number>>
}

function matchesDateRange(
  item: SessionFeedItem,
  from: string | null,
  to: string | null,
): boolean {
  if (from) {
    const [year, month, day] = from.split('-').map(Number)
    if (item.when < new Date(year, month - 1, day).getTime()) return false
  }
  if (to) {
    const [year, month, day] = to.split('-').map(Number)
    if (item.when > new Date(year, month - 1, day, 23, 59, 59, 999).getTime()) return false
  }
  return true
}

// ── Decorator ──────────────────────────────────────────────────────────────────

function decorateItem(
  item: SessionFeedItem,
  pinnedSet: Set<string>,
  starredSet: Set<string>,
  archivedSet: Set<string>,
): SessionFeedItem {
  return {
    ...item,
    pinned: pinnedSet.has(item.id),
    starred: starredSet.has(item.id),
    archived: archivedSet.has(item.id) || item.state === 'archived',
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Apply filters and local-action flags, then group the visible items.
 *
 * sourceCounts semantics: count of items visible for each source when ONLY
 * that source is selected (current `filter.sources` ignored for counting). The
 * local-archived exclusion is applied consistently so counts match what would
 * be shown per-source.
 */
export function applyFiltersAndDecorate(
  items: Array<SessionFeedItem>,
  filter: Pick<FilterState, 'sources' | 'state' | 'query' | 'dateRange' | 'sort'>,
  local: Pick<LocalState, 'pinned' | 'starred' | 'archived'>,
): FilterAndDecorateResult {
  const pinnedSet = new Set(local.pinned)
  const starredSet = new Set(local.starred)
  const archivedSet = new Set(local.archived)
  const query = filter.query.trim()

  const passesBaseFilters = (item: SessionFeedItem): boolean => {
    const locallyArchived = archivedSet.has(item.id)
    if (filter.state === 'archived') {
      if (!locallyArchived && item.state !== 'archived') return false
    } else {
      if (locallyArchived || item.state === 'archived') return false
      if (filter.state !== 'all' && item.state !== filter.state) return false
    }
    if (query && !matchesSessionSearch(item, query)) return false
    return matchesDateRange(item, filter.dateRange.from, filter.dateRange.to)
  }

  const sourceCounts: Partial<Record<SessionSource, number>> = {}
  for (const item of items) {
    if (passesBaseFilters(item)) sourceCounts[item.src] = (sourceCounts[item.src] ?? 0) + 1
  }

  const sourceSet = new Set(filter.sources)
  const filtered = items.filter(
    (item) => (sourceSet.size === 0 || sourceSet.has(item.src)) && passesBaseFilters(item),
  )

  const decorated = sortItems(
    filtered.map((item) => decorateItem(item, pinnedSet, starredSet, archivedSet)),
    filter.sort,
  )

  // ── Group ─────────────────────────────────────────────────────────────────
  const pinnedItems: Array<SessionFeedItem> = []
  const todayItems: Array<SessionFeedItem> = []
  const yesterdayItems: Array<SessionFeedItem> = []
  const earlierItems: Array<SessionFeedItem> = []

  for (const item of decorated) {
    if (item.pinned) {
      pinnedItems.push(item)
    } else if (item.day === 'today') {
      todayItems.push(item)
    } else if (item.day === 'yesterday') {
      yesterdayItems.push(item)
    } else {
      earlierItems.push(item)
    }
  }

  const groups: Array<SessionDayGroup> = []
  if (pinnedItems.length > 0) groups.push({ label: 'Pinned', items: pinnedItems })
  if (todayItems.length > 0) groups.push({ label: 'Today', items: todayItems })
  if (yesterdayItems.length > 0) groups.push({ label: 'Yesterday', items: yesterdayItems })
  if (earlierItems.length > 0) groups.push({ label: 'Earlier', items: earlierItems })

  return {
    groups,
    totalCount: decorated.length,
    sourceCounts,
  }
}
