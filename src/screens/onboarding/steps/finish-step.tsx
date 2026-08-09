'use client'

/**
 * finish-step.tsx — the last thing the wizard says.
 *
 * It reports what actually happened rather than congratulating: the same
 * checklist the summary renders, so anything skipped stays visible and one
 * click away. The headline is a function of the *required* four, not of the
 * whole list — "Setup complete" over an install that cannot answer a message
 * is the claim this rebuild exists to stop making.
 */
import { OnboardingChecklist } from '../components/onboarding-checklist'
import { outstandingCount, outstandingRequiredCount } from '../lib/checklist'
import type { ChecklistItem } from '../lib/checklist'
import type { OnboardingStepId } from '../lib/onboarding-steps'
import { WizardPanel } from '@/components/wizard'

export type FinishStepProps = {
  items: Array<ChecklistItem>
  onJump: (stepId: OnboardingStepId) => void
  onOpenWorkspace: () => void
  /** A real completion succeeded during this run. */
  chatProven: boolean
  needsRestart: boolean
}

export function FinishStep({
  items,
  onJump,
  onOpenWorkspace,
  chatProven,
  needsRestart,
}: FinishStepProps) {
  const outstanding = outstandingCount(items)
  const requiredLeft = outstandingRequiredCount(items)
  const title = chatProven ? 'Your agent works' : 'Setup is incomplete'
  const lead = chatProven
    ? outstanding === 0
      ? 'Everything on the list is done.'
      : `${outstanding} optional item${outstanding === 1 ? '' : 's'} left — you can finish them any time from the setup wizard.`
    : `${requiredLeft} of the four required steps ${requiredLeft === 1 ? 'is' : 'are'} still open. Chat will not work until they are.`

  return (
    <div className="ob-finish">
      <h3 className="ob-finish-title">{title}</h3>
      <p>{lead}</p>

      <OnboardingChecklist items={items} onJump={onJump} />

      {needsRestart ? (
        <WizardPanel heading="Restart the gateway">
          <p>
            The gateway reads ~/.hermes/config.yaml only at startup, so what you
            just saved stays invisible to it until it restarts.
          </p>
          <pre className="ob-cli">pnpm start:all</pre>
        </WizardPanel>
      ) : null}

      <button
        type="button"
        className="wz-btn wz-btn-primary"
        onClick={onOpenWorkspace}
      >
        Open workspace
      </button>
    </div>
  )
}
