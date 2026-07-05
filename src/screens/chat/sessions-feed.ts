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
import { chatQueryKeys, fetchSessions } from './chat-queries'
import { filterSessionsWithTombstones } from './session-tombstones'
import { matchesSessionSearch } from './session-search'
import type { QueryClient } from '@tanstack/react-query'
import type { ClaudeJob } from '@/lib/jobs-api'
import type {
  SessionBadge,
  SessionDayBucket,
  SessionFeedItem,
  SessionFeedSort,
  SessionSource,
  SessionSourceResult,
  SessionsFeedOptions,
  SessionsFeedResult,
} from './sessions-feed-types'
import { fetchJobs, findJobById } from '@/lib/jobs-api'

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

/**
 * Retained for mutations (e.g. tombstone-based delete) that need to invalidate
 * the V2 sidebar feed independently. The sub-key `['sessions-feed','chat']`
 * matches the cron-jobs query prefix so a single invalidate clears it too.
 */
export const SESSIONS_FEED_KEY = ['sessions-feed', 'chat'] as const

/**
 * Invalidate the single session-list cache.
 *
 * The V2 sidebar feed now reads raw sessions from `chatQueryKeys.sessions`
 * (the same key used by all mutation optimistic-update helpers), so only one
 * invalidation is needed. Calling this causes both `useChatSessions` and
 * `useChatSessionsFeed` to re-fetch from `/api/sessions`.
 */
export function invalidateSessionLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
}

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

type CronSessionParts = {
  jobId: string
  runStartedAt: Date | null
}

export function parseCronSessionKey(key: string): CronSessionParts | null {
  const match = /^cron_([0-9a-f]{12})_(\d{8})_(\d{6})$/.exec(key)
  if (!match) return null
  const [, jobId, datePart, timePart] = match
  const year = Number(datePart.slice(0, 4))
  const month = Number(datePart.slice(4, 6)) - 1
  const day = Number(datePart.slice(6, 8))
  const hour = Number(timePart.slice(0, 2))
  const minute = Number(timePart.slice(2, 4))
  const second = Number(timePart.slice(4, 6))
  const runStartedAt = new Date(year, month, day, hour, minute, second)
  return {
    jobId,
    runStartedAt: Number.isNaN(runStartedAt.getTime()) ? null : runStartedAt,
  }
}

export function formatCronRunTitle(job: ClaudeJob | null, parts: CronSessionParts): string {
  const jobName = job ? job.name.trim() : ''
  const name = jobName || `Cron ${parts.jobId}`
  if (!parts.runStartedAt) return name
  const runLabel = parts.runStartedAt.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${name} — ${runLabel}`
}

export function getCronSessionSub(job: ClaudeJob | null, fallback: string | null): string | null {
  const prompt = job ? job.prompt.trim() : ''
  if (!prompt) return fallback
  return prompt.split(/\n+/)[0]?.trim() || fallback
}

// ── Source classifier ──────────────────────────────────────────────────────────

/**
 * Classify a gateway session entry into a SessionSource.
 *
 * Precedence (highest to lowest):
 *   1. telegram  → 'tg'
 *   2. recovered → 'recovered'
 *   3. cron source or cron_ key prefix → 'cron'
 *   4. api_server → 'api'
 *   4. isTaskTriggered heuristic → 'task'
 *      (`task` is a heuristic overlay that can ride on any source — including
 *      cli/a2a where kanban workers run. It MUST be checked before cli/a2a so
 *      task-triggered sessions are not stolen out of the Task chip.)
 *   6. cli  → 'cli'
 *   7. a2a_fleet → 'a2a'
 *   8. else → 'chat'
 */
export function classifySessionSource(
  source: string | null | undefined,
  key: string,
  isTaskTriggered: boolean,
  sessionKind?: string | null,
): SessionSource {
  if (source === 'telegram') return 'tg'
  if (source === 'recovered') return 'recovered'
  if (source === 'cron' || key.startsWith('cron_')) return 'cron'
  if (isTaskTriggered) return 'task'
  if (source === 'api_server' && sessionKind === 'chat') return 'chat'
  if (source === 'api_server') return 'api'
  if (source === 'cli') return 'cli'
  if (source === 'a2a_fleet') return 'a2a'
  return 'chat'
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

  // S4 perf: share the raw sessions fetch with the legacy chatQueryKeys.sessions
  // cache so only ONE /api/sessions network request is made. All mutation
  // optimistic-update helpers (rename, auto-title, upsert, reconcile, remove)
  // write to chatQueryKeys.sessions via setQueryData and now flow through here
  // automatically. The previous ['sessions-feed','chat','v3-task-split'] query
  // fetched /api/sessions independently — that duplicate is eliminated.
  const sessionsQuery = useQuery({
    queryKey: chatQueryKeys.sessions,
    queryFn: fetchSessions,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  // Cron-job enrichment is a separate lightweight fetch: only runs when cron
  // sessions are present in the list, and is completely independent of the
  // main /api/sessions payload.
  const rawSessions = sessionsQuery.data ?? []
  const cronJobIds = useMemo(() => {
    const ids = new Set<string>()
    for (const session of rawSessions) {
      const parts = parseCronSessionKey(session.key)
      if (parts) ids.add(parts.jobId)
    }
    return ids
  }, [rawSessions])

  const jobsQuery = useQuery({
    queryKey: ['sessions-feed', 'chat', 'cron-jobs', [...cronJobIds].sort()],
    queryFn: () => fetchJobs().catch(() => [] as Array<ClaudeJob>),
    enabled: cronJobIds.size > 0,
    staleTime: 60_000,
  })

  const jobs = jobsQuery.data ?? []

  const items = useMemo(() => {
    const sessions = filterSessionsWithTombstones(rawSessions)
    const nowMs = Date.now()
    return sessions.map((s): SessionFeedItem => {
      const when = s.updatedAt ?? 0
      const cronParts = parseCronSessionKey(s.key)
      const cronJob = cronParts ? findJobById(jobs, cronParts.jobId) : null
      const fallbackTitle = s.title ?? s.derivedTitle ?? s.label ?? s.key
      const fallbackSub = s.preview ?? null
      const rawTitle = cronParts
        ? formatCronRunTitle(cronJob, cronParts)
        : fallbackTitle
      const rawSub = cronParts
        ? getCronSessionSub(cronJob, fallbackSub)
        : fallbackSub
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
      // Prefer the authoritative gateway `source` field; fall back to key-prefix
      // heuristics for rows that predate source tagging.
      const kind = classifySessionSource(
        s.source,
        s.key,
        isTaskTriggered,
        s.kind,
      )
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
          cronJobId: cronParts?.jobId,
          cronJobName: cronJob?.name,
          originalTitle: fallbackTitle,
          originalPreview: fallbackSub,
        },
      }
    })
  }, [rawSessions, jobs])

  const queryHasData = items.length > 0 || sessionsQuery.isSuccess
  const effectiveAvailable = available || queryHasData

  return effectiveAvailable
    ? {
        src: 'chat',
        items,
        available: true,
        loading: sessionsQuery.isLoading,
        error: sessionsQuery.error,
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

function matchesDateRange(
  item: SessionFeedItem,
  from: string | null,
  to: string | null,
): boolean {
  if (!from && !to) return true
  const itemDate = item.when
  // Local-timezone day boundaries (not UTC). The picker emits YYYY-MM-DD in the
  // user's locale, so "June 15" must mean local June 15 00:00 → 23:59:59.999.
  // Was previously split across two passes with inconsistent UTC/local
  // predicates; unified here as the single owner (S5).
  if (from) {
    const [fy, fm, fd] = from.split('-').map(Number)
    const fromMs = new Date(fy, fm - 1, fd, 0, 0, 0, 0).getTime()
    if (Number.isFinite(fromMs) && itemDate < fromMs) return false
  }
  if (to) {
    const [ty, tm, td] = to.split('-').map(Number)
    const toMs = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime()
    if (Number.isFinite(toMs) && itemDate > toMs) return false
  }
  return true
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

const SOURCE_ORDER: Record<SessionSource, number> = {
  chat: 0,
  recovered: 1,
  task: 2,
  cron: 3,
  api: 4,
  cli: 5,
  a2a: 6,
  tool: 7,
  tg: 8,
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
      merged = merged.filter((item) => matchesSessionSearch(item, trimmedQuery))
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
