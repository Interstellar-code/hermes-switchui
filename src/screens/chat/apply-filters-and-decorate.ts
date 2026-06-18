/**
 * apply-filters-and-decorate.ts — Phase 3 (S5) of the Sessions Sidebar plan.
 *
 * Pure function: takes pre-filtered+sorted feed items from useSessionsFeed +
 * filter state + local-action state, decorates with pin/star/archive flags,
 * groups by day, and returns sourceCounts for chip badges.
 *
 * S5 perf note: items arriving here have already been filtered and sorted by
 * useSessionsFeed (source filter, state filter, text search, date range, sort).
 * This function therefore:
 *   - Skips the duplicate source/state/search/date filter pass on `items`
 *     (was O(n) wasted work — useSessionsFeed already did it)
 *   - Skips the duplicate sort (was O(n log n) wasted work)
 *   - Only applies local-archived exclusion (not covered by useSessionsFeed,
 *     which only sees gateway state, not the local sessions-local-store set)
 *   - Keeps the sourceCounts loop over the incoming items (same semantics as
 *     before: counts within the already-filtered set, source filter ignored for
 *     counting purposes — this is intentional for chip badge accuracy)
 */

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
 * Decorate pre-filtered+sorted items with local-action flags, group into
 * Pinned / Today / Yesterday / Earlier buckets, and compute per-source counts
 * for chip badges.
 *
 * Precondition: `items` have already been filtered (source, state, text search,
 * date range) and sorted by `useSessionsFeed`. This function does NOT re-filter
 * or re-sort — doing so would duplicate O(n) + O(n log n) work on every render.
 *
 * The only additional filtering applied here is local-archived exclusion: items
 * in `local.archived` that were not already hidden by the gateway state filter
 * (useSessionsFeed only checks `item.state === 'archived'`, not the local set).
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
  // Build Sets once — O(1) lookups replace O(m) array.includes per item
  const pinnedSet = new Set(local.pinned)
  const starredSet = new Set(local.starred)
  const archivedSet = new Set(local.archived)

  // ── sourceCounts: count items per source (local-archived exclusion applied) ─
  // useSessionsFeed already applied source/state/search/date filters, so items
  // here are the already-filtered set. We still need to exclude locally-archived
  // items unless the filter explicitly requests the archived view.
  const showArchived = filter.state === 'archived'

  const sourceCounts: Partial<Record<SessionSource, number>> = {}
  for (const item of items) {
    if (!showArchived && archivedSet.has(item.id)) continue
    sourceCounts[item.src] = (sourceCounts[item.src] ?? 0) + 1
  }

  // ── Full filter: only exclude locally-archived items (not already handled) ──
  // useSessionsFeed hides items with item.state === 'archived' when state='all',
  // but does NOT know about the local archived set stored in sessions-local-store.
  const filtered = showArchived
    ? items
    : items.filter((item) => !archivedSet.has(item.id))

  // ── Decorate ──────────────────────────────────────────────────────────────
  // Items are already sorted by useSessionsFeed — no re-sort needed.
  const decorated = filtered.map((item) => decorateItem(item, pinnedSet, starredSet, archivedSet))

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
