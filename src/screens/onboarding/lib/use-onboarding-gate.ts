/**
 * use-onboarding-gate.ts — the one place the onboarding gate touches the
 * browser: localStorage, the connection probe, and cross-tab events.
 *
 * The split matters. `onboarding-gate.ts` decides *what the gate should be*
 * and is pure; this hook decides *when the world changed* and is impure. The
 * old code in `__root.tsx` mixed the two, which is how a network response
 * ended up writing localStorage and unmounting a wizard in the same callback.
 *
 * Three rules are load-bearing here:
 *
 *   1. The probe only runs when the stored outcome is not already complete. A
 *      settled install has nothing to learn from asking again on every boot.
 *   2. `elapsedMs` is measured from the moment the probe is *issued*, not from
 *      mount, because that is the window the reducer is reasoning about — how
 *      long the user has been looking at the wizard before the answer arrived.
 *   3. Writes happen only in `markComplete`/`markDismissed`. The probe never
 *      persists anything, so a probe that fires behind the login screen (or
 *      against a backend the visitor is not entitled to) cannot leave a
 *      completion flag behind. Callers gate the probe on auth as well, but the
 *      no-write rule means that gate is defence in depth rather than the fix.
 *
 * `typeof window` is checked because `__root.tsx` renders server-side under
 * TanStack Start; the fetch is abortable and every listener is torn down so
 * nothing can dispatch into an unmounted tree.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { INITIAL_GATE, reduceGate } from './onboarding-gate'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
  readOnboardingOutcome,
  writeOnboardingComplete,
  writeOnboardingDismissed,
} from './onboarding-storage'
import type { OnboardingGate } from './onboarding-gate'
import type { OnboardingOutcome } from './onboarding-storage'

type ConnectionStatusPayload = {
  ok?: boolean
  chatReady?: boolean
  modelConfigured?: boolean
}

export type UseOnboardingGateResult = {
  gate: OnboardingGate
  /** False until the first client-side read of localStorage has landed. */
  hydrated: boolean
  markEngaged: () => void
  markComplete: () => void
  markDismissed: () => void
}

/**
 * The pre-existing listener matched only the legacy `complete` key, so a
 * sibling tab writing `dismissed` or a fresh `outcome` went unnoticed. All
 * four keys feed `readOnboardingOutcome`, so all four have to wake us up.
 */
const WATCHED_KEYS: ReadonlySet<string> = new Set(
  Object.values(ONBOARDING_KEYS),
)

function looksConfigured(status: ConnectionStatusPayload | null): boolean {
  if (!status) return false
  return Boolean(status.ok || (status.chatReady && status.modelConfigured))
}

/**
 * `readOnboardingOutcome` only understands the rich `outcome` record, but the
 * wizard that is still mounted today finishes by writing the legacy `complete`
 * flag alone — and every install that onboarded before the rich record existed
 * has nothing else either. Without this fallback both populations would read
 * back as `fresh` and be re-onboarded on their next boot.
 *
 * It outranks `dismissed` deliberately: reaching the end of the wizard at any
 * point is a stronger claim than having once closed it early.
 */
function readGateOutcome(storage: Storage): OnboardingOutcome {
  const outcome = readOnboardingOutcome(storage)
  if (outcome.kind === 'complete') return outcome
  if (storage.getItem(ONBOARDING_KEYS.complete) !== 'true') return outcome
  return { kind: 'complete', at: Date.now(), branch: 'quick', skipped: [] }
}

export function useOnboardingGate(options?: {
  probe?: boolean
}): UseOnboardingGateResult {
  // Default on: the caller opts *out* (e.g. while the login screen is up),
  // so forgetting to pass anything preserves the original behaviour.
  const probeEnabled = options?.probe !== false
  const [gate, dispatch] = useReducer(reduceGate, INITIAL_GATE)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const storage = window.localStorage
    const outcome = readGateOutcome(storage)
    dispatch({ type: 'HYDRATE', outcome })
    setHydrated(true)

    const controller = new AbortController()

    if (probeEnabled && outcome.kind !== 'complete') {
      const startedAt = Date.now()
      void fetch('/api/connection-status', { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((status: ConnectionStatusPayload | null) => {
          if (controller.signal.aborted) return
          if (!looksConfigured(status)) return
          dispatch({
            type: 'AUTO_DETECTED',
            elapsedMs: Date.now() - startedAt,
          })
        })
        .catch(() => undefined)
    }

    const reread = () => {
      dispatch({
        type: 'STORAGE_CHANGED',
        outcome: readGateOutcome(storage),
      })
    }

    // A `null` key means the whole store was cleared — always re-read.
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && !WATCHED_KEYS.has(event.key)) return
      reread()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(ONBOARDING_COMPLETE_EVENT, reread)

    return () => {
      controller.abort()
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(ONBOARDING_COMPLETE_EVENT, reread)
    }
  }, [probeEnabled])

  const markEngaged = useCallback(() => {
    dispatch({ type: 'ENGAGED' })
  }, [])

  const markComplete = useCallback(() => {
    if (typeof window !== 'undefined') {
      // The live wizard is the single-path legacy flow, which maps onto the
      // `quick` branch; it tracks no per-step skip list of its own.
      writeOnboardingComplete(window.localStorage, {
        branch: 'quick',
        skipped: [],
      })
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_COMPLETE_EVENT, {
          detail: { completed: true },
        }),
      )
    }
    dispatch({ type: 'WIZARD_FINISHED' })
  }, [])

  const markDismissed = useCallback(() => {
    if (typeof window !== 'undefined') {
      writeOnboardingDismissed(window.localStorage)
    }
    dispatch({ type: 'WIZARD_DISMISSED' })
  }, [])

  return useMemo(
    () => ({ gate, hydrated, markEngaged, markComplete, markDismissed }),
    [gate, hydrated, markEngaged, markComplete, markDismissed],
  )
}
