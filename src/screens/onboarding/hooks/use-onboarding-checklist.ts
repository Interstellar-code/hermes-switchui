'use client'

/**
 * use-onboarding-checklist.ts — the same "what's left" list the wizard's
 * summary/finish steps render, available outside the wizard entirely.
 *
 * Skipped and never-done items must stay discoverable after the wizard
 * closes — that's why the sidebar badge and the dashboard card exist. Both
 * read through this hook rather than duplicating the storage/fetch wiring
 * `onboarding-screen.tsx` already does for its own summary step.
 *
 * `chatProven`, `pluginsTouched` and `profileTouched` are always passed as
 * `false` here, and `gatewayReachable` as `null`: those signals come from live
 * probes (`useConnectStatus`/`useCorePlugins`/`useOnboardingProfiles`/
 * `useFirstChat`) that only run *inside* an active wizard session, and outside
 * the wizard we only have what is in storage.
 *
 * That is safe only because the completion record now carries `completed`:
 * `buildChecklist` treats a step recorded as done by the run that finished as
 * done, so `false` here means "no live proof", not "not done". Before that
 * field existed, a user who completed the full branch kept a permanent `4`
 * badge on the sidebar nav and "Setup Wizard (4 left)" in the command palette
 * with no way to clear either.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildChecklist, outstandingCount } from '../lib/checklist'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
  readOnboardingDraft,
  readOnboardingOutcome,
} from '../lib/onboarding-storage'
import type { ChecklistItem } from '../lib/checklist'
import type {
  OnboardingDraft,
  OnboardingOutcome,
  StorageLike,
} from '../lib/onboarding-storage'

// Same key `onboarding-screen.tsx` uses for its own `/api/claude-config`
// query — reusing the literal keeps this hook and a concurrently-mounted
// wizard sharing one TanStack Query cache entry instead of double-fetching.
const CONFIG_QUERY_KEY = ['onboarding', 'claude-config'] as const

type ConfigProviderRow = {
  id?: string
  configured?: boolean
  maskedKeys?: Record<string, string>
}

type ClaudeConfigPayload = {
  providers?: Array<ConfigProviderRow>
  activeProvider?: string
  activeModel?: string
}

const WATCHED_KEYS: ReadonlySet<string> = new Set(
  Object.values(ONBOARDING_KEYS),
)

const EMPTY_ITEMS: Array<ChecklistItem> = []

function safeStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

async function fetchClaudeConfig(): Promise<ClaudeConfigPayload | null> {
  try {
    const res = await fetch('/api/claude-config')
    if (!res.ok) return null
    return (await res.json()) as ClaudeConfigPayload
  } catch {
    return null
  }
}

type Snapshot = {
  outcome: OnboardingOutcome
  draft: OnboardingDraft | null
}

export type UseOnboardingChecklistResult = {
  items: Array<ChecklistItem>
  outstanding: number
  ready: boolean
}

export function useOnboardingChecklist(): UseOnboardingChecklistResult {
  const [ready, setReady] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>({
    outcome: { kind: 'fresh' },
    draft: null,
  })

  const readSnapshot = useCallback(() => {
    const storage = safeStorage()
    setSnapshot({
      outcome: readOnboardingOutcome(storage),
      draft: readOnboardingDraft(storage),
    })
    setReady(true)
  }, [])

  useEffect(() => {
    // Never throws: this effect only runs client-side (React skips effects
    // during SSR), but `readSnapshot`/`safeStorage` stay defensive anyway.
    readSnapshot()

    const onComplete = () => readSnapshot()
    const onStorage = (event: StorageEvent) => {
      // A cleared storage area (`event.key === null`) or a change to any key
      // this contract owns both warrant a re-read; anything else is noise
      // from an unrelated feature sharing the same localStorage.
      if (event.key === null || WATCHED_KEYS.has(event.key)) readSnapshot()
    }

    window.addEventListener(ONBOARDING_COMPLETE_EVENT, onComplete)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(ONBOARDING_COMPLETE_EVENT, onComplete)
      window.removeEventListener('storage', onStorage)
    }
  }, [readSnapshot])

  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: fetchClaudeConfig,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const activeProvider = configQuery.data?.activeProvider || null

  const items = useMemo(
    () =>
      ready
        ? buildChecklist({
            outcome: snapshot.outcome,
            draft: snapshot.draft,
            activeProvider,
            // Every live signal is absent outside the wizard. `null` for
            // reachability rather than `false`: "not checked in this session"
            // is not "the gateway is down", and this hook renders on a
            // dashboard that has no business claiming an outage.
            gatewayReachable: null,
            chatProven: false,
            agentCwd: null,
            agentCwdExplicit: false,
            pluginsTouched: false,
            profileTouched: false,
            memoryTouched: false,
            // Live probe, same rule as every signal above: it only runs
            // inside a mounted wizard (`use-profile-servability.ts`, wired
            // through `onboarding-screen.tsx`). `null` renders identically
            // to "nothing to warn about" — silence, never a false
            // accusation — so a dashboard/sidebar reader outside the wizard
            // simply doesn't see this warning rather than seeing a wrong one.
            profileServability: null,
          })
        : EMPTY_ITEMS,
    [activeProvider, ready, snapshot],
  )

  return {
    items,
    outstanding: ready ? outstandingCount(items) : 0,
    ready,
  }
}
