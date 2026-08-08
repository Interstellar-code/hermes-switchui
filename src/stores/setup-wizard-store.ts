/**
 * setup-wizard-store.ts — Zustand store for re-launching the setup wizard.
 *
 * The first-run wizard (claude-onboarding.tsx) normally gates itself on the
 * `claude-onboarding-complete` localStorage flag, which __root.tsx sets as soon
 * as /api/connection-status reports a working provider. This store lets the
 * sidebar re-open the same wizard on demand, in a controlled (relaunch) mode
 * that never writes provider config unless the user explicitly unlocks it.
 *
 * Consumers: primary-nav-v2.tsx + command-palette.tsx (open), __root.tsx (render).
 */
import { create } from 'zustand'

export type SetupWizardState = {
  open: boolean
}

export type SetupWizardActions = {
  openSetupWizard: () => void
  closeSetupWizard: () => void
}

export const useSetupWizardStore = create<
  SetupWizardState & SetupWizardActions
>((set) => ({
  open: false,
  openSetupWizard: () => set({ open: true }),
  closeSetupWizard: () => set({ open: false }),
}))
