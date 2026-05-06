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
import { fetchJobs } from '@/lib/jobs-api'
import { fetchTasks } from '@/lib/tasks-api'

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
    if (!res.ok) return { sessions: false, jobs: false, kanban: false, memory: false }
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
  const locale = typeof navigator !== 'undefined' ? navigator.language : undefined
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
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

function normalizeCronState(state: string | undefined): SessionState {
  const s = (state ?? '').trim().toLowerCase()
  if (s === 'running' || s === 'active') return 'live'
  if (s === 'scheduled' || s === 'enabled' || s === 'idle' || s === 'waiting' || s === 'paused') return 'idle'
  if (s === 'completed' || s === 'complete' || s === 'succeeded' || s === 'success' || s === 'done' || s === 'finished') return 'complete'
  if (s === 'failed' || s === 'error' || s === 'errored' || s === 'cancelled' || s === 'canceled' || s === 'aborted') return 'error'
  if (s === 'archived') return 'archived'
  return 'unknown'
}

function normalizeKanbanState(status: string | undefined): SessionState {
  const s = (status ?? '').trim().toLowerCase()
  if (s === 'running') return 'live'
  if (s === 'triage' || s === 'todo' || s === 'ready' || s === 'blocked') return 'idle'
  if (s === 'done') return 'complete'
  if (s === 'archived') return 'archived'
  return 'unknown'
}

// ── Chat source hook ───────────────────────────────────────────────────────────

/** Hook for chat sessions. Gated by `capabilities.sessions`. */
export function useChatSessionsFeed(): SessionSourceResult {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })

  const available = capsQuery.data?.sessions ?? false

  const query = useQuery({
    queryKey: ['sessions-feed', 'chat'],
    queryFn: async () => {
      const sessions = await fetchSessions()
      const nowMs = Date.now()
      return sessions.map((s): SessionFeedItem => {
        const when = s.updatedAt ?? 0
        const rawTitle = s.title ?? s.derivedTitle ?? s.label ?? s.key
        const rawSub = s.preview ?? null
        const badges: Array<SessionBadge> = []
        return {
          id: makeId('chat', s.key),
          src: 'chat',
          title: rawTitle,
          sub: rawSub,
          tokens: null,
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
          },
        }
      })
    },
    enabled: available,
    staleTime: 30_000,
    refetchInterval: false,
  })

  if (!available) {
    return { src: 'chat', items: [], available: false, loading: false, error: null }
  }

  return {
    src: 'chat',
    items: query.data ?? [],
    available: true,
    loading: query.isLoading,
    error: query.error,
  }
}

// ── Cron source hook ───────────────────────────────────────────────────────────

/** Hook for cron jobs. Gated by `capabilities.jobs`. Polls every 30 s. */
export function useCronSessionsFeed(): SessionSourceResult {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })

  const available = capsQuery.data?.jobs ?? false

  const query = useQuery({
    queryKey: ['sessions-feed', 'cron'],
    queryFn: async () => {
      const jobs = await fetchJobs()
      const nowMs = Date.now()
      return jobs.map((job): SessionFeedItem => {
        const when = job.last_run_at
          ? new Date(job.last_run_at).getTime()
          : job.created_at
            ? new Date(job.created_at).getTime()
            : 0
        const state = normalizeCronState(job.state)
        const badges: Array<SessionBadge> = []
        if (!job.enabled) badges.push({ text: 'disabled', color: '#6b7280' })
        return {
          id: makeId('cron', job.id),
          src: 'cron',
          title: job.name || job.prompt.slice(0, 60),
          sub: job.schedule_display ?? null,
          tokens: null,
          when,
          day: getDayBucket(when, nowMs),
          live: state === 'live',
          state,
          badges,
          pinned: false,
          starred: false,
          archived: false,
          sourceMeta: {
            jobId: job.id,
            enabled: job.enabled,
            schedule: job.schedule,
            lastRunSuccess: job.last_run_success,
            runCount: job.run_count,
          },
        }
      })
    },
    enabled: available,
    staleTime: 25_000,
    refetchInterval: available ? 30_000 : false,
  })

  if (!available) {
    return { src: 'cron', items: [], available: false, loading: false, error: null }
  }

  return {
    src: 'cron',
    items: query.data ?? [],
    available: true,
    loading: query.isLoading,
    error: query.error,
  }
}

// ── Task source hook ───────────────────────────────────────────────────────────

/** Hook for kanban tasks. Gated by `capabilities.kanban`. Polls every 15 s. */
export function useTaskSessionsFeed(): SessionSourceResult {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })

  const available = capsQuery.data?.kanban ?? false

  const query = useQuery({
    queryKey: ['sessions-feed', 'task'],
    queryFn: async () => {
      const tasks = await fetchTasks({ include_done: true })
      const nowMs = Date.now()
      return tasks.map((task): SessionFeedItem => {
        const when =
          task.completed_at ??
          task.started_at ??
          task.last_heartbeat_at ??
          task.created_at ??
          0
        const state = normalizeKanbanState(task.status)
        const badges: Array<SessionBadge> = []
        if (task.assignee) badges.push({ text: task.assignee, color: '#8b5cf6' })
        return {
          id: makeId('task', task.id),
          src: 'task',
          title: task.title,
          sub: task.summary ?? task.body ?? null,
          tokens: null,
          when,
          day: getDayBucket(when, nowMs),
          live: state === 'live',
          state,
          badges,
          pinned: false,
          starred: false,
          archived: state === 'archived',
          sourceMeta: {
            taskId: task.id,
            status: task.status,
            priority: task.priority,
            assignee: task.assignee,
          },
        }
      })
    },
    enabled: available,
    staleTime: 10_000,
    refetchInterval: available ? 15_000 : false,
  })

  if (!available) {
    return { src: 'task', items: [], available: false, loading: false, error: null }
  }

  return {
    src: 'task',
    items: query.data ?? [],
    available: true,
    loading: query.isLoading,
    error: query.error,
  }
}

// ── Tool source hook — permanently unavailable ─────────────────────────────────
// TODO(phase1-audit): No cross-session tool-run list endpoint exists on the
// gateway or dashboard. See sessions-sidebar-phase1-audit.md §Tool runs.
// When the gateway exposes a `/api/tool-runs` or similar feed, implement this hook.

/** Tool-run feed. No gateway endpoint — permanently `available: false`. */
export function useToolSessionsFeed(): SessionSourceResult {
  return { src: 'tool', items: [], available: false, loading: false, error: null }
}

// ── Telegram source hook — permanently unavailable ─────────────────────────────
// TODO(phase1-audit): No Telegram conversation/message list endpoint exists.
// Dashboard /api/status exposes telegram platform state (string) only.
// See sessions-sidebar-phase1-audit.md §Telegram.

/** Telegram feed. No gateway endpoint — permanently `available: false`. */
export function useTelegramSessionsFeed(): SessionSourceResult {
  return { src: 'tg', items: [], available: false, loading: false, error: null }
}

// ── Memory source hook ─────────────────────────────────────────────────────────

/** Hook for memory file list. `capabilities.memory` is always true. Polls every 60 s. */
export function useMemorySessionsFeed(): SessionSourceResult {
  const capsQuery = useQuery({
    queryKey: CAPABILITIES_QUERY_KEY,
    queryFn: fetchCapabilities,
    staleTime: 120_000,
  })

  // memory capability is always true in gateway-capabilities.ts (filesystem read).
  // We still read it from caps to be consistent with the pattern.
  const available = capsQuery.data?.memory !== false

  const query = useQuery({
    queryKey: ['sessions-feed', 'mem'],
    queryFn: async (): Promise<Array<SessionFeedItem>> => {
      const res = await fetch('/api/memory/list')
      if (!res.ok) return []
      const data = (await res.json()) as { files?: Array<{ name?: string; path?: string; updatedAt?: number; size?: number }> } | Array<unknown>
      const files = Array.isArray(data)
        ? (data as Array<{ name?: string; path?: string; updatedAt?: number; size?: number }>)
        : (Array.isArray((data as { files?: Array<unknown> }).files)
            ? ((data as { files: Array<{ name?: string; path?: string; updatedAt?: number; size?: number }> }).files)
            : [])
      const nowMs = Date.now()
      return files.map((f, idx): SessionFeedItem => {
        const name = f.name ?? f.path ?? `memory-${idx}`
        const when = f.updatedAt ?? nowMs
        // Use encodeURIComponent so names containing ':' or '/' do not collide
        // with the namespace separator or create ambiguous IDs across dirs.
        return {
          id: makeId('mem', encodeURIComponent(name)),
          src: 'mem',
          title: name,
          sub: null,
          tokens: null,
          when,
          day: getDayBucket(when, nowMs),
          live: false,
          state: 'idle',
          badges: [],
          pinned: false,
          starred: false,
          archived: false,
          sourceMeta: { name, path: f.path, size: f.size },
        }
      })
    },
    enabled: available,
    staleTime: 55_000,
    refetchInterval: available ? 60_000 : false,
  })

  if (!available) {
    return { src: 'mem', items: [], available: false, loading: false, error: null }
  }

  return {
    src: 'mem',
    items: query.data ?? [],
    available: true,
    loading: query.isLoading,
    error: query.error,
  }
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
    if (typeof val === 'string' && val.toLowerCase().includes(lower)) return true
  }
  return false
}

function matchesDateRange(item: SessionFeedItem, from: string | null, to: string | null): boolean {
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
  cron: 1,
  task: 2,
  tool: 3,
  tg: 4,
  mem: 5,
}

export function sortItems(items: Array<SessionFeedItem>, sort: SessionFeedSort): Array<SessionFeedItem> {
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
export function useSessionsFeed(options: SessionsFeedOptions = {}): SessionsFeedResult {
  const {
    sources: requestedSources,
    state: stateFilter = 'all',
    query = '',
    dateRange,
    sort = 'recent',
  } = options

  const chat = useChatSessionsFeed()
  const cron = useCronSessionsFeed()
  const task = useTaskSessionsFeed()
  const tool = useToolSessionsFeed()
  const tg = useTelegramSessionsFeed()
  const mem = useMemorySessionsFeed()

  const allSources: Array<SessionSourceResult> = [chat, cron, task, tool, tg, mem]

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
      if (!includeAll && !sourceFilter.has(sourceResult.src)) continue

      const rebased = sourceResult.items.map(rebase)
      merged.push(...rebased)
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
    chat.items, chat.available, chat.loading,
    cron.items, cron.available, cron.loading,
    task.items, task.available, task.loading,
    tool.available,
    tg.available,
    mem.items, mem.available, mem.loading,
    requestedSources,
    stateFilter,
    query,
    dateRange,
    sort,
  ])

  return result
}
