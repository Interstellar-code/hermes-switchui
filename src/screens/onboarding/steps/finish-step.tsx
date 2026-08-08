'use client'

/**
 * finish-step.tsx — the last thing the wizard says.
 *
 * It reports what actually happened rather than congratulating: the same
 * checklist the summary renders, so anything skipped stays visible and one
 * click away, and the restart instruction when the gateway has not picked up
 * the new config yet.
 */
import { OnboardingChecklist } from '../components/onboarding-checklist'
import { outstandingCount } from '../lib/checklist'
import type { ChecklistItem } from '../lib/checklist'
import type { OnboardingStepId } from '../lib/onboarding-steps'
import { WizardPanel } from '@/components/wizard'

export type FinishStepProps = {
  items: Array<ChecklistItem>
  onJump: (stepId: OnboardingStepId) => void
  onOpenWorkspace: () => void
  needsRestart: boolean
}

function outcomeLine(items: Array<ChecklistItem>): string {
  const outstanding = outstandingCount(items)
  if (outstanding === 0) return 'Everything on the list is done.'
  return `${outstanding} item${outstanding === 1 ? '' : 's'} still open — you can finish them any time from the setup wizard.`
}

export function FinishStep({
  items,
  onJump,
  onOpenWorkspace,
  needsRestart,
}: FinishStepProps) {
  return (
    <div className="ob-finish">
      <h3 className="ob-finish-title">Setup complete</h3>
      <p>{outcomeLine(items)}</p>

      <OnboardingChecklist items={items} onJump={onJump} />

      {needsRestart ? (
        <WizardPanel heading="Restart the gateway">
          <p>
            The gateway reads ~/.hermes/config.yaml only at startup, so the
            provider you just saved stays invisible to it until it restarts.
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
