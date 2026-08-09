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
 *   3. The probe never writes the completion flag. A probe that fires behind
 *      the login screen (or against a backend the visitor is not entitled to)
 *      must not be able to consume first-run setup for whoever logs in next.
 *      What it *may* write, and only when `probe` is enabled — which the
 *      caller sets to `authResolved && !loginBlocking`, so the unauthenticated
 *      path never reaches this code at all — is the separate `autoDetected`
 *      record. Without it an install with a working gateway and no completion
 *      flag repainted the fullscreen wizard on every single boot and then
 *      yanked it away once the probe resolved, forever. The record is distinct
 *      from `complete` so "a machine noticed" stays distinguishable from "a
 *      human finished", and it is only written when the detection actually
 *      settles the gate (`shouldAutoComplete`) — a detection that lost the
 *      race changes nothing and is not worth remembering.
 *
 * `typeof window` is checked because `__root.tsx` renders server-side under
 * TanStack Start; the fetch is abortable and every listener is torn down so
 * nothing can dispatch into an unmounted tree.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { INITIAL_GATE, reduceGate, shouldAutoComplete } from './onboarding-gate'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
  readOnboardingAutoDetected,
  readOnboardingOutcome,
  writeOnboardingAutoDetected,
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
  if (storage.getItem(ONBOARDING_KEYS.complete) === 'true') {
    return {
      kind: 'complete',
      at: Date.now(),
      branch: 'main',
      skipped: [],
      completed: [],
    }
  }
  // A previous authenticated boot already established that this install is
  // configured. Honouring it here is the whole point of persisting it: the
  // probe below is then skipped, so nothing paints and vanishes.
  const auto = readOnboardingAutoDetected(storage)
  if (auto) {
    return {
      kind: 'complete',
      at: auto.at,
      branch: 'main',
      skipped: [],
      completed: [],
    }
  }
  return outcome
}

export function useOnboardingGate(options?: {
  probe?: boolean
}): UseOnboardingGateResult {
  // Default on: the caller opts *out* (e.g. while the login screen is up),
  // so forgetting to pass anything preserves the original behaviour.
  const probeEnabled = options?.probe !== false
  const [gate, dispatch] = useReducer(reduceGate, INITIAL_GATE)
  const [hydrated, setHydrated] = useState(false)

  // Refreshed during render so the probe callback below can ask about the
  // *current* gate rather than the one that existed when it was issued —
  // engagement during the probe's flight is exactly what must veto the write.
  const gateRef = useRef(gate)
  gateRef.current = gate

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
          const elapsedMs = Date.now() - startedAt
          // Unreachable unless `probeEnabled` — i.e. unless the caller has
          // already resolved auth and cleared any login gate. That is the
          // security property; the branch is inside it, not next to it.
          if (shouldAutoComplete(gateRef.current, elapsedMs)) {
            writeOnboardingAutoDetected(storage)
          }
          dispatch({ type: 'AUTO_DETECTED', elapsedMs })
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
      // There is one path now (`main`); this call records only that the gate
      // settled, and tracks no per-step skip list of its own.
      writeOnboardingComplete(window.localStorage, {
        branch: 'main',
        skipped: [],
        completed: [],
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
