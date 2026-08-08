'use client'

/**
 * summary-step.tsx — where a returning user (and every relaunch) lands.
 *
 * This step is the relaunch write-lock made visible. While `locked` it
 * renders no control that can write config: not a Save, not a toggle, not a
 * field. "Change setup" only calls `onUnlock`, which flips the lock and drops
 * the user into the editable flow — it writes nothing by itself, and the copy
 * says so, because a screen that shows a working configuration next to a
 * button is exactly where a user assumes the button will overwrite it.
 *
 * The checklist's "Open" buttons navigate; navigation is not a write, and
 * `canWriteConfig` keeps refusing on every step until the unlock happens.
 */
import { OnboardingChecklist } from '../components/onboarding-checklist'
import type { ChecklistItem } from '../lib/checklist'
import type { OnboardingStepId } from '../lib/onboarding-steps'
import type { SystemCheck } from '../lib/system-checks'
import { WizardNote } from '@/components/wizard'

export type SummaryStepProps = {
  activeProvider: string | null
  activeModel: string | null
  checks: Array<SystemCheck>
  items: Array<ChecklistItem>
  onJump: (stepId: OnboardingStepId) => void
  onUnlock: () => void
  onClose: () => void
  locked: boolean
}

/**
 * The gateway check is the one that answers "is this setup actually live".
 * Anything short of a definite answer reads as `Unknown`, never as broken —
 * the same rule `system-checks.ts` applies to the checks themselves.
 */
function connectionLabel(checks: Array<SystemCheck>): string {
  const gateway = checks.find((check) => check.id === 'gateway')
  if (!gateway) return 'Unknown'
  if (gateway.status === 'ok') return 'Online'
  if (gateway.status === 'fail') return 'Offline'
  return 'Unknown'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ob-stat">
      <span className="ob-stat-label">{label}</span>
      <span className="ob-stat-value">{value}</span>
    </div>
  )
}

export function SummaryStep({
  activeProvider,
  activeModel,
  checks,
  items,
  onJump,
  onUnlock,
  onClose,
  locked,
}: SummaryStepProps) {
  return (
    <div className="ob-summary">
      <div className="ob-summary-grid">
        <Stat label="Provider" value={activeProvider || 'None'} />
        <Stat label="Model" value={activeModel || 'None'} />
        <Stat label="Connection" value={connectionLabel(checks)} />
      </div>

      <WizardNote tone={locked ? 'warn' : 'info'}>
        {locked
          ? 'Your existing setup is read-only here. Nothing is written to config.yaml or .env unless you choose Change setup first.'
          : 'Changes are unlocked for this run. Saving on the review step will write to config.yaml.'}
      </WizardNote>

      <OnboardingChecklist items={items} onJump={onJump} />

      <div className="ob-summary-actions">
        <button type="button" className="wz-btn" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="wz-btn wz-btn-primary"
          onClick={onUnlock}
        >
          Change setup
        </button>
      </div>
    </div>
  )
}
