'use client'

/**
 * use-onboarding-profiles.ts — the agent-profile step's data + write layer.
 *
 * Deliberately narrow: this hook *activates* an existing profile and nothing
 * else. Creating, editing, cloning, renaming and deleting live in the Agents
 * screen's own nine-step wizard, and duplicating any of that inside onboarding
 * would be a second place to maintain it.
 *
 * `/api/profiles/list` and `/api/profiles/activate` are pure local filesystem
 * routes — no gateway dependency, no capability gate — so there is no
 * availability branching here. Activation writes the single-line pointer
 * `~/.hermes/active_profile` and nothing else; the gateway reads it at startup
 * and does not hot-reload, which is why `needsGatewayRestart` comes back true
 * every time and why this hook mirrors `profiles-screen.tsx` in marking the
 * shared restart store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { buildProfileChoices } from '../lib/profile-choices'
import type { ProfileChoice } from '../lib/profile-choices'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'

const PROFILES_QUERY_KEY = ['onboarding', 'agent-profiles'] as const

const LIST_ERROR = "Couldn't read the agent profiles on this machine."
const ACTIVATE_ERROR = "Couldn't switch the active agent profile."

async function fetchProfiles({
  signal,
}: {
  signal: AbortSignal
}): Promise<unknown> {
  const res = await fetch('/api/profiles/list', { signal })
  if (!res.ok) throw new Error(LIST_ERROR)
  return (await res.json()) as unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The server's own message when it bothered to send one. */
function errorMessage(body: unknown): string | null {
  const value = record(body)?.error
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export type UseOnboardingProfilesResult = {
  choices: Array<ProfileChoice>
  activeName: string | null
  loading: boolean
  error: string | null
  activate: (name: string) => Promise<void>
  activating: string | null
  touched: boolean
  needsRestart: boolean
  refetch: () => void
}

export function useOnboardingProfiles(input: {
  enabled: boolean
  /**
   * The `canWriteConfig` verdict for this run. Activating a profile changes
   * which agent the gateway boots into, so a locked relaunch — whose summary
   * promises the existing setup is read-only — must not perform it.
   * `ProfilePicker` already withholds the control; this is the guard that
   * holds when a future caller forgets to.
   */
  canWrite: boolean
}): UseOnboardingProfilesResult {
  const { enabled, canWrite } = input
  const queryClient = useQueryClient()
  const [touched, setTouched] = useState(false)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [activateError, setActivateError] = useState<string | null>(null)

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

  const profilesQuery = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: fetchProfiles,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  })

  // `undefined` is "nothing has landed yet", which is not the same as a
  // malformed body — rendering the synthetic Default card alone while the
  // real list is still in flight would flash a wrong answer.
  const choices = useMemo(
    () =>
      profilesQuery.data === undefined
        ? []
        : buildProfileChoices(profilesQuery.data),
    [profilesQuery.data],
  )

  const activeName = choices.find((choice) => choice.isActive)?.name ?? null

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY })
  }, [queryClient])

  const activate = useCallback(
    async (name: string) => {
      // Belt and braces alongside the UI gate: no request at all while locked.
      if (!canWrite || !name) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setActivating(name)
      setActivateError(null)

      try {
        const res = await fetch('/api/profiles/activate', {
          method: 'POST',
          // The API's CSRF guard is a Content-Type check, so this header is
          // required, not decorative.
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
          signal: controller.signal,
        })
        const body = (await res.json().catch(() => null)) as unknown

        if (!mountedRef.current) return
        if (!res.ok) {
          setActivateError(errorMessage(body) ?? ACTIVATE_ERROR)
          return
        }

        setTouched(true)
        // Always true in practice — the gateway loads config at startup and
        // does not hot-reload — but read from the response rather than
        // assumed, so a future hot-reloading gateway stops nagging by itself.
        setNeedsRestart(record(body)?.needsGatewayRestart !== false)
        // The same signal `profiles-screen.tsx` raises, so the app-wide
        // restart banner appears whichever surface did the switching.
        useGatewayRestartStore.getState().markNeedsRestart(name)
      } catch {
        // An abort is an unmount, not a failure, and there is nothing left to
        // tell. Anything else is surfaced as `error` — never thrown.
        if (!controller.signal.aborted && mountedRef.current) {
          setActivateError(ACTIVATE_ERROR)
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (mountedRef.current) {
          setActivating(null)
          refetch()
        }
      }
    },
    [canWrite, refetch],
  )

  const listError = profilesQuery.isError
    ? profilesQuery.error instanceof Error
      ? profilesQuery.error.message
      : LIST_ERROR
    : null

  return {
    choices,
    activeName,
    loading: profilesQuery.isLoading,
    // A failed activation is the fresher of the two, so it wins.
    error: activateError ?? listError,
    activate,
    activating,
    touched,
    needsRestart,
    refetch,
  }
}
