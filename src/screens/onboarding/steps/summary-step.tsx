'use client'

/**
 * summary-step.tsx — the read-only overview a deep link can still land on.
 *
 * No longer the front door: a relaunch opens on the first real step, because
 * a returning user opening "Setup Wizard" already knows what they came for and
 * a landing page they have to click through is friction with nothing behind
 * it. It remains in the step table because the dashboard card, the palette and
 * `openSetupWizard('summary')` all point at it, and because a first run that
 * discovers an already-configured install has nothing better to show.
 *
 * It renders no control that writes. "Continue to setup" only navigates;
 * `canWriteConfig` still refuses on every step until the run is unlocked.
 */
import { OnboardingChecklist } from '../components/onboarding-checklist'
import type { ChecklistItem } from '../lib/checklist'
import type { OnboardingStepId } from '../lib/onboarding-steps'
import { WizardNote } from '@/components/wizard'

export type SummaryStepProps = {
  activeProvider: string | null
  activeModel: string | null
  /** `Online` / `Offline` / `Unknown`, derived by the caller. */
  connection: string
  /** Where the agent actually runs, when it is known. */
  agentCwd: string | null
  items: Array<ChecklistItem>
  onJump: (stepId: OnboardingStepId) => void
  onUnlock: () => void
  onClose: () => void
  locked: boolean
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
  connection,
  agentCwd,
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
        <Stat label="Connection" value={connection} />
        <Stat label="Agent runs in" value={agentCwd || 'Unknown'} />
      </div>

      <WizardNote tone={locked ? 'warn' : 'info'}>
        {locked
          ? 'Your existing setup is read-only here. Nothing is written to config.yaml or .env unless you choose Continue to setup first.'
          : 'Nothing on this screen writes. The provider step is the only one that touches config.yaml, and only when you press Save.'}
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
          {locked ? 'Change setup' : 'Continue to setup'}
        </button>
      </div>
    </div>
  )
}
