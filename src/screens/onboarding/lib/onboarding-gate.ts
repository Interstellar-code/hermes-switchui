/**
 * onboarding-gate.ts — the pure decision layer for "is the onboarding surface
 * up, and may anything close it".
 *
 * This exists because the old hand-rolled effect in `__root.tsx` conflated two
 * different things: "this install was already configured before anyone touched
 * it" (a legitimate reason to skip the wizard) and "the backend probe just came
 * back" (not a reason to do anything, if a human is standing in the wizard).
 * The probe fires on every boot, so a first-run user whose gateway happened to
 * be reachable watched the wizard appear and then vanish under their cursor
 * mid-step, with nothing preserved.
 *
 * The fix is `active`. Auto-complete is still honoured — but only as an
 * *initial* classification, never as an interruption:
 *
 *   - `active` means a human has interacted with the wizard. Once true,
 *     auto-detection is inert. That is the actual bug.
 *   - The grace window covers the moment before the first interaction: a probe
 *     that resolves seconds after the welcome screen has painted is a visible
 *     yank even if the user has not clicked yet. Auto-complete is only allowed
 *     to win the race it was meant to win — the one it finishes before the user
 *     has had a chance to read anything.
 *
 * `dismissed` is kept distinct from `complete` for the second bug: "Skip setup"
 * used to stamp the completion flag, so a skipper could never be re-prompted.
 * Both states settle the gate and open the workspace; only `complete` is a
 * claim that setup actually happened.
 *
 * Everything here is pure. Storage writes live in `use-onboarding-gate.ts`, so
 * this reducer can be exercised in a node environment with no DOM and no
 * localStorage double.
 */
import type { OnboardingOutcome } from './onboarding-storage'

export type OnboardingGate = {
  /** Setup was carried to the end (or the install was already configured). */
  complete: boolean
  /** The user closed the wizard without finishing. Settles, but is not success. */
  dismissed: boolean
  /** A human is standing in the wizard right now. Nothing may unmount it. */
  active: boolean
}

export type GateEvent =
  | { type: 'HYDRATE'; outcome: OnboardingOutcome }
  | { type: 'ENGAGED' }
  | { type: 'AUTO_DETECTED'; elapsedMs: number }
  | { type: 'WIZARD_FINISHED' }
  | { type: 'WIZARD_DISMISSED' }
  | { type: 'STORAGE_CHANGED'; outcome: OnboardingOutcome }

/**
 * How long after the probe starts an auto-detection still counts as "this
 * install was already set up" rather than "something moved while I was
 * reading". Short enough that a slow gateway never yanks the surface; long
 * enough that a healthy local gateway (single-digit ms over loopback) always
 * makes it.
 */
export const AUTO_DETECT_GRACE_MS = 1_500

/**
 * Whether an auto-detection arriving now is allowed to settle the gate. The
 * `AUTO_DETECTED` case below is the only consumer inside this module, but the
 * hook needs the same answer to decide whether the detection is worth
 * *persisting* — a detection that is refused here settles nothing, so writing
 * it down would claim more than was observed.
 */
export function shouldAutoComplete(
  gate: OnboardingGate,
  elapsedMs: number,
): boolean {
  // 1. `active` — the user is standing in the wizard right now; completing
  //    would unmount the surface under their cursor. This is the actual bug.
  // 2. the grace window — even before the first interaction, a probe that
  //    resolves after the welcome screen has painted is a visible yank.
  if (gate.active) return false
  return elapsedMs <= AUTO_DETECT_GRACE_MS
}

export const INITIAL_GATE: OnboardingGate = {
  complete: false,
  dismissed: false,
  active: false,
}

/**
 * `active` is deliberately *not* derived from the outcome: engagement is a
 * property of this tab's live session, not of anything persisted. A cross-tab
 * write telling us the wizard finished elsewhere must not reach in and unmount
 * the wizard a user is typing into here.
 */
function fromOutcome(
  prev: OnboardingGate,
  outcome: OnboardingOutcome,
): OnboardingGate {
  return {
    complete: outcome.kind === 'complete',
    dismissed: outcome.kind === 'dismissed',
    active: prev.active,
  }
}

export function reduceGate(
  prev: OnboardingGate,
  event: GateEvent,
): OnboardingGate {
  switch (event.type) {
    case 'HYDRATE':
      return fromOutcome(prev, event.outcome)

    case 'STORAGE_CHANGED':
      return fromOutcome(prev, event.outcome)

    case 'ENGAGED':
      // Identity return once already engaged so `useReducer` can bail out —
      // engagement is signalled from raw pointer/key events, which fire often.
      if (prev.active) return prev
      return { ...prev, active: true }

    case 'AUTO_DETECTED':
      if (!shouldAutoComplete(prev, event.elapsedMs)) return prev
      return { ...prev, complete: true }

    case 'WIZARD_FINISHED':
      return { complete: true, dismissed: false, active: false }

    case 'WIZARD_DISMISSED':
      // Explicitly not `complete`: a skipper stays re-promptable.
      return { complete: false, dismissed: true, active: false }

    default:
      return prev
  }
}
