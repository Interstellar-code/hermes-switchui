/**
 * The onboarding screen's public surface.
 *
 * `__root.tsx` mounts the wizard *and* reads the completion flag, so both
 * come from here rather than from a component path plus a lib path — the
 * storage keys are part of this screen's contract with the rest of the app,
 * not an implementation detail callers should reach past the barrel for.
 */
export { OnboardingScreen } from './onboarding-screen'
export type { OnboardingScreenProps } from './onboarding-screen'

export {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
} from './lib/onboarding-storage'
