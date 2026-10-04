/**
 * apply-filters-and-decorate.ts — Phase 3 (S5) of the Sessions Sidebar plan.
 *
 * Pure function: filters feed items, applies local pin/star/archive state,
 * groups by day (or by project folder), and returns per-source counts for
 * chip badges.
 */

import { sortItems } from './sessions-feed'
import { matchesSessionSearch } from './session-search'
import type { SessionFeedItem, SessionSource } from './sessions-feed-types'
import type { FilterState } from '@/stores/sessions-filter-store'
import type { SessionProjectMap } from '@/lib/projects-types'
import type { LocalState } from '@/stores/sessions-local-store'
import { isSessionUpdateUnseen } from '@/stores/sessions-local-store'

// ── Group label type ───────────────────────────────────────────────────────────

export type DayGroupLabel = 'Pinned' | 'Today' | 'Yesterday' | 'Earlier'

export type SessionGroupKind = 'pinned' | 'day' | 'project' | 'unfiled'

export type SessionGroup = {
  /** Stable id: `pinned`, `day:Today`, `project:<id>`, `unfiled`. */
  key: string
  label: string
  kind: SessionGroupKind
  color?: string | null
  icon?: string | null
  archived?: boolean
  items: Array<SessionFeedItem>
  /** Server count of listable sessions in this folder (project/unfiled only, unfiltered views only). */
  total?: number
}

/** @deprecated use `SessionGroup`; kept so existing imports compile. */
export type SessionDayGroup = SessionGroup

export type SessionGrouping = {
  groupBy: FilterState['groupBy']
  map?: SessionProjectMap | null
  /** Attach the map's server folder counts (`total`) — only when no filter narrows the list. */
  withTotals?: boolean
}

export type FilterAndDecorateResult = {
  groups: Array<SessionGroup>
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
    if (item.when > new Date(year, month - 1, day, 23, 59, 59, 999).getTime())
      return false
  }
  return true
}

// ── Decorator ──────────────────────────────────────────────────────────────────

function decorateItem(
  item: SessionFeedItem,
  pinnedSet: Set<string>,
  starredSet: Set<string>,
  archivedSet: Set<string>,
  local: Pick<LocalState, 'lastSeenUpdate' | 'seenUpdatesInitialized'>,
): SessionFeedItem {
  return {
    ...item,
    pinned: pinnedSet.has(item.id),
    starred: starredSet.has(item.id),
    archived: archivedSet.has(item.id) || item.state === 'archived',
    hasUnseenUpdate:
      !item.live && isSessionUpdateUnseen(item.id, item.when, local),
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
  filter: Pick<
    FilterState,
    'sources' | 'state' | 'query' | 'dateRange' | 'sort' | 'updatesOnly'
  >,
  local: Pick<
    LocalState,
    | 'pinned'
    | 'starred'
    | 'archived'
    | 'lastSeenUpdate'
    | 'seenUpdatesInitialized'
  >,
  grouping?: SessionGrouping,
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
    if (
      filter.updatesOnly &&
      (item.live || !isSessionUpdateUnseen(item.id, item.when, local))
    )
      return false
    // Pending updates — and anything the user explicitly searched for — must
    // remain discoverable even after the usual sidebar date window has moved
    // on. A search that silently drops every hit older than the window reads
    // as a broken search box.
    return (
      filter.updatesOnly ||
      Boolean(query) ||
      matchesDateRange(item, filter.dateRange.from, filter.dateRange.to)
    )
  }

  const sourceCounts: Partial<Record<SessionSource, number>> = {}
  for (const item of items) {
    if (passesBaseFilters(item))
      sourceCounts[item.src] = (sourceCounts[item.src] ?? 0) + 1
  }

  // `filter.sources` is a blocklist: a selected chip hides that source. Empty
  // = nothing hidden = everything shows.
  const hiddenSources = new Set(filter.sources)
  const filtered = items.filter(
    (item) => !hiddenSources.has(item.src) && passesBaseFilters(item),
  )

  const decorated = sortItems(
    filtered.map((item) =>
      decorateItem(item, pinnedSet, starredSet, archivedSet, local),
    ),
    filter.sort,
  )

  const map = grouping?.groupBy === 'project' ? grouping.map : null
  // Server folder counts include sessions this view hides locally (archived
  // here, not on the server); they are subtracted from each folder's total.
  // ponytail: only LOADED locally-archived rows are known, so unloaded ones
  // still count — N can overstate by those; a server-side local-archive list
  // would fix it.
  const locallyHidden = grouping?.withTotals
    ? items.filter((i) => archivedSet.has(i.id) && i.state !== 'archived')
    : null
  const groups = map
    ? groupByProject(decorated, map, locallyHidden)
    : groupByDay(decorated)

  return {
    groups,
    totalCount: decorated.length,
    sourceCounts,
  }
}

// ── Grouping ───────────────────────────────────────────────────────────────────

function pinnedGroup(items: Array<SessionFeedItem>): SessionGroup {
  return { key: 'pinned', label: 'Pinned', kind: 'pinned', items }
}

function groupByDay(decorated: Array<SessionFeedItem>): Array<SessionGroup> {
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

  const groups: Array<SessionGroup> = []
  if (pinnedItems.length > 0) groups.push(pinnedGroup(pinnedItems))
  const days: Array<[DayGroupLabel, Array<SessionFeedItem>]> = [
    ['Today', todayItems],
    ['Yesterday', yesterdayItems],
    ['Earlier', earlierItems],
  ]
  for (const [label, items] of days) {
    if (items.length > 0)
      groups.push({ key: `day:${label}`, label, kind: 'day', items })
  }
  return groups
}

/**
 * Pinned → live projects (map order, non-empty) → archived projects
 * (non-empty) → Unfiled. Items keep the incoming sort within each section.
 * Map entries pointing at unknown projects (or sessions not in the feed) are
 * ignored, so their items fall through to Unfiled.
 */
function groupByProject(
  decorated: Array<SessionFeedItem>,
  map: SessionProjectMap,
  /** null = no server totals (a filter narrows the view). */
  locallyHidden: Array<SessionFeedItem> | null,
): Array<SessionGroup> {
  const folderOf = (item: SessionFeedItem): string | undefined => {
    const rawId = item.id.split(':').slice(1).join(':')
    return Object.hasOwn(map.sessions, rawId) ? map.sessions[rawId] : undefined
  }
  const knownIds = new Set(map.projects.map((p) => p.id))
  // Server-counted sessions shown elsewhere (Pinned) or hidden locally, per folder.
  const elsewhere = new Map<string, number>()
  const countElsewhere = (item: SessionFeedItem) => {
    const id = folderOf(item)
    const key = id && knownIds.has(id) ? id : 'unfiled'
    elsewhere.set(key, (elsewhere.get(key) ?? 0) + 1)
  }
  locallyHidden?.forEach(countElsewhere)
  // Folders with server sessions but none loaded still get a header.
  const totalOf = (key: string, n: number | undefined) =>
    locallyHidden && n !== undefined
      ? { total: Math.max(0, n - (elsewhere.get(key) ?? 0)) }
      : {}
  const pinnedItems: Array<SessionFeedItem> = []
  const unfiled: Array<SessionFeedItem> = []
  const byProject = new Map<string, Array<SessionFeedItem>>(
    map.projects.map((p) => [p.id, []]),
  )
  const nameOf = new Map(map.projects.map((p) => [p.id, p.name]))

  for (const item of decorated) {
    if (item.pinned) {
      pinnedItems.push(item)
      countElsewhere(item)
      continue
    }
    const rawId = item.id.split(':').slice(1).join(':')
    const projectId = folderOf(item)
    const bucket = projectId ? byProject.get(projectId) : undefined
    if (bucket && projectId)
      bucket.push(
        map.inherited?.[rawId]
          ? { ...item, inheritedFolder: nameOf.get(projectId) }
          : item,
      )
    else unfiled.push(item)
  }

  const groups: Array<SessionGroup> = []
  if (pinnedItems.length > 0) groups.push(pinnedGroup(pinnedItems))
  for (const archived of [false, true]) {
    for (const p of map.projects) {
      const items = byProject.get(p.id)!
      const extra = totalOf(p.id, map.counts && (map.counts[p.id] ?? 0))
      if (p.archived !== archived || (items.length === 0 && !extra.total))
        continue
      groups.push({
        key: `project:${p.id}`,
        label: p.name,
        kind: 'project',
        color: p.color,
        icon: p.icon,
        archived: p.archived,
        items,
        ...extra,
      })
    }
  }
  const unfiledExtra = totalOf('unfiled', map.unfiled)
  if (unfiled.length > 0 || unfiledExtra.total)
    groups.push({
      key: 'unfiled',
      label: 'Unfiled',
      kind: 'unfiled',
      items: unfiled,
      ...unfiledExtra,
    })
  return groups
}
