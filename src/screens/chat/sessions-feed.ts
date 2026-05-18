/**
 * sessions-feed.ts — per-source TanStack Query hooks + unified merge hook.
 *
 * Phase 1 of the Sessions Sidebar plan.
 *
 * Design principles:
 *   - Each source hook returns `{items, available, loading, error}`.
 *   - If capability is missing, hook returns `{items: [], available: false}` — never throws.
 *   - One source erroring does NOT block other sources.
 *   - Day bucketing uses browser local time via Date.toLocaleDateString boundaries.
 *   - Sort options: 'recent' | 'tokens' | 'source'.
 *   - IDs are namespaced: `{src}:{rawId}` (e.g. `chat:abc`, `task:t-1`).
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchSessions } from './chat-queries'
import type {
  SessionBadge,
  SessionDayBucket,
  SessionFeedItem,
  SessionFeedSort,
  SessionSource,
  SessionSourceResult,
  SessionState,
  SessionsFeedOptions,
  SessionsFeedResult,
} from './sessions-feed-types'

// ── Capability accessor ────────────────────────────────────────────────────────
// We read capabilities from the /api/connection-status endpoint (already used
// in the app). Capabilities are treated as stable across the life of the page;
// re-probe happens on window focus + manual refresh (Phase 2/3).

type CapabilityMap = {
  sessions: boolean
  jobs: boolean
  kanban: boolean
  memory: boolean
}

async function fetchCapabilities(): Promise<CapabilityMap> {
  try {
    const res = await fetch('/api/connection-status')
    if (!res.ok)
      return { sessions: false, jobs: false, kanban: false, memory: false }
    const data = (await res.json()) as {
      capabilities?: Partial<CapabilityMap>
      sessions?: boolean
      jobs?: boolean
      kanban?: boolean
      memory?: boolean
    }
    const caps = data.capabilities ?? data
    return {
      sessions: Boolean(caps.sessions),
      jobs: Boolean(caps.jobs),
      kanban: Boolean(caps.kanban),
      // memory capability is always true in the gateway (reads filesystem)
      memory: caps.memory !== false,
    }
  } catch {
    return { sessions: false, jobs: false, kanban: false, memory: false }
  }
}

const CAPABILITIES_QUERY_KEY = ['sessions-feed', 'capabilities'] as const

// ── Day bucketing ──────────────────────────────────────────────────────────────

/**
 * Classify a Unix timestamp (ms) into a day bucket relative to today,
 * using browser local time. DST is handled by Date.toLocaleDateString
 * boundaries, not UTC offsets.
 */
export function getDayBucket(whenMs: number, nowMs: number): SessionDayBucket {
  const locale =
    typeof navigator !== 'undefined' ? navigator.language : undefined
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  const itemDay = new Date(whenMs).toLocaleDateString(locale, opts)
  const todayDay = new Date(nowMs).toLocaleDateString(locale, opts)
  // DST-safe: derive yesterday by subtracting one calendar day from today's
  // midnight boundary, not by subtracting 86 400 000 ms (which breaks on
  // spring-forward / fall-back transitions where the day is 23 h or 25 h).
  const todayStart = new Date(nowMs)
  todayStart.setHours(0, 0, 0, 0)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)
  const yesterdayDay = yesterdayStart.toLocaleDateString(locale, opts)

  if (itemDay === todayDay) return 'today'
  if (itemDay === yesterdayDay) return 'yesterday'
  return 'earlier'
}

// ── ID namespacing ─────────────────────────────────────────────────────────────

function makeId(src: SessionSource, rawId: string): string {
  return `${src}:${rawId}`
}

// ── State normalization ────────────────────────────────────────────────────────

// ── Chat source hook ───────────────────────────────────────────────────────────

/** Hook for chat sessions.
 *
 * `/api/sessions` is the source of truth. Do not gate this query only on
 * `/api/connection-status`: that endpoint is a coarse capability snapshot and
 * can be stale during gateway/dashboard restarts, leaving the sidebar stuck at
 * "0" even while `/api/sessions` is healthy.
 */
export function useChatSessionsFeed(): SessionSourceResult {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })

  const available = capsQuery.data?.sessions ?? false

  const query = useQuery({
    queryKey: ['sessions-feed', 'chat', 'v3-task-split'],
    queryFn: async () => {
      const sessions = await fetchSessions()
      const nowMs = Date.now()
      return sessions.map((s): SessionFeedItem => {
        const when = s.updatedAt ?? 0
        const rawTitle = s.title ?? s.derivedTitle ?? s.label ?? s.key
        const rawSub = s.preview ?? null
        const badges: Array<SessionBadge> = []
        // Detect session origin by key prefix:
        //   cron_{jobId}_{YYYYMMDD_HHMMSS} — scheduled cron run (scheduler.py:1003)
        //   api-{hex}                       — programmatic API caller (CLI, MCP, scripts)
        //   YYYYMMDD_HHMMSS_*               — manual UI-created chat
        const titleLower = (s.title ?? s.derivedTitle ?? '').toLowerCase()
        const previewLower = (s.preview ?? '').toLowerCase()
        const isTaskTriggered =
          titleLower.startsWith('work kanban task ') ||
          previewLower.startsWith('work kanban task ')
        const kind: SessionSource = s.key.startsWith('cron_')
          ? 'cron'
          : s.key.startsWith('api-')
            ? 'api'
            : isTaskTriggered
              ? 'task'
              : 'chat'
        return {
          id: makeId('chat', s.key),
          src: kind,
          title: rawTitle,
          sub: rawSub,
          tokens: s.tokenCount ?? s.totalTokens ?? null,
          when,
          day: getDayBucket(when, nowMs),
          live: false, // live flag set by chat-store subscriber in Phase 3
          state: 'idle',
          badges,
          pinned: false,
          starred: false,
          archived: false,
          sourceMeta: {
            key: s.key,
            friendlyId: s.friendlyId,
            titleStatus: s.titleStatus,
            lastMessage: s.lastMessage,
            kind,
            messageCount: s.messageCount,
            toolCallCount: s.toolCallCount,
            model: s.model,
          },
        }
      })
    },
    staleTime: 30_000,
    refetchInterval: false,
  })

  const queryHasData = Array.isArray(query.data)
  const effectiveAvailable = available || queryHasData

  return effectiveAvailable
    ? {
        src: 'chat',
        items: query.data ?? [],
        available: true,
        loading: query.isLoading,
        error: query.error,
      }
    : { src: 'chat', items: [], available: false, loading: false, error: null }
}

// ── Tool / Telegram source hooks — permanently unavailable ───────────────────

export function useToolSessionsFeed(): SessionSourceResult {
  return {
    src: 'tool',
    items: [],
    available: false,
    loading: false,
    error: null,
  }
}

export function useTelegramSessionsFeed(): SessionSourceResult {
  return { src: 'tg', items: [], available: false, loading: false, error: null }
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

function matchesQuery(item: SessionFeedItem, q: string): boolean {
  const lower = q.toLowerCase()
  if (item.title.toLowerCase().includes(lower)) return true
  if (item.sub?.toLowerCase().includes(lower)) return true
  for (const badge of item.badges) {
    if (badge.text.toLowerCase().includes(lower)) return true
  }
  // Also search sourceMeta string values
  for (const val of Object.values(item.sourceMeta)) {
    if (typeof val === 'string' && val.toLowerCase().includes(lower))
      return true
  }
  return false
}

function matchesDateRange(
  item: SessionFeedItem,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true
  const itemDate = item.when
  if (from) {
    const fromMs = new Date(from).getTime()
    if (Number.isFinite(fromMs) && itemDate < fromMs) return false
  }
  if (to) {
    // Include the full to-day: add 24h
    const toMs = new Date(to).getTime() + 86_400_000
    if (Number.isFinite(toMs) && itemDate >= toMs) return false
  }
  return true
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

const SOURCE_ORDER: Record<SessionSource, number> = {
  chat: 0,
  task: 1,
  cron: 2,
  api: 3,
  tool: 4,
  tg: 5,
}

export function sortItems(
  items: Array<SessionFeedItem>,
  sort: SessionFeedSort,
): Array<SessionFeedItem> {
  const copy = [...items]
  if (sort === 'recent') {
    copy.sort((a, b) => b.when - a.when)
  } else if (sort === 'tokens') {
    copy.sort((a, b) => {
      const ta = a.tokens ?? -1
      const tb = b.tokens ?? -1
      if (tb !== ta) return tb - ta
      return b.when - a.when
    })
  } else {
    // sort === 'source'
    copy.sort((a, b) => {
      const sa = SOURCE_ORDER[a.src]
      const sb = SOURCE_ORDER[b.src]
      if (sa !== sb) return sa - sb
      return b.when - a.when
    })
  }
  return copy
}

// ── Merged feed hook ───────────────────────────────────────────────────────────

/**
 * Merges all enabled per-source feeds with filtering and sorting.
 *
 * - `sources`: when empty/undefined, all sources are included (empty = "all").
 * - `state`: 'all' (default) passes everything; other values filter by state.
 * - `query`: 200 ms debounce is the caller's responsibility; this hook uses the
 *   value as-is for pure computation.
 * - `dateRange`: ISO 8601 strings or null.
 * - `sort`: 'recent' (default) | 'tokens' | 'source'.
 *
 * One source loading or erroring does not block others — per-source error and
 * loading states are surfaced in `result.sources`.
 */
export function useSessionsFeed(
  options: SessionsFeedOptions = {},
): SessionsFeedResult {
  const {
    sources: requestedSources,
    state: stateFilter = 'all',
    query = '',
    dateRange,
    sort = 'recent',
  } = options

  const chat = useChatSessionsFeed()
  const tool = useToolSessionsFeed()
  const tg = useTelegramSessionsFeed()
  // cron/task/memory removed from sidebar:
  //   - cron-generated chat sessions appear directly in chat source.
  //   - tasks moved to a dedicated chat-header tab (see chat-source-tabs-v2).
  //   - memory removed entirely from chat sidebar.
  const allSources: Array<SessionSourceResult> = [chat, tool, tg]

  const result = useMemo(() => {
    const now = Date.now()

    // Recompute day buckets at merge time (avoids stale buckets from cached data)
    const rebase = (item: SessionFeedItem): SessionFeedItem => ({
      ...item,
      day: getDayBucket(item.when, now),
    })

    // Determine which sources to include. Empty = all.
    const sourceFilter = new Set<SessionSource>(
      requestedSources && requestedSources.length > 0 ? requestedSources : [],
    )
    const includeAll = sourceFilter.size === 0

    let merged: Array<SessionFeedItem> = []

    for (const sourceResult of allSources) {
      if (!sourceResult.available) continue
      const rebased = sourceResult.items.map(rebase)
      merged.push(...rebased)
    }

    // Source filter applied at the item level — chat hook may emit items with
    // src='cron' (cron-generated chat sessions detected by key prefix), so we
    // can't gate by sourceResult.src.
    if (!includeAll) {
      merged = merged.filter((item) => sourceFilter.has(item.src))
    }

    // State filter (skip 'all')
    if (stateFilter !== 'all') {
      merged = merged.filter((item) => item.state === stateFilter)
    } else {
      // By default hide archived items (they appear only when stateFilter = 'archived')
      merged = merged.filter((item) => item.state !== 'archived')
    }

    // Text search
    const trimmedQuery = query.trim()
    if (trimmedQuery.length > 0) {
      merged = merged.filter((item) => matchesQuery(item, trimmedQuery))
    }

    // Date range
    if (dateRange) {
      merged = merged.filter((item) =>
        matchesDateRange(item, dateRange.from, dateRange.to),
      )
    }

    // Sort
    merged = sortItems(merged, sort)

    const loading = allSources.some((s) => s.available && s.loading)

    return {
      items: merged,
      sources: allSources,
      loading,
    }
  }, [
    chat.items,
    chat.available,
    chat.loading,
    tool.available,
    tg.available,
    requestedSources,
    stateFilter,
    query,
    dateRange,
    sort,
  ])

  return result
}
