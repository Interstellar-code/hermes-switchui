/**
 * -root-layout-state.ts — which of the four mutually-aware root surfaces the
 * app is showing. Pure, so the precedence rules are pinned by unit tests
 * rather than rediscovered by staring at JSX in `__root.tsx`.
 *
 * The onboarding argument used to be a bare "complete?" boolean, which could
 * not express the state that caused the wizard-yank bug: a user who is
 * *engaged* with the wizard while the backend probe reports the install is
 * already configured. `OnboardingGate` carries that third bit, and this module
 * translates it:
 *
 *   - `active` pins the wizard up and the shell down, no matter what else the
 *     gate says. Nothing outranks a user mid-flow except auth.
 *   - `complete` and `dismissed` both *settle* the gate — the wizard comes
 *     down and the workspace opens either way — but only `complete` licenses
 *     the post-onboarding overlays, because a dismissal is not a claim that
 *     setup ever happened.
 *
 * The boolean/null overload is kept so callers that genuinely only know
 * "complete?" (and the tests written against them) keep working verbatim.
 *
 * The type lives here rather than in `src/screens/onboarding/` only for the
 * import direction: `routes → screens` is the direction this repo already
 * uses, so `-root-layout-state.ts` importing the gate type is the grain, not
 * against it.
 */
import type { OnboardingGate } from '@/screens/onboarding/lib/onboarding-gate'

export type RootSurfaceState = {
  showLogin: boolean
  showOnboarding: boolean
  showWorkspaceShell: boolean
  showPostOnboardingOverlays: boolean
}

export type RootAuthStatus = {
  authRequired: boolean
  authenticated: boolean
}

function toGate(onboarding: OnboardingGate | boolean | null): OnboardingGate {
  if (typeof onboarding === 'object' && onboarding !== null) return onboarding
  return { complete: onboarding === true, dismissed: false, active: false }
}

export function getRootSurfaceState(
  onboarding: OnboardingGate | boolean | null,
  authStatus: RootAuthStatus | null = null,
): RootSurfaceState {
  if (authStatus?.authRequired && !authStatus.authenticated) {
    return {
      showLogin: true,
      showOnboarding: false,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    }
  }

  const gate = toGate(onboarding)
  const settled = gate.complete || gate.dismissed

  return {
    showLogin: false,
    showOnboarding: gate.active || !settled,
    showWorkspaceShell: settled && !gate.active,
    showPostOnboardingOverlays: settled && !gate.active && gate.complete,
  }
}
