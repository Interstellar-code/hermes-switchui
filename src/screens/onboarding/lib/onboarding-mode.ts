/**
 * onboarding-mode.ts — picks the wizard's entry point from three signals:
 * why it is being shown (`mode`), what storage remembers (`outcome`), and
 * whether the workspace already has a working provider. The precedence is a
 * strict priority list, not a merge, because the cases conflict on purpose —
 * a relaunch must win over an in-progress draft even though both could
 * technically apply, and getting that order wrong is exactly how a relaunch
 * would end up silently resuming into a write-capable step.
 */
import type { OnboardingBranch, OnboardingStepId } from './onboarding-steps'
import type { OnboardingOutcome } from './onboarding-storage'

export type OnboardingMode = 'first-run' | 'resume' | 'relaunch'

export function resolveEntryStep(input: {
  mode: OnboardingMode
  outcome: OnboardingOutcome
  hasWorkingProvider: boolean
}): { stepId: OnboardingStepId; branch: OnboardingBranch } {
  // Non-negotiable: a relaunch always lands on the read-only summary,
  // regardless of what the draft or outcome say. See relaunch-lock.ts for
  // the write-side half of this contract.
  if (input.mode === 'relaunch') {
    return { stepId: 'summary', branch: 'summary' }
  }

  if (input.mode === 'first-run' && input.hasWorkingProvider) {
    return { stepId: 'summary', branch: 'summary' }
  }

  if (input.outcome.kind === 'in-progress') {
    return { stepId: input.outcome.stepId, branch: input.outcome.branch }
  }

  return { stepId: 'welcome', branch: 'quick' }
}
