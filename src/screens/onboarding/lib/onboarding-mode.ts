/**
 * onboarding-mode.ts — picks the wizard's entry point from three signals:
 * why it is being shown (`mode`), what storage remembers (`outcome`), and
 * whether the workspace already has a working provider. The precedence is a
 * strict priority list, not a merge, because the cases conflict on purpose —
 * a relaunch must win over an in-progress draft even though both could
 * technically apply, and a relaunch resuming into a half-finished first-run
 * draft would show a returning user someone else's abandoned flow.
 */
import type { OnboardingBranch, OnboardingStepId } from './onboarding-steps'
import type { OnboardingOutcome } from './onboarding-storage'

export type OnboardingMode = 'first-run' | 'resume' | 'relaunch'

export function resolveEntryStep(input: {
  mode: OnboardingMode
  outcome: OnboardingOutcome
  hasWorkingProvider: boolean
}): { stepId: OnboardingStepId; branch: OnboardingBranch } {
  // A relaunch lands on the first real step, regardless of what the draft or
  // outcome say. "Setup Wizard" in the sidebar is a settings surface for
  // someone who already has a working install: the summary was a landing page
  // they had to click through before they could reach the thing they opened
  // the wizard for. It is still in the step table and still reachable by deep
  // link (`openSetupWizard('summary')`) — it is just not the front door.
  if (input.mode === 'relaunch') {
    return { stepId: 'connect', branch: 'main' }
  }

  // A first run on an install that is already configured is not a first run in
  // any useful sense — somebody set this up outside the wizard. Land on the
  // read-only overview rather than walking them through choices already made.
  if (input.mode === 'first-run' && input.hasWorkingProvider) {
    return { stepId: 'summary', branch: 'summary' }
  }

  if (input.outcome.kind === 'in-progress') {
    return { stepId: input.outcome.stepId, branch: 'main' }
  }

  return { stepId: 'welcome', branch: 'main' }
}
