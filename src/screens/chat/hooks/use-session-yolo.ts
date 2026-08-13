/**
 * Per-session approval bypass ("YOLO") — read + write.
 *
 * Talks to `/api/sessions/:sessionKey/yolo`, which proxies the gateway's
 * `/api/sessions/{id}/yolo`. That is the only surface that flips the set the
 * approval guard actually reads: `tools/approval.py`'s `_session_yolo` is
 * process-resident, and SwitchUI's chats are served by the gateway process.
 *
 * ## Honest state
 *
 * The bypass is deliberately NOT persisted upstream — a gateway restart clears
 * it with no event, so a cached "on" would be a lie in the one direction that
 * matters. Nothing here holds the value beyond the query cache, and the query
 * is made self-correcting in BOTH directions:
 *
 *   - `refetchOnMount: 'always'` / `refetchOnWindowFocus` / `refetchOnReconnect`
 *     cover the restart-while-you-were-away case.
 *   - `refetchInterval` covers the tab that stays focused and connected. It
 *     polls whether the bypass is on or off, because both stale directions are
 *     wrong: stale-on over-warns, and stale-off (another tab, or a CLI `/yolo`
 *     against the same key) claims approvals are protecting you when they are
 *     not.
 *   - A FAILED read is reported as `unknown`, never as `enabled: false`. The UI
 *     renders that as its own state rather than silently downgrading to "safe".
 *
 * `unsupported` means the gateway build predates hermes-agent 0.19.13 and has
 * no such route. The control hides itself rather than offering a switch that
 * cannot move.
 */
import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  activeScopeSegments,
  getSessionProfile,
  profileBody,
  readSendFailure,
} from '@/lib/session-scope'

/** Route-level sentinels that are not real gateway sessions. */
const NON_SESSION_KEYS = new Set(['', 'new', 'main'])

/** Slow enough to be free, fast enough that a restart self-corrects while you
 *  are still looking at the chat. Our route times its gateway call out at 10s. */
export const SESSION_YOLO_POLL_MS = 30_000

export type SessionYoloWire = {
  ok?: boolean
  enabled?: boolean
  previous?: boolean
  unsupported?: boolean
}

export type SessionYoloRead = {
  enabled: boolean
  unsupported: boolean
}

export type SessionYoloState = {
  /**
   * There is a real gateway session to key on. False for the `new`/`main`
   * route sentinels and in portable mode — a control that cannot address a
   * session must not render, or it offers a switch that silently does nothing.
   */
  available: boolean
  /** True only when the gateway just told us so. */
  enabled: boolean
  /** The gateway build has no per-session bypass — render nothing. */
  unsupported: boolean
  /** The read failed. We do not know the state and must not claim to. */
  unknown: boolean
  /** A write is in flight. */
  pending: boolean
  /** Last write failure, surfaced next to the control. */
  error: string | null
  /** Explicit set; never a toggle — a toggle would race a stale read. */
  setEnabled: (next: boolean) => Promise<void>
  /** Manual re-read, for the "state unknown" affordance. */
  refresh: () => void
}

export function isRealSessionKey(
  sessionKey: string | undefined | null,
): boolean {
  return (
    typeof sessionKey === 'string' && !NON_SESSION_KEYS.has(sessionKey.trim())
  )
}

export function sessionYoloQueryKey(sessionKey: string): Array<string> {
  return ['session-yolo', ...activeScopeSegments(), sessionKey]
}

export function sessionYoloUrl(
  sessionKey: string,
  profile: string | null,
): string {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  return `/api/sessions/${encodeURIComponent(sessionKey)}/yolo${query}`
}

export async function fetchSessionYolo(
  sessionKey: string,
  profile: string | null,
): Promise<SessionYoloRead> {
  const res = await fetch(sessionYoloUrl(sessionKey, profile))
  if (!res.ok) throw new Error(await readSendFailure(res))
  const json = (await res.json()) as SessionYoloWire
  return {
    enabled: json.enabled === true,
    unsupported: json.unsupported === true,
  }
}

export function useSessionYolo(
  sessionKey: string | undefined,
): SessionYoloState {
  const profile = getSessionProfile()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const active = isRealSessionKey(sessionKey)
  const key = active ? (sessionKey as string).trim() : ''

  const query = useQuery({
    queryKey: sessionYoloQueryKey(key),
    queryFn: () => fetchSessionYolo(key, profile),
    enabled: active,
    refetchInterval: SESSION_YOLO_POLL_MS,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: true,
    // The value is process-resident upstream; there is no such thing as a
    // fresh copy of it here.
    staleTime: 0,
    retry: false,
  })

  const mutation = useMutation({
    mutationFn: async function setSessionYolo(next: boolean) {
      const res = await fetch(sessionYoloUrl(key, null), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next, ...profileBody() }),
      })
      if (!res.ok) throw new Error(await readSendFailure(res))
      const json = (await res.json()) as SessionYoloWire
      // The gateway echoes the state it now holds. Trust that over `next` —
      // it is the only thing that was actually enforced.
      return { enabled: json.enabled === true, unsupported: false }
    },
    onMutate: () => setError(null),
    onError: (err) => {
      setError(err instanceof Error ? err.message : String(err))
      // A failed write leaves the real state unknown; re-read rather than
      // leaving the last optimisticless value on screen.
      void queryClient.invalidateQueries({ queryKey: sessionYoloQueryKey(key) })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(sessionYoloQueryKey(key), data)
    },
  })

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (!active) return
      await mutation.mutateAsync(next).catch(() => undefined)
    },
    [active, mutation],
  )

  const refresh = useCallback(() => {
    if (!active) return
    setError(null)
    void queryClient.invalidateQueries({ queryKey: sessionYoloQueryKey(key) })
  }, [active, key, queryClient])

  return useMemo(
    () => ({
      available: active,
      enabled: query.data?.enabled === true,
      unsupported: query.data?.unsupported === true,
      // Never report "unknown" before the first read has had a chance to run.
      unknown: active && query.isError,
      pending: mutation.isPending,
      error,
      setEnabled,
      refresh,
    }),
    [
      active,
      query.data?.enabled,
      query.data?.unsupported,
      query.isError,
      mutation.isPending,
      error,
      setEnabled,
      refresh,
    ],
  )
}
