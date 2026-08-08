/**
 * setup-wizard-store.ts — Zustand store for re-launching the setup wizard.
 *
 * The first-run wizard (`src/screens/onboarding/onboarding-screen.tsx`) gates
 * itself on the `claude-onboarding-complete` localStorage flag. This store lets
 * the sidebar re-open the same wizard on demand, in a controlled (relaunch)
 * mode that opens read-only and writes no provider config until the user
 * explicitly unlocks it.
 *
 * `target` carries an optional deep link: the sidebar badge, the command
 * palette, and the dashboard checklist card can all jump straight to a
 * specific step (`openSetupWizard('provider')`) instead of landing on the
 * relaunch summary. A bare `openSetupWizard()` call clears `target` so the
 * wizard falls back to its own entry-step resolution (always the summary on
 * relaunch). `closeSetupWizard` clears `target` too, so a later bare open
 * never inherits a stale deep link from a previous jump.
 *
 * Consumers: primary-nav-v2.tsx + command-palette.tsx + the dashboard setup
 * checklist card (open), __root.tsx (render).
 */
import { create } from 'zustand'
import type { OnboardingStepId } from '@/screens/onboarding/lib/onboarding-steps'

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
  openSetupWizard: (at) => set({ open: true, target: at ?? null }),
  closeSetupWizard: () => set({ open: false, target: null }),
}))
