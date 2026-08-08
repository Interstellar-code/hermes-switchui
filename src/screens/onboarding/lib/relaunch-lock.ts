/**
 * relaunch-lock.ts — the single gate every config-write path in the wizard
 * must consult before touching config.yaml or .env. A relaunch opens on an
 * already-working setup, so the default has to be "look, don't touch": an
 * idle curiosity click-through must not be able to overwrite a provider that
 * was working fine before the user opened the wizard again. First-run and
 * resume carry no such risk — there is nothing yet to protect — so they stay
 * open on every step.
 */
import type { OnboardingStepId } from './onboarding-steps'
import type { OnboardingMode } from './onboarding-mode'

export function canWriteConfig(input: {
  mode: OnboardingMode
  unlocked: boolean
  stepId: OnboardingStepId
}): boolean {
  if (input.mode !== 'relaunch') return true

  // The summary step renders no write control at all — so even an unlocked
  // relaunch cannot write from here. Locking it structurally, rather than
  // relying on the summary screen simply not offering a button, means a
  // future UI bug that adds one still cannot write.
  if (input.stepId === 'summary') return false

  return input.unlocked
}
