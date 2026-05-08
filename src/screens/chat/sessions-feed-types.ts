/**
 * Unified session feed types — Phase 1 of the Sessions Sidebar plan.
 *
 * ID namespace: `{src}:{rawId}` — e.g. `chat:abc123`, `task:t-42`.
 * This avoids collisions across sources and matches the localStorage migration
 * plan (legacy `chat-only` pinned keys → `chat:{id}`).
 */

/** All feed sources. */
export type SessionSource = 'chat' | 'cron' | 'api' | 'task' | 'tool' | 'tg'

/**
 * Lifecycle state of a session/job/task item.
 * Mapped from source-specific state strings in each per-source hook.
 */
export type SessionState =
  | 'live'      // actively streaming / running right now
  | 'idle'      // paused, waiting, scheduled but not running
  | 'complete'  // finished successfully
  | 'error'     // failed / errored
  | 'archived'  // archived (hidden from default view)
  | 'unknown'   // state not determinable

/** Day bucket for grouping. Computed from `when` in browser local time. */
export type SessionDayBucket = 'today' | 'yesterday' | 'earlier'

/**
 * A badge is a small indicator shown on the card (e.g. tool name, assignee).
 * Text is the display string; color is an optional CSS color string.
 */
export type SessionBadge = {
  text: string
  color?: string
}

/**
 * Source-specific metadata kept under `sourceMeta` for use by card renderers
 * and search. Kept as an open record so each source can add its own fields
 * without widening the shared type.
 */
export type SessionSourceMeta = Record<string, unknown>

/**
 * Unified feed item — the canonical shape consumed by the sidebar list,
 * filter logic, and sort functions.
 *
 * Fields:
 *   id        — namespaced: `{src}:{rawId}` (e.g. `chat:abc`, `task:t-1`)
 *   src       — which source produced this item
 *   title     — primary display string
 *   sub       — secondary line (last message preview, schedule, description…)
 *   tokens    — cumulative token count if available; null otherwise
 *   when      — Unix timestamp (ms) of last activity / update
 *   day       — day bucket derived from `when`; computed by the merge hook
 *   live      — true when the item is currently streaming / actively running
 *   state     — normalized lifecycle state
 *   badges    — small tags (tool names, assignee, etc.)
 *   pinned    — locally pinned (set by sessions-local-store, Phase 2)
 *   archived  — locally archived (set by sessions-local-store, Phase 2)
 *   sourceMeta — raw source data for search and card-specific rendering
 */
export type SessionFeedItem = {
  id: string
  src: SessionSource
  title: string
  sub: string | null
  tokens: number | null
  when: number
  day: SessionDayBucket
  live: boolean
  state: SessionState
  badges: Array<SessionBadge>
  pinned: boolean
  starred: boolean
  archived: boolean
  /** Optional chip-count for collapsed grouping (e.g. unread messages, task subtasks). */
  badgeCount?: number
  sourceMeta: SessionSourceMeta
}

/** Sort options for the merged feed. */
export type SessionFeedSort = 'recent' | 'tokens' | 'source'

/** Date range filter. ISO 8601 strings or null for open-ended. */
export type SessionDateRange = {
  from: string | null
  to: string | null
}

/** Options for the merge hook `useSessionsFeed`. */
export type SessionsFeedOptions = {
  sources?: Array<SessionSource>
  state?: SessionState | 'all'
  query?: string
  dateRange?: SessionDateRange
  sort?: SessionFeedSort
}

/** Per-source result surfaced to callers so one error doesn't poison others. */
export type SessionSourceResult = {
  src: SessionSource
  items: Array<SessionFeedItem>
  available: boolean
  loading: boolean
  error: Error | null
}

/** Result of the merged feed hook. */
export type SessionsFeedResult = {
  items: Array<SessionFeedItem>
  sources: Array<SessionSourceResult>
  loading: boolean
}
