import { useQuery } from '@tanstack/react-query'
import type { Query, QueryFunctionContext } from '@tanstack/react-query'

import { HttpError } from '@/lib/http-error'

export type SessionStatusPayload = {
  contextPercent: number
  model: string
  maxTokens: number
  usedTokens: number
  status: string
  sessionKey: string
  sessionLabel: string
  modelProvider: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  estimatedCost: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  apiCallCount: number
  source: string
  endReason: string
  /** False only when usedTokens is the gateway's own last-prompt count. */
  estimated: boolean
  maxSource: 'gateway' | 'config' | 'catalog' | 'default'
  /** compression.threshold (0–1) auto-compaction fires at, or null. */
  compressionThreshold: number | null
}

function readMaxSource(value: unknown): SessionStatusPayload['maxSource'] {
  return value === 'gateway' || value === 'config' || value === 'catalog'
    ? value
    : 'default'
}

function readThreshold(value: unknown): number | null {
  const n = Number(value)
  return value != null && n > 0 && n < 1 ? n : null
}

const EMPTY_PAYLOAD: SessionStatusPayload = {
  contextPercent: 0,
  model: '',
  maxTokens: 0,
  usedTokens: 0,
  status: 'idle',
  sessionKey: 'new',
  sessionLabel: '',
  modelProvider: '',
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
  estimatedCost: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  apiCallCount: 0,
  source: '',
  endReason: '',
  estimated: true,
  maxSource: 'default',
  compressionThreshold: null,
}

const POLL_MS = 15_000
const BACKOFF_INIT_MS = 5_000
const BACKOFF_MAX_MS = 60_000
const MAX_FAILURES = 5

function sessionStatusQueryKey(
  sessionKey: string | null | undefined,
): readonly ['session-status', string] {
  return ['session-status', sessionKey ?? '']
}

// Consecutive-failure counts per query key. TanStack Query v5 resets
// `fetchFailureCount` to 0 on every new fetch dispatch, so it can never
// drive a multi-step backoff or a stop-after-N rule — the count lives here
// instead, updated by the queryFn below (the only writer) and read by the
// refetchInterval function. Keyed by sessionKey so sessions (and tests with
// fresh keys) never share a count.
const consecutiveFailures = new Map<string, number>()

function failureKey(sessionKey: string | null | undefined): string {
  return sessionKey ?? ''
}

/** Test hook: wipe the consecutive-failure counts between tests. */
export function __resetSessionStatusFailures(): void {
  consecutiveFailures.clear()
}

async function fetchSessionStatus(
  sessionKey: string | null | undefined,
  previous: SessionStatusPayload | undefined,
): Promise<SessionStatusPayload> {
  const params = sessionKey
    ? `?sessionKey=${encodeURIComponent(sessionKey)}`
    : ''
  const res = await fetch(`/api/session-status${params}`)

  if (res.ok) {
    const data = await res.json()
    const p = data?.payload ?? {}
    if (data?.ok) {
      consecutiveFailures.set(failureKey(sessionKey), 0)
      return {
        contextPercent: Number(p.contextPercent ?? 0),
        model: String(p.model ?? ''),
        maxTokens: Number(p.maxTokens ?? 0),
        usedTokens: Number(p.usedTokens ?? 0),
        estimated: p.estimated !== false,
        maxSource: readMaxSource(p.maxSource),
        compressionThreshold: readThreshold(p.compressionThreshold),
        status: String(p.status ?? 'idle'),
        sessionKey: String(p.sessionKey ?? 'new'),
        sessionLabel: String(p.sessionLabel ?? ''),
        modelProvider: String(p.modelProvider ?? ''),
        inputTokens: Number(p.inputTokens ?? 0),
        outputTokens: Number(p.outputTokens ?? 0),
        totalTokens: Number(p.totalTokens ?? 0),
        cost: Number(p.cost ?? 0),
        estimatedCost: Number(p.estimatedCost ?? 0),
        cacheReadTokens: Number(p.cacheReadTokens ?? 0),
        cacheWriteTokens: Number(p.cacheWriteTokens ?? 0),
        reasoningTokens: Number(p.reasoningTokens ?? 0),
        apiCallCount: Number(p.apiCallCount ?? 0),
        source: String(p.source ?? ''),
        endReason: String(p.endReason ?? ''),
      }
    }
    // 200 with ok:false — fall through to the context-usage fallback below.
  } else if (res.status >= 500) {
    // 5xx — throw so the query lands in its error state and the interval
    // backoff (see sessionStatusRefetchInterval) applies.
    const key = failureKey(sessionKey)
    consecutiveFailures.set(key, (consecutiveFailures.get(key) ?? 0) + 1)
    throw new HttpError(
      `session-status ${res.status} for session ${sessionKey ?? '—'}`,
      res.status,
    )
  }

  // Non-5xx failure (e.g. 401/403) — try /api/context-usage, then resume the
  // normal cadence. Network errors (including a failing fallback fetch)
  // bubble up and count toward the backoff, like the legacy poll's catch.
  const fbParams = sessionKey
    ? `?sessionId=${encodeURIComponent(sessionKey)}`
    : ''
  let fbRes: Response
  try {
    fbRes = await fetch(`/api/context-usage${fbParams}`)
  } catch (error) {
    const key = failureKey(sessionKey)
    consecutiveFailures.set(key, (consecutiveFailures.get(key) ?? 0) + 1)
    throw error
  }
  if (fbRes.ok) {
    const fbData = await fbRes.json()
    if (fbData.ok) {
      consecutiveFailures.set(failureKey(sessionKey), 0)
      return {
        ...(previous ?? EMPTY_PAYLOAD),
        model: fbData.model ?? '',
        contextPercent: fbData.contextPercent ?? 0,
        usedTokens: fbData.usedTokens ?? 0,
        maxTokens: fbData.maxTokens ?? 0,
        estimated: fbData.estimated !== false,
        maxSource: readMaxSource(fbData.maxSource),
        compressionThreshold: readThreshold(fbData.compressionThreshold),
      }
    }
  }
  return previous ?? EMPTY_PAYLOAD
}

/**
 * Poll cadence: 15 s while healthy; after a failed fetch 5 s doubling to a
 * 60 s cap; stops entirely after MAX_FAILURES consecutive failures (the
 * legacy poll's stop rule). Non-5xx failures resolve through the
 * context-usage fallback, so they never enter the backoff.
 */
function sessionStatusRefetchInterval(
  query: Query<
    SessionStatusPayload,
    Error,
    SessionStatusPayload,
    ReturnType<typeof sessionStatusQueryKey>
  >,
): number | false {
  const key = (query.queryKey[1] as string | undefined) ?? ''
  const failures = consecutiveFailures.get(key) ?? 0
  if (failures >= MAX_FAILURES) return false
  if (failures > 0) {
    return Math.min(BACKOFF_INIT_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
  }
  return POLL_MS
}

/**
 * Revive trigger for a stopped poll only: once `consecutiveFailures` reaches
 * MAX_FAILURES the interval above returns false, and a window focus is the
 * single event that retries. A healthy poll keeps the legacy
 * no-focus-refetch behaviour. A successful retry resets the count inside the
 * queryFn, so the interval resumes on its own.
 */
function sessionStatusRefetchOnWindowFocus(
  query: Query<
    SessionStatusPayload,
    Error,
    SessionStatusPayload,
    ReturnType<typeof sessionStatusQueryKey>
  >,
): boolean | 'always' {
  const key = (query.queryKey[1] as string | undefined) ?? ''
  return (consecutiveFailures.get(key) ?? 0) >= MAX_FAILURES ? 'always' : false
}

export function sessionStatusQueryOptions(
  sessionKey: string | null | undefined,
) {
  return {
    queryKey: sessionStatusQueryKey(sessionKey),
    queryFn: (
      ctx: QueryFunctionContext<ReturnType<typeof sessionStatusQueryKey>>,
    ) =>
      fetchSessionStatus(
        sessionKey,
        ctx.client.getQueryData(sessionStatusQueryKey(sessionKey)),
      ),
    staleTime: 10_000,
    // The interval backoff above IS the retry policy for this poll; the
    // global shouldRetry (query-defaults.ts) must not stack on top of it.
    retry: false,
    refetchInterval: sessionStatusRefetchInterval,
    refetchIntervalInBackground: false,
    // A stopped poll (MAX_FAILURES) revives on window focus only; a healthy
    // poll never refetches on focus, matching the legacy setTimeout poll.
    refetchOnWindowFocus: sessionStatusRefetchOnWindowFocus,
    refetchOnReconnect: false,
  }
}

/**
 * Polls /api/session-status for a given sessionKey.
 * - One shared request per interval no matter how many components mount it
 *   (the chat page mounts four).
 * - Exponential backoff on 5xx (5s → 60s, capped).
 * - Stops polling after MAX_FAILURES consecutive failures; a window focus
 *   retries once, and a success resumes the 15 s cadence.
 * - Falls back to /api/context-usage if session-status returns no useful
 *   data (non-5xx failure).
 * - Returns EMPTY_PAYLOAD before the first data arrives.
 */
export function useSessionStatus(
  sessionKey: string | null | undefined,
  options?: { enabled?: boolean },
): SessionStatusPayload {
  const { data } = useQuery({
    ...sessionStatusQueryOptions(sessionKey),
    enabled: options?.enabled ?? true,
  })
  return data ?? EMPTY_PAYLOAD
}
