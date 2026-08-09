/**
 * setup-wizard-store.ts — Zustand store for re-launching the setup wizard.
 *
 * The first-run wizard (`src/screens/onboarding/onboarding-screen.tsx`) gates
 * itself on the `claude-onboarding-complete` localStorage flag. This store lets
 * the sidebar re-open the same wizard on demand, in a controlled (relaunch)
 * mode that writes no provider config until the user presses one of its
 * labelled write controls.
 *
 * `target` carries an optional deep link: the sidebar badge, the command
 * palette, and the dashboard checklist card can all jump straight to a
 * specific step (`openSetupWizard('provider')`, or `openSetupWizard('summary')`
 * for the read-only overview) instead of landing on the first rail step. A
 * bare `openSetupWizard()` call clears `target` so the wizard falls back to
 * its own entry-step resolution (the stepped `system-check` view on relaunch).
 * `closeSetupWizard` clears `target` too, so a later bare open never inherits
 * a stale deep link from a previous jump.
 *
 * Consumers: primary-nav-v2.tsx + command-palette.tsx + the dashboard setup
 * checklist card (open), __root.tsx (render).
 */
import { create } from 'zustand'
import type { OnboardingStepId } from '@/screens/onboarding/lib/onboarding-steps'
import { ONBOARDING_STEPS } from '@/screens/onboarding/lib/onboarding-steps'

const STEP_IDS = new Set<string>(ONBOARDING_STEPS.map((step) => step.id))

/**
 * Anything that is not a known step id becomes `null`.
 *
 * This is not defensive padding. `openSetupWizard` is passed straight to an
 * `onClick` in the sidebar, and React hands a click handler its event as the
 * first argument — so the store was receiving a `MouseEvent` as the deep-link
 * target. The wizard could not resolve that to a step and reconciled the user
 * onto the welcome fork instead of the read-only relaunch summary. Validating
 * here keeps that class of miswiring from reaching the wizard at all.
 */
function normalizeTarget(at: unknown): OnboardingStepId | null {
  return typeof at === 'string' && STEP_IDS.has(at)
    ? (at as OnboardingStepId)
    : null
}

export type SetupWizardState = {
  open: boolean
  target: OnboardingStepId | null
}

export type SetupWizardActions = {
  openSetupWizard: (at?: OnboardingStepId) => void
  closeSetupWizard: () => void
}

export const useSetupWizardStore = create<
  SetupWizardState & SetupWizardActions
>((set) => ({
  open: false,
  target: null,
  openSetupWizard: (at) => set({ open: true, target: normalizeTarget(at) }),
  closeSetupWizard: () => set({ open: false, target: null }),
}))
