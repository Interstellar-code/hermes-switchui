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
import {
  chatQueryKeys,
  fetchProfileSessions,
  fetchSessions,
  searchSessions,
} from './chat-queries'
import { filterSessionsWithTombstones } from './session-tombstones'
import { matchesSessionSearch } from './session-search'
import type { SessionMeta } from './types'
import type { QueryClient } from '@tanstack/react-query'
import type { ClaudeJob } from '@/lib/jobs-api'
import type {
  SessionDayBucket,
  SessionFeedItem,
  SessionFeedSort,
  SessionSource,
  SessionSourceResult,
  SessionsFeedOptions,
  SessionsFeedResult,
} from './sessions-feed-types'
import { fetchJobs, findJobById } from '@/lib/jobs-api'
import { useChatStore } from '@/stores/chat-store'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import { activeScopeKey, activeScopeSegments } from '@/lib/session-scope'

/** Sentinel profile: the gateway's current profile, read unscoped. */
export const ACTIVE_PROFILE = 'active'

// ── Capability accessor ────────────────────────────────────────────────────────
// We read capabilities from the /api/connection-status endpoint (already used
// in the app). Capabilities are treated as stable across the life of the page;
// re-probe happens on window focus + manual refresh (Phase 2/3).

type CapabilityMap = {
  sessions: boolean
  jobs: boolean
  kanban: boolean
  memory: boolean
  dashboard: boolean
}

async function fetchCapabilities(): Promise<CapabilityMap> {
  try {
    const res = await fetch('/api/connection-status')
    if (!res.ok)
      return {
        sessions: false,
        jobs: false,
        kanban: false,
        memory: false,
        dashboard: false,
      }
    const data = (await res.json()) as {
      capabilities?: Partial<CapabilityMap>
      sessions?: boolean
      jobs?: boolean
      kanban?: boolean
      memory?: boolean
      dashboard?: boolean
    }
    const caps = data.capabilities ?? data
    return {
      sessions: Boolean(caps.sessions),
      jobs: Boolean(caps.jobs),
      kanban: Boolean(caps.kanban),
      // memory capability is always true in the gateway (reads filesystem)
      memory: caps.memory !== false,
      dashboard: Boolean(caps.dashboard),
    }
  } catch {
    return {
      sessions: false,
      jobs: false,
      kanban: false,
      memory: false,
      dashboard: false,
    }
  }
}

// Gateway capability probe — profile-agnostic by design (P0A §3.2 row 27).
const CAPABILITIES_QUERY_KEY = ['sessions-feed', 'capabilities'] as const

/**
 * Retained for mutations (e.g. tombstone-based delete) that need to invalidate
 * the V2 sidebar feed independently. The sub-key `['sessions-feed','chat']`
 * matches the cron-jobs query prefix so a single invalidate clears it too.
 */
export function sessionsFeedKey(): Array<unknown> {
  return ['sessions-feed', 'chat', ...activeScopeSegments()]
}

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

export function formatCronRunTitle(
  job: ClaudeJob | null,
  parts: CronSessionParts,
): string {
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

export function getCronSessionSub(
  job: ClaudeJob | null,
  fallback: string | null,
): string | null {
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

export function findSessionSource(
  items: Array<SessionFeedItem>,
  candidates: Array<string | null | undefined>,
): SessionSource | undefined {
  const ids = new Set(candidates.filter(Boolean))
  return items.find((item) => {
    const rawId = item.id.split(':').slice(1).join(':')
    return ids.has(rawId) || ids.has(String(item.sourceMeta.friendlyId ?? ''))
  })?.src
}

// ── State normalization ────────────────────────────────────────────────────────

// ── Chat source hook ───────────────────────────────────────────────────────────

/** Hook for chat sessions.
 *
 * `/api/sessions` is the source of truth. Do not gate this query only on
 * `/api/connection-status`: that endpoint is a coarse capability snapshot and
 * can be stale during gateway/dashboard restarts, leaving the sidebar stuck at
 * "0" even while `/api/sessions` is healthy.
 *
 * `enabled` is false only while the sidebar is browsing a FOREIGN profile —
 * that read goes through `useScopedChatSessionsFeed` instead, and polling the
 * active profile's list in the background would be pointless traffic. Defaults
 * to true, so the unscoped path is byte-identical.
 */
export function useChatSessionsFeed(enabled = true): SessionSourceResult {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })

  const available = capsQuery.data?.sessions ?? false
  const waitingSessionKeys = useChatStore((s) => s.waitingSessionKeys)

  // S4 perf: share the raw sessions fetch with the legacy chatQueryKeys.sessions
  // cache so only ONE /api/sessions network request is made. All mutation
  // optimistic-update helpers (rename, auto-title, upsert, reconcile, remove)
  // write to chatQueryKeys.sessions via setQueryData and now flow through here
  // automatically. The previous ['sessions-feed','chat','v3-task-split'] query
  // fetched /api/sessions independently — that duplicate is eliminated.
  const sessionsQuery = useQuery({
    queryKey: chatQueryKeys.sessions,
    queryFn: fetchSessions,
    staleTime: 60_000,
    refetchInterval: enabled ? 120_000 : false,
    enabled,
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
    queryKey: [...sessionsFeedKey(), 'cron-jobs', [...cronJobIds].sort()],
    queryFn: () => fetchJobs().catch(() => [] as Array<ClaudeJob>),
    enabled: cronJobIds.size > 0,
    staleTime: 60_000,
  })

  const jobs = jobsQuery.data ?? []

  const items = useMemo(
    () => sessionsToFeedItems(rawSessions, jobs, waitingSessionKeys),
    [rawSessions, jobs, waitingSessionKeys],
  )

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

/**
 * Chat sessions of ONE named profile, for the sidebar's profile browse.
 *
 * Deliberately NOT `chatQueryKeys.sessions`. That key is the active profile's
 * list and every mutation helper (rename, auto-title, upsert, reconcile,
 * remove) writes into it via `setQueryData`; parking another profile's rows
 * there would let those helpers mutate foreign-profile data. This owns a
 * separate key and never touches the shared cache.
 *
 * Returns `available: true` while scoped even on error, so a failed or
 * degraded profile surfaces through `result.sources` instead of rendering as
 * an empty list — an empty list reads as "no sessions", which is the same lie
 * as a silent zero.
 *
 * Cron-job enrichment is skipped: the jobs endpoint is active-profile scoped,
 * so cross-profile cron runs keep their raw key-derived title.
 */
export function useScopedChatSessionsFeed(profile: string): SessionSourceResult {
  const scoped = Boolean(profile) && profile !== ACTIVE_PROFILE
  const waitingSessionKeys = useChatStore((s) => s.waitingSessionKeys)

  const scopedQuery = useQuery({
    queryKey: ['sessions-feed', 'scoped-chat', profile],
    queryFn: () => fetchProfileSessions(profile),
    enabled: scoped,
    staleTime: 60_000,
    refetchInterval: scoped ? 120_000 : false,
  })

  const items = useMemo(
    () => sessionsToFeedItems(scopedQuery.data ?? [], [], waitingSessionKeys),
    [scopedQuery.data, waitingSessionKeys],
  )

  if (!scoped) {
    return { src: 'chat', items: [], available: false, loading: false, error: null }
  }
  return {
    src: 'chat',
    items,
    available: true,
    loading: scopedQuery.isLoading,
    error: scopedQuery.error,
  }
}

function sessionsToFeedItems(
  rawSessions: Array<SessionMeta>,
  jobs: Array<ClaudeJob>,
  waitingSessionKeys: Set<string>,
): Array<SessionFeedItem> {
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
    const titleLower = (s.title ?? s.derivedTitle ?? '').toLowerCase()
    const previewLower = (s.preview ?? '').toLowerCase()
    const isTaskTriggered =
      titleLower.startsWith('work kanban task ') ||
      previewLower.startsWith('work kanban task ')
    const kind = classifySessionSource(s.source, s.key, isTaskTriggered, s.kind)
    const live =
      Boolean(s.isActive) ||
      waitingSessionKeys.has(activeScopeKey(s.key)) ||
      waitingSessionKeys.has(activeScopeKey(s.friendlyId))
    return {
      id: makeId('chat', s.key),
      src: kind,
      title: rawTitle,
      sub: rawSub,
      tokens: s.tokenCount ?? s.totalTokens ?? null,
      when,
      day: getDayBucket(when, nowMs),
      live,
      state: live ? 'live' : 'idle',
      badges: [],
      pinned: false,
      starred: false,
      archived: false,
      sourceMeta: {
        key: s.key,
        friendlyId: s.friendlyId,
        titleStatus: s.titleStatus,
        lastMessage: s.lastMessage,
        kind,
        model: s.model,
        messageCount: s.messageCount,
        toolCallCount: s.toolCallCount,
        cronJobId: cronParts?.jobId,
        cronJobName: cronJob?.name,
        originalTitle: fallbackTitle,
        originalPreview: fallbackSub,
        profile: s.profile,
      },
    }
  })
}

// ── Cross-profile browse totals (P3 sidebar lane) ─────────────────────────────

/** One row of the profile-browse summary: name, session count, and — for
 * profiles with a drifted `state.db` schema — the upstream error string.
 * `error` set means `count` is NOT trustworthy (the dashboard could not
 * compute it) and must render as a degraded row, never as `0`. */
export type ProfileTotalRow = {
  profile: string
  count: number
  error: string | null
}

type ProfileTotalsPayload = {
  profile_totals?: Record<string, number>
  errors?: Array<{ profile: string; error: string }>
}

async function fetchProfileTotals(): Promise<ProfileTotalsPayload> {
  try {
    const res = await fetch('/api/sessions?profile=all&limit=1')
    if (!res.ok) return {}
    return (await res.json()) as ProfileTotalsPayload
  } catch {
    return {}
  }
}

/**
 * Cross-profile session totals for the sidebar's profile-browse row.
 *
 * Read-only, informational — requires the dashboard capability (§1.5:
 * cross-profile browsing goes through the dashboard's `/api/profiles/sessions`
 * aggregation, not the gateway multiplex prefix). Disabled entirely when the
 * dashboard isn't available, so single-gateway installs never issue this
 * request — unscoped behaviour stays byte-identical.
 */
export function useProfileSessionTotals(): {
  totals: Array<ProfileTotalRow>
  loading: boolean
} {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })
  const dashboardAvailable = capsQuery.data?.dashboard ?? false

  const totalsQuery = useQuery({
    queryKey: ['sessions-feed', 'profile-totals'],
    queryFn: fetchProfileTotals,
    enabled: dashboardAvailable,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const totals = useMemo(() => {
    const data = totalsQuery.data
    if (!data) return []
    const errorByProfile = new Map(
      (data.errors ?? []).map((e) => [e.profile, e.error]),
    )
    const names = new Set([
      ...Object.keys(data.profile_totals ?? {}),
      ...errorByProfile.keys(),
    ])
    return [...names]
      .map(
        (profile): ProfileTotalRow => ({
          profile,
          count: data.profile_totals?.[profile] ?? 0,
          error: errorByProfile.get(profile) ?? null,
        }),
      )
      .sort((a, b) => a.profile.localeCompare(b.profile))
  }, [totalsQuery.data])

  return { totals, loading: dashboardAvailable && totalsQuery.isLoading }
}

export function mergeSessionFeedItems(
  current: Array<SessionFeedItem>,
  incoming: Array<SessionFeedItem>,
): Array<SessionFeedItem> {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
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
    raw = false,
    sources: requestedSources,
    state: stateFilter = 'all',
    query = '',
    dateRange,
    sort = 'recent',
  } = options
  const waitingSessionKeys = useChatStore((s) => s.waitingSessionKeys)
  const profile = useSessionsFilterStore((s) => s.profile)
  const unscoped = !profile || profile === ACTIVE_PROFILE

  // Both hooks always run (hooks cannot be conditional); the inactive one is
  // gated off by `enabled` so only one of them polls.
  const chat = useChatSessionsFeed(unscoped)
  const scopedChat = useScopedChatSessionsFeed(unscoped ? ACTIVE_PROFILE : profile)
  const tool = useToolSessionsFeed()
  const tg = useTelegramSessionsFeed()
  const remoteSearchQuery = useQuery({
    queryKey: [
      'sessions-feed',
      'search',
      ...activeScopeSegments(),
      query.trim(),
    ],
    // Remote search is active-profile scoped (`searchSessions` reads the URL
    // scope, not this filter), so merging its hits while browsing a foreign
    // profile would leak the active profile's sessions into the list.
    enabled: query.trim().length >= 2 && unscoped,
    queryFn: () => searchSessions(query.trim()),
    staleTime: 60_000,
  })
  const remoteSearchItems = useMemo(
    () =>
      sessionsToFeedItems(remoteSearchQuery.data ?? [], [], waitingSessionKeys),
    [remoteSearchQuery.data, waitingSessionKeys],
  )
  // cron/task/memory removed from sidebar:
  //   - cron-generated chat sessions appear directly in chat source.
  //   - tasks moved to a dedicated chat-header tab (see chat-source-tabs-v2).
  //   - memory removed entirely from chat sidebar.
  const chatSource = unscoped ? chat : scopedChat
  const allSources: Array<SessionSourceResult> = [chatSource, tool, tg]

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

    if (remoteSearchItems.length > 0) {
      merged = mergeSessionFeedItems(merged, remoteSearchItems)
    }

    if (raw) {
      return {
        items: merged,
        sources: allSources,
        loading: allSources.some((s) => s.available && s.loading),
      }
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
    chatSource.items,
    chatSource.available,
    chatSource.loading,
    tool.available,
    tg.available,
    remoteSearchItems,
    raw,
    requestedSources,
    stateFilter,
    query,
    dateRange,
    sort,
  ])

  return result
}
