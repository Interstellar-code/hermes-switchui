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

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SESSION_LIST_LIMIT,
  chatQueryKeys,
  fetchListableSessions,
  fetchSessionWindow,
  searchSessions,
  updateSessionWindowPages,
} from './chat-queries'
import { normalizeSessions, readError } from './utils'
import { filterSessionsWithTombstones } from './session-tombstones'
import { matchesSessionSearch } from './session-search'
import type { SessionListResponse, SessionMeta, SessionSummary } from './types'
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
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
import { toast } from '@/components/ui/toast'
import { fetchJobs, findJobById } from '@/lib/jobs-api'
import { useChatStore } from '@/stores/chat-store'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import {
  UNSCOPED_PROFILE,
  activeScopeKey,
  activeScopeSegments,
  getSessionProfile,
  profileBody,
  readSendFailure,
} from '@/lib/session-scope'

/**
 * Sentinel profile: the gateway's current profile, read unscoped.
 *
 * An alias, not a second literal. This module and `lib/session-scope.ts` used
 * to spell `'active'` twice and keep them in lockstep by test; two spellings of
 * one value is a second source of truth by another name, and the failure mode
 * is silent — the feed browses the gateway's active profile while the resolver
 * believes a profile literally named `active` was selected. Re-exported so the
 * existing import sites keep working.
 */
export const ACTIVE_PROFILE = UNSCOPED_PROFILE

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
 * Invalidate every session list the sidebar can render.
 *
 * Unscoped, the V2 feed reads `chatQueryKeys.sessions` (shared with
 * `useChatSessions`). With a profile resolved it reads
 * `chatQueryKeys.scopedSessions(profile)` instead — invalidating only the
 * former left the scoped sidebar stale until its next 120s poll.
 */
export function invalidateSessionLists(
  queryClient: QueryClient,
  { refetchTotals = true }: { refetchTotals?: boolean } = {},
): void {
  void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
  // The sidebar's scoped-profile list (chatQueryKeys.scopedSessions) has its
  // own key; invalidate every profile's copy by prefix.
  void queryClient.invalidateQueries({
    queryKey: ['sessions-feed', 'scoped-chat'],
  })
  // Extra "Load more" pages: marked stale only. Refetching every loaded page
  // of every window on each mutation is the expensive part; they refresh when
  // next mounted/paged, and the base windows above carry the newest rows.
  void queryClient.invalidateQueries({
    queryKey: ['sessions-feed', 'window'],
    refetchType: 'none',
  })
  // Counts only change on delete (and create — which leaves them to the
  // 120s interval, since new chats arrive constantly).
  if (refetchTotals) {
    void queryClient.invalidateQueries({
      queryKey: ['sessions-feed', 'source-totals'],
    })
  }
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

// ── Backend flag-preserving list fetch ─────────────────────────────────────────

/** `SessionSummary` wire rows widened with the backend flag fields the
 * `archived=include` list carries (`normalizeSessions` drops unknown fields,
 * so flags are re-attached from the raw rows after normalizing). */
type FlagSummaryRow = SessionSummary & {
  archived?: boolean | number
  pinned?: boolean | number
}

export type FeedSessionMeta = SessionMeta & {
  archived?: boolean
  pinned?: boolean
}

function attachSessionFlags(
  rows: Array<SessionMeta>,
  raw: Array<SessionSummary> | undefined,
): Array<FeedSessionMeta> {
  if (!Array.isArray(raw)) return rows
  const flagsByKey = new Map<string, { archived?: boolean; pinned?: boolean }>()
  for (const row of raw as Array<FlagSummaryRow>) {
    if (typeof row.key !== 'string' || row.key === '') continue
    flagsByKey.set(row.key, {
      archived: row.archived === true || row.archived === 1,
      pinned: row.pinned === true || row.pinned === 1,
    })
  }
  return rows.map((row) => ({ ...row, ...flagsByKey.get(row.key) }))
}

async function fetchSessionWindowWithFlags(
  filter: Record<string, string>,
  profile: string | null | undefined,
  offset = 0,
): Promise<Array<FeedSessionMeta>> {
  const query = new URLSearchParams({
    limit: String(DEFAULT_SESSION_LIST_LIMIT),
    offset: String(offset),
    // Backend-archived rows ride along; the default view filters them out
    // client-side (item.state === 'archived') and the Archived view shows them.
    archived: 'include',
    ...filter,
  })
  if (profile) query.set('profile', profile)
  const res = await fetch(`/api/sessions?${query.toString()}`)
  if (!res.ok) {
    const error = new Error(await readError(res)) as Error & {
      status?: number
    }
    error.status = res.status
    throw error
  }
  const data = (await res.json()) as SessionListResponse
  return attachSessionFlags(normalizeSessions(data.sessions), data.sessions)
}

async function fetchSessionWindowsWithFlags(
  profile: string | null | undefined,
): Promise<Array<FeedSessionMeta>> {
  const [recents, cron] = await Promise.all([
    fetchSessionWindowWithFlags({ exclude_sources: 'cron' }, profile),
    fetchSessionWindowWithFlags({ source: 'cron' }, profile),
  ])
  const seen = new Set<string>()
  return [...recents, ...cron]
    .filter((session) => {
      if (seen.has(session.key)) return false
      seen.add(session.key)
      return true
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/** `fetchSessions`, but the rows keep the backend `archived`/`pinned` flags.
 * Same cache key and wire shape — a superset of `fetchSessions`' rows. */
export async function fetchSessionsWithFlags(): Promise<
  Array<FeedSessionMeta>
> {
  return fetchSessionWindowsWithFlags(getSessionProfile())
}

/** `fetchProfileSessions`, likewise keeping the backend flags. */
export async function fetchProfileSessionsWithFlags(
  profile: string,
): Promise<Array<FeedSessionMeta>> {
  return fetchSessionWindowsWithFlags(profile)
}

// ── Backend flag mutation (archive / pin) ──────────────────────────────────────

export type SessionFlagsPayload = {
  sessionKey: string
  friendlyId?: string | null
} & Partial<{ archived: boolean; pinned: boolean }>

/**
 * PATCH `archived` / `pinned` onto a backend session row, with the same
 * optimistic-cache contract as `useRenameSession`: the shared
 * `chatQueryKeys.sessions` rows flip immediately, roll back on failure, and
 * every session list refetches on success.
 */
export function useUpdateSessionFlags() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async function patchSessionFlags(payload: SessionFlagsPayload) {
      const res = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: payload.sessionKey,
          friendlyId: payload.friendlyId ?? undefined,
          ...('archived' in payload ? { archived: payload.archived } : {}),
          ...('pinned' in payload ? { pinned: payload.pinned } : {}),
          ...profileBody(),
        }),
      })
      if (!res.ok) throw new Error(await readSendFailure(res))
      return payload
    },
    onMutate: async function optimisticFlags(payload) {
      await queryClient.cancelQueries({ queryKey: chatQueryKeys.sessions })
      const previousSessions = queryClient.getQueryData(chatQueryKeys.sessions)
      const previousScoped = queryClient.getQueryData(
        chatQueryKeys.scopedSessions(getSessionProfile() ?? UNSCOPED_PROFILE),
      )

      const targetId = payload.friendlyId || payload.sessionKey
      const update = function update(sessions: unknown) {
        if (!Array.isArray(sessions)) return sessions
        return (sessions as Array<Record<string, unknown>>).map((session) => {
          const key = typeof session.key === 'string' ? session.key : ''
          const friendlyId =
            typeof session.friendlyId === 'string' ? session.friendlyId : ''
          if (key !== payload.sessionKey && friendlyId !== targetId)
            return session
          return {
            ...session,
            ...('archived' in payload ? { archived: payload.archived } : {}),
            ...('pinned' in payload ? { pinned: payload.pinned } : {}),
          }
        })
      }
      queryClient.setQueryData(chatQueryKeys.sessions, update)
      const profile = getSessionProfile()
      if (profile) {
        queryClient.setQueryData(chatQueryKeys.scopedSessions(profile), update)
      }
      updateSessionWindowPages(queryClient, update)

      return { previousSessions, previousScoped }
    },
    onError: function rollbackFlags(err, _payload, context) {
      if (context?.previousSessions) {
        queryClient.setQueryData(
          chatQueryKeys.sessions,
          context.previousSessions,
        )
      }
      if (context?.previousScoped) {
        queryClient.setQueryData(
          chatQueryKeys.scopedSessions(getSessionProfile() ?? UNSCOPED_PROFILE),
          context.previousScoped,
        )
      }
      const msg = err instanceof Error ? err.message : String(err)
      toast(`Couldn't update session: ${msg}`, { type: 'error' })
    },
    onSuccess: function refreshLists() {
      invalidateSessionLists(queryClient)
    },
  })

  return {
    updateSessionFlags: mutation.mutateAsync,
    flagsPending: mutation.isPending,
  }
}

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
    queryFn: fetchSessionsWithFlags,
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
export function useScopedChatSessionsFeed(
  profile: string,
): SessionSourceResult {
  const scoped = Boolean(profile) && profile !== ACTIVE_PROFILE
  const waitingSessionKeys = useChatStore((s) => s.waitingSessionKeys)

  const scopedQuery = useQuery({
    queryKey: chatQueryKeys.scopedSessions(profile),
    queryFn: () => fetchProfileSessionsWithFlags(profile),
    enabled: scoped,
    staleTime: 60_000,
    refetchInterval: scoped ? 120_000 : false,
  })

  const items = useMemo(
    () => sessionsToFeedItems(scopedQuery.data ?? [], [], waitingSessionKeys),
    [scopedQuery.data, waitingSessionKeys],
  )

  if (!scoped) {
    return {
      src: 'chat',
      items: [],
      available: false,
      loading: false,
      error: null,
    }
  }
  return {
    src: 'chat',
    items,
    available: true,
    loading: scopedQuery.isLoading,
    error: scopedQuery.error,
  }
}

export function sessionsToFeedItems(
  rawSessions: Array<FeedSessionMeta>,
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
    const backendArchived = s.archived === true
    const live =
      !backendArchived &&
      (Boolean(s.isActive) ||
        waitingSessionKeys.has(activeScopeKey(s.key)) ||
        waitingSessionKeys.has(activeScopeKey(s.friendlyId)))
    return {
      id: makeId('chat', s.key),
      src: kind,
      title: rawTitle,
      sub: rawSub,
      tokens: s.tokenCount ?? s.totalTokens ?? null,
      when,
      day: getDayBucket(when, nowMs),
      live,
      state: backendArchived ? 'archived' : live ? 'live' : 'idle',
      badges: [],
      pinned: s.pinned === true,
      starred: false,
      archived: backendArchived,
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
        serverSource: s.source,
      },
    }
  })
}

// ── Server-side source totals + extra list pages ──────────────────────────────

/**
 * Chips each server `source` can classify into (`classifySessionSource`). The
 * FIRST entry is where rows not yet loaded are counted: which chip an unloaded
 * row would land in is unknowable (api_server splits chat/api by `kind`, task
 * is a title heuristic), so loaded rows count exactly and only the remainder
 * is attributed. Unlisted sources (local, new adapters) behave like `kanban`.
 */
export const SERVER_SOURCE_CHIPS: Record<string, Array<SessionSource>> = {
  cron: ['cron'],
  api_server: ['chat', 'api', 'task'],
  telegram: ['tg'],
  a2a_fleet: ['a2a', 'task'],
  cli: ['cli', 'task'],
  recovered: ['recovered'],
  kanban: ['chat', 'task'],
}
const OTHER_SOURCE_CHIPS: Array<SessionSource> = ['chat', 'task']

export type SessionSourceTotals = {
  total: number
  bySource: Record<string, number>
}

async function fetchSourceTotals(
  profile: string | null,
): Promise<SessionSourceTotals | null> {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  try {
    const res = await fetch(`/api/sessions/source-totals${query}`)
    if (!res.ok) return null
    const data = (await res.json()) as { totals?: SessionSourceTotals | null }
    return data.totals ?? null
  } catch {
    return null
  }
}

/**
 * Real per-server-source session counts for `profile` (null = active, read
 * unscoped). `null` when the server cannot count (no dashboard) — callers
 * fall back to counting loaded rows.
 */
export function useSessionSourceTotals(
  profile: string | null,
): SessionSourceTotals | null {
  const query = useQuery({
    queryKey: ['sessions-feed', 'source-totals', profile ?? ACTIVE_PROFILE],
    queryFn: () => fetchSourceTotals(profile),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
  return query.data ?? null
}

function serverSourceOf(item: SessionFeedItem): string {
  const source = item.sourceMeta.serverSource
  return typeof source === 'string' ? source : ''
}

/**
 * Loaded vs server total for the server sources still on screen — a server
 * source counts while ANY chip it can classify into is visible (hiding CHAT
 * keeps api_server in play for API/TASK). `items` = every loaded row,
 * archived included, to compare like for like with the server total.
 */
export function visibleSourceProgress(
  items: Array<SessionFeedItem>,
  totals: SessionSourceTotals,
  hidden: Array<SessionSource>,
): { loaded: number; total: number } {
  const visible = (source: string) =>
    (SERVER_SOURCE_CHIPS[source] ?? OTHER_SOURCE_CHIPS).some(
      (chip) => !hidden.includes(chip),
    )
  let known = 0
  let total = 0
  for (const [source, n] of Object.entries(totals.bySource)) {
    known += n
    if (visible(source)) total += n
  }
  // Sources the server did not break out ('other') map like OTHER_SOURCE_CHIPS.
  if (visible('')) total += Math.max(0, totals.total - known)
  const loaded = items.filter((item) => visible(serverSourceOf(item))).length
  return { loaded, total }
}

/**
 * Chip counts with the rows the list has NOT loaded added back from the server
 * totals. `sourceCounts` (loaded, filtered) stays exact for what is loaded;
 * per server source, `total - loaded` is attributed to its primary chip.
 *
 * `items` must be every loaded row (archived included): the server total counts
 * locally-archived sessions too, so subtracting them keeps the remainder right.
 * Archived rows that were never loaded can't be known — chips may overcount by
 * that many until they load. Only valid with no count-affecting filter active.
 */
export function addUnloadedSourceCounts(
  sourceCounts: Partial<Record<SessionSource, number>>,
  items: Array<SessionFeedItem>,
  totals: SessionSourceTotals | null,
): Partial<Record<SessionSource, number>> {
  if (!totals) return sourceCounts
  const loaded = new Map<string, number>()
  for (const item of items) {
    const source = serverSourceOf(item)
    loaded.set(source, (loaded.get(source) ?? 0) + 1)
  }
  const next = { ...sourceCounts }
  const add = (chip: SessionSource, n: number) => {
    if (n > 0) next[chip] = (next[chip] ?? 0) + n
  }
  let known = 0
  let loadedKnown = 0
  for (const [source, total] of Object.entries(totals.bySource)) {
    known += total
    loadedKnown += loaded.get(source) ?? 0
    add(
      (SERVER_SOURCE_CHIPS[source] ?? OTHER_SOURCE_CHIPS)[0],
      total - (loaded.get(source) ?? 0),
    )
  }
  add(
    OTHER_SOURCE_CHIPS[0],
    totals.total - known - (items.length - loadedKnown),
  )
  return next
}

/**
 * Server filter for the extra-pages window given the hidden chips. Nothing
 * hidden = the non-cron recents window, continuing after the first page the
 * base feed already holds. Otherwise exclude every server source whose chips
 * are ALL hidden, so a narrowed selection (e.g. only CLI visible) pages
 * through exactly the sources still shown.
 */
export function sessionWindowFilter(hidden: ReadonlyArray<SessionSource>): {
  filter: Record<string, string>
  filterKey: string
  startOffset: number
} {
  const excluded =
    hidden.length === 0
      ? ['cron']
      : Object.entries(SERVER_SOURCE_CHIPS)
          .filter(([, chips]) => chips.every((chip) => hidden.includes(chip)))
          .map(([source]) => source)
  const filter: Record<string, string> =
    excluded.length > 0 ? { exclude_sources: excluded.join(',') } : {}
  const filterKey = new URLSearchParams(filter).toString()
  return {
    filter,
    filterKey,
    // The base feed (newest 200 non-cron + newest 200 cron) already holds the
    // newest 200 of both of these, so their first page would be a no-op.
    startOffset:
      filterKey === 'exclude_sources=cron' || filterKey === ''
        ? DEFAULT_SESSION_LIST_LIMIT
        : 0,
  }
}

/**
 * Extra list pages for the sidebar: "Load more" beyond the first window, and
 * — when `autoLoad` (a narrowed source selection with unloaded rows) — the
 * first page of the narrowed window right away. Rows are returned as feed
 * items; the caller merges them under the base feed (base wins on duplicates,
 * so optimistic renames in the base cache are not overwritten).
 */
export function useSessionWindowPages(
  profile: string | null,
  hidden: ReadonlyArray<SessionSource>,
  autoLoad: boolean,
): {
  items: Array<SessionFeedItem>
  hasMore: boolean
  loading: boolean
  loadMore: () => void
} {
  const waitingSessionKeys = useChatStore((s) => s.waitingSessionKeys)
  const { filter, filterKey, startOffset } = sessionWindowFilter(hidden)
  const pageSize = DEFAULT_SESSION_LIST_LIMIT
  const queryKey = chatQueryKeys.sessionWindow(
    profile ?? ACTIVE_PROFILE,
    filterKey,
  )
  const keyString = queryKey.join('|')
  const [requested, setRequested] = useState<string | null>(null)
  // ponytail: offset paging — a session created/deleted between pages shifts
  // the window, so a row can repeat (deduped) or be skipped until refetch.
  // Switch to a keyset cursor (updatedAt, id) if those gaps start to matter.
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchSessionWindow(filter, profile, pageParam),
    initialPageParam: startOffset,
    getNextPageParam: (last, _all, lastOffset) =>
      last.length < pageSize ? undefined : lastOffset + pageSize,
    getPreviousPageParam: (_first, _all, firstOffset) =>
      firstOffset > startOffset ? firstOffset - pageSize : undefined,
    // Bounds memory and refetch cost; the oldest page drops past 10.
    maxPages: 10,
    enabled: autoLoad || requested === keyString,
    staleTime: 60_000,
    // Old pages change rarely (new rows land in the base windows, polled every
    // 2 min); a slow refresh keeps titles/deletes from elsewhere eventually
    // consistent without refetching up to 10 pages every couple of minutes.
    refetchInterval: 10 * 60_000,
  })
  const rawRows = useMemo(() => query.data?.pages.flat() ?? [], [query.data])
  // Cron-run titles come from the jobs list, which is active-profile scoped —
  // enrich only unscoped, same as the base feeds.
  const hasCronRows =
    profile === null && rawRows.some((row) => parseCronSessionKey(row.key))
  const jobsQuery = useQuery({
    queryKey: [...sessionsFeedKey(), 'cron-jobs', 'window'],
    queryFn: () => fetchJobs().catch(() => [] as Array<ClaudeJob>),
    enabled: hasCronRows,
    staleTime: 60_000,
  })
  const jobs = jobsQuery.data
  const items = useMemo(() => {
    const now = Date.now()
    return sessionsToFeedItems(rawRows, jobs ?? [], waitingSessionKeys).map(
      (item) => ({ ...item, day: getDayBucket(item.when, now) }),
    )
  }, [rawRows, jobs, waitingSessionKeys])
  return {
    items,
    // Before the first extra page there is no evidence either way.
    hasMore: query.data ? query.hasNextPage : true,
    loading: query.isFetching,
    loadMore: () => {
      if (query.isFetching) return
      if (query.data) void query.fetchNextPage()
      else setRequested(keyString)
    },
  }
}

/** Most session rows one folder "load" click fetches. */
export const FOLDER_LOAD_CAP = 100

type FolderLoadState = {
  signal: string
  tried: ReadonlySet<string>
  exhausted: ReadonlySet<string>
  failed: ReadonlySet<string>
}

const withAdded = (set: ReadonlySet<string>, value: string) =>
  new Set(set).add(value)
const without = (set: ReadonlySet<string>, value: string) => {
  const next = new Set(set)
  next.delete(value)
  return next
}

/**
 * Per-folder "load the rest": fetches a folder's missing listable sessions by
 * id (`/api/sessions/listable`, ≤100 per click) and parks them as pages of ONE
 * window-pages entry (`sessionWindow(profile, 'folders')`), so the rename /
 * delete / invalidate helpers that walk `['sessions-feed','window',profile]`
 * cover them too.
 *
 * `signal` must change whenever the folder map's content does (and include the
 * profile): ids tried and folders exhausted are remembered per signal. A folder
 * is exhausted once its last untried ids came back with nothing new. A failed
 * request records nothing — the folder stays loadable and is reported in
 * `failed` so the UI can offer a retry.
 */
export function useFolderPages(
  profile: string | null,
  signal: string,
): {
  items: Array<SessionFeedItem>
  loading: ReadonlySet<string>
  exhausted: ReadonlySet<string>
  failed: ReadonlySet<string>
  load: (projectId: string, missingIds: Array<string>) => void
} {
  const queryClient = useQueryClient()
  const waitingSessionKeys = useChatStore((s) => s.waitingSessionKeys)
  const pageProfile = profile ?? ACTIVE_PROFILE
  const queryKey = useMemo(
    () => chatQueryKeys.sessionWindow(pageProfile, 'folders'),
    [pageProfile],
  )
  // Cache-only: pages are written by `load`, never fetched by this query.
  const query = useQuery<InfiniteData<Array<SessionMeta>>>({
    queryKey,
    queryFn: () =>
      queryClient.getQueryData<InfiniteData<Array<SessionMeta>>>(queryKey) ?? {
        pages: [],
        pageParams: [],
      },
    enabled: false,
    staleTime: Infinity,
  })
  const fresh = useMemo(
    (): FolderLoadState => ({
      signal,
      tried: new Set(),
      exhausted: new Set(),
      failed: new Set(),
    }),
    [signal],
  )
  const [state, setState] = useState<FolderLoadState>(fresh)
  const current = state.signal === signal ? state : fresh
  const currentRef = useRef(current)
  currentRef.current = current
  const inFlight = useRef(new Set<string>())
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(
    (projectId: string, missingIds: Array<string>) => {
      if (inFlight.current.has(projectId)) return
      const untried = missingIds.filter(
        (id) => !currentRef.current.tried.has(id),
      )
      const batch = untried.slice(0, FOLDER_LOAD_CAP)
      const update = (fn: (prev: FolderLoadState) => FolderLoadState) =>
        setState((prev) => fn(prev.signal === signal ? prev : fresh))
      const done = (rows: Array<SessionMeta>) => {
        update((prev) => ({
          ...prev,
          tried: new Set([...prev.tried, ...batch]),
          exhausted:
            rows.length === 0 && untried.length === batch.length
              ? withAdded(prev.exhausted, projectId)
              : prev.exhausted,
          failed: without(prev.failed, projectId),
        }))
        if (rows.length > 0)
          queryClient.setQueryData<InfiniteData<Array<SessionMeta>>>(
            queryKey,
            (data) => ({
              pages: [...(data?.pages ?? []), rows],
              pageParams: [...(data?.pageParams ?? []), projectId],
            }),
          )
      }
      if (batch.length === 0) return done([])
      inFlight.current.add(projectId)
      setLoading((prev) => withAdded(prev, projectId))
      void fetchListableSessions(batch, profile)
        .then(done, () =>
          update((prev) => ({
            ...prev,
            failed: withAdded(prev.failed, projectId),
          })),
        )
        .finally(() => {
          inFlight.current.delete(projectId)
          setLoading((prev) => without(prev, projectId))
        })
    },
    [signal, fresh, profile, queryClient, queryKey],
  )

  const items = useMemo(
    () =>
      sessionsToFeedItems(
        query.data?.pages.flat() ?? [],
        [],
        waitingSessionKeys,
      ),
    [query.data, waitingSessionKeys],
  )
  return useMemo(
    () => ({
      items,
      loading,
      exhausted: current.exhausted,
      failed: current.failed,
      load,
    }),
    [items, loading, current.exhausted, current.failed, load],
  )
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
  // The RESOLVED profile (`url ?? device ?? null`), never the raw device layer.
  // Reading the store field directly is how the list and the composer came to
  // disagree: a tab pinned by `?profile=neo` sends to neo — every write body
  // spreads `profileBody()`, which reads the same resolver — while the sidebar
  // went on listing whatever this device last picked. Same resolver on both
  // sides means the header, the list and the send target cannot drift.
  const profile = useResolvedProfile()
  const unscoped = profile === null

  // Both hooks always run (hooks cannot be conditional); the inactive one is
  // gated off by `enabled` so only one of them polls.
  const chat = useChatSessionsFeed(unscoped)
  const scopedChat = useScopedChatSessionsFeed(profile ?? UNSCOPED_PROFILE)
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
