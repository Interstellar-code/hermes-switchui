/**
 * apply-filters-and-decorate.ts — Phase 2 of the Sessions Sidebar plan.
 *
 * Pure function: takes raw feed items + filter state + local-action state,
 * applies all filters, decorates with pin/star/archive flags, groups by day,
 * and returns sourceCounts for chip badges.
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

// ── Filter helpers (pure, no imports from sessions-feed for these) ─────────────

function matchesDateRange(
  item: SessionFeedItem,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true
  if (from) {
    const [fy, fm, fd] = from.split('-').map(Number)
    const fromMs = new Date(fy, fm - 1, fd, 0, 0, 0, 0).getTime()
    if (Number.isFinite(fromMs) && item.when < fromMs) return false
  }
  if (to) {
    // Inclusive to-day: local end-of-day 23:59:59.999
    const [ty, tm, td] = to.split('-').map(Number)
    const toMs = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime()
    if (Number.isFinite(toMs) && item.when > toMs) return false
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
 * Apply all active filters to `items`, decorate with local-action flags,
 * group into Pinned / Today / Yesterday / Earlier buckets, and compute
 * per-source counts for chip badges.
 *
 * sourceCounts semantics: count of items visible for each source when ONLY
 * that source is selected (state + search + date filters applied; current
 * `filter.sources` ignored for counting purposes).
 */
export function applyFiltersAndDecorate(
  items: Array<SessionFeedItem>,
  filter: Pick<FilterState, 'sources' | 'state' | 'query' | 'dateRange' | 'sort'>,
  local: Pick<LocalState, 'pinned' | 'starred' | 'archived'>,
): FilterAndDecorateResult {
  const lowerQuery = filter.query.trim().toLowerCase()

  // Build Sets once — O(1) lookups replace O(m) array.includes per item
  const pinnedSet = new Set(local.pinned)
  const starredSet = new Set(local.starred)
  const archivedSet = new Set(local.archived)

  // ── Base filter (state + search + date) — used for sourceCounts ───────────
  function passesBaseFilters(item: SessionFeedItem): boolean {
    // State filter
    if (filter.state === 'archived') {
      // archived state: show only items whose local.archived contains this id OR item.state === 'archived'
      const locallyArchived = archivedSet.has(item.id)
      if (!locallyArchived && item.state !== 'archived') return false
    } else if (filter.state !== 'all') {
      // Specific state: item must match AND not be archived
      if (archivedSet.has(item.id)) return false
      if (item.state !== filter.state) return false
    } else {
      // 'all': hide archived
      if (archivedSet.has(item.id)) return false
      if (item.state === 'archived') return false
    }

    // Search
    if (lowerQuery.length > 0 && !matchesSessionSearch(item, lowerQuery)) return false

    // Date range
    if (!matchesDateRange(item, filter.dateRange.from, filter.dateRange.to)) return false

    return true
  }

  // ── sourceCounts: apply base filters per source, ignoring current source filter ──
  const sourceCounts: Partial<Record<SessionSource, number>> = {}
  for (const item of items) {
    if (passesBaseFilters(item)) {
      sourceCounts[item.src] = (sourceCounts[item.src] ?? 0) + 1
    }
  }

  // ── Full filter including source filter ──────────────────────────────────
  const sourceSet = new Set(filter.sources)
  const includeAllSources = sourceSet.size === 0

  const filtered = items.filter((item) => {
    if (!includeAllSources && !sourceSet.has(item.src)) return false
    return passesBaseFilters(item)
  })

  // ── Decorate ──────────────────────────────────────────────────────────────
  const decorated = filtered.map((item) => decorateItem(item, pinnedSet, starredSet, archivedSet))

  // ── Sort within groups ────────────────────────────────────────────────────
  const sorted = sortItems(decorated, filter.sort)

  // ── Group ─────────────────────────────────────────────────────────────────
  const pinnedItems: Array<SessionFeedItem> = []
  const todayItems: Array<SessionFeedItem> = []
  const yesterdayItems: Array<SessionFeedItem> = []
  const earlierItems: Array<SessionFeedItem> = []

  for (const item of sorted) {
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
    totalCount: sorted.length,
    sourceCounts,
  }
}
