'use client'

/**
 * use-onboarding-memory.ts — the memory step's data + write layer.
 *
 * Three reads, deliberately unequal in weight:
 *
 *   `/api/claude-config` is the authority on which provider is configured. A
 *     failure here is a real error: without it the step cannot say what is
 *     running and must not pretend otherwise.
 *   `/api/dashboard-proxy/api/memory` is the gateway's readiness verdict —
 *     whether each plugin's dependencies are installed and its config present.
 *     Best effort only: the dashboard is a separate process on :9119 and is
 *     routinely not running. A failure yields `status: 'unknown'` on every
 *     card, never an error banner, because "could not check" is a truthful
 *     answer and "memory is broken" would not be.
 *   `/api/memory/stats` is the verification signal — proof that the
 *     recommended provider's SQLite store exists and holds something. Also
 *     best effort, for the same reason.
 *
 * The write is a `PATCH /api/claude-config`, and it only changes which plugin
 * the agent loads at its *next* initialisation: `agent_init.py` reads
 * `memory.provider` once, at startup, so `needsRestart` is set on every
 * successful write — the same caveat the profile and plugins steps carry.
 *
 * Nothing here throws, and nothing here writes while the relaunch is locked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { buildMemoryChoices } from '../lib/memory-choices'
import type { MemoryChoice } from '../lib/memory-choices'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'

const CONFIG_QUERY_KEY = ['onboarding', 'memory', 'config'] as const
const GATEWAY_QUERY_KEY = ['onboarding', 'memory', 'gateway'] as const
const STATS_QUERY_KEY = ['onboarding', 'memory', 'stats'] as const

const CONFIG_ERROR = "Couldn't read the memory configuration on this machine."
const WRITE_ERROR = "Couldn't change the memory provider."

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(CONFIG_ERROR)
  return (await res.json()) as unknown
}

/** Best-effort read: a failure is a `null` payload, not a rejected query. */
async function fetchOptional(
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The configured provider name, or null for "built-in files only". */
function activeProviderFrom(payload: unknown): string | null {
  const memory = record(record(payload)?.config)?.memory
  const value = record(memory)?.provider
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** The server's own message when it bothered to send one. */
function errorMessage(body: unknown): string | null {
  const value = record(body)?.error
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export type MemoryStoreStats = { exists: boolean; total: number }

function statsFrom(payload: unknown): MemoryStoreStats | null {
  const body = record(payload)
  if (!body) return null
  const db = record(body.db)
  const counts = record(body.counts)
  if (!db && !counts) return null
  const total = counts?.total
  return {
    exists: db?.exists === true,
    total: typeof total === 'number' && Number.isFinite(total) ? total : 0,
  }
}

export type UseOnboardingMemoryResult = {
  choices: Array<MemoryChoice>
  activeProvider: string | null
  loading: boolean
  error: string | null
  select: (id: string) => Promise<void>
  selecting: string | null
  touched: boolean
  needsRestart: boolean
  stats: MemoryStoreStats | null
  refetch: () => void
}

export function useOnboardingMemory(input: {
  enabled: boolean
  /**
   * The `canWriteConfig` verdict. Changing the memory provider rewrites
   * `~/.hermes/config.yaml`, so a locked relaunch — whose summary promises the
   * existing setup is read-only — must not perform it. `MemoryPicker` already
   * withholds the control; this is the guard that holds when a future caller
   * forgets to.
   */
  canWrite: boolean
}): UseOnboardingMemoryResult {
  const { enabled, canWrite } = input
  const queryClient = useQueryClient()
  const [touched, setTouched] = useState(false)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: ({ signal }) => fetchJson('/api/claude-config', signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const gatewayQuery = useQuery({
    queryKey: GATEWAY_QUERY_KEY,
    queryFn: ({ signal }) =>
      fetchOptional('/api/dashboard-proxy/api/memory', signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const statsQuery = useQuery({
    queryKey: STATS_QUERY_KEY,
    queryFn: ({ signal }) => fetchOptional('/api/memory/stats', signal),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const activeProvider = useMemo(
    () =>
      configQuery.data === undefined
        ? null
        : activeProviderFrom(configQuery.data),
    [configQuery.data],
  )

  // `undefined` is "nothing has landed yet". Rendering nine cards with no
  // active one while the config read is still in flight would flash a wrong
  // answer on exactly the machines this step matters most on.
  const choices = useMemo(
    () =>
      configQuery.data === undefined
        ? []
        : buildMemoryChoices({
            activeProvider,
            gatewayMemory: gatewayQuery.data ?? null,
          }),
    [activeProvider, configQuery.data, gatewayQuery.data],
  )

  const stats = useMemo(() => statsFrom(statsQuery.data), [statsQuery.data])

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: GATEWAY_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY })
  }, [queryClient])

  const select = useCallback(
    async (id: string) => {
      // Belt and braces alongside the UI gate: no request at all while locked.
      if (!canWrite || !id) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setSelecting(id)
      setWriteError(null)

      try {
        const res = await fetch('/api/claude-config', {
          method: 'PATCH',
          // The API's CSRF guard is a Content-Type check, so this header is
          // required, not decorative.
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: { memory: { memory_enabled: true, provider: id } },
          }),
          signal: controller.signal,
        })
        const body = (await res.json().catch(() => null)) as unknown

        if (!mountedRef.current) return
        if (!res.ok) {
          setWriteError(errorMessage(body) ?? WRITE_ERROR)
          return
        }

        setTouched(true)
        // Always true: `agent_init.py` reads `memory.provider` once, at agent
        // initialisation, so the running gateway keeps the plugin it booted
        // with until it is restarted.
        setNeedsRestart(true)
        // The same signal the profile step raises, so the app-wide restart
        // banner appears whichever surface made the change.
        useGatewayRestartStore.getState().markNeedsRestart(id)
      } catch {
        // An abort is an unmount, not a failure, and there is nothing left to
        // tell. Anything else is surfaced as `error` — never thrown.
        if (!controller.signal.aborted && mountedRef.current) {
          setWriteError(WRITE_ERROR)
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (mountedRef.current) {
          setSelecting(null)
          refetch()
        }
      }
    },
    [canWrite, refetch],
  )

  const configError = configQuery.isError
    ? configQuery.error instanceof Error
      ? configQuery.error.message
      : CONFIG_ERROR
    : null

  return {
    choices,
    activeProvider,
    loading: configQuery.isLoading,
    // A failed write is the fresher of the two, so it wins.
    error: writeError ?? configError,
    select,
    selecting,
    touched,
    needsRestart,
    stats,
    refetch,
  }
}
