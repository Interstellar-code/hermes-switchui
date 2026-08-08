/**
 * setup-wizard-store.ts — Zustand store for re-launching the setup wizard.
 *
 * The first-run wizard (`src/screens/onboarding/onboarding-screen.tsx`) gates
 * itself on the `claude-onboarding-complete` localStorage flag. This store lets
 * the sidebar re-open the same wizard on demand, in a controlled (relaunch)
 * mode that opens read-only and writes no provider config until the user
 * explicitly unlocks it.
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
