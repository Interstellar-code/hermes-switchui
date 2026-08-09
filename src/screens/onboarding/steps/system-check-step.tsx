'use client'

/**
 * system-check-step.tsx — the optional "system check" wizard step. Purely a
 * thin wrapper: `SystemCheckList` owns the row rendering, this step only
 * frames it with the one thing that matters — none of these checks can
 * block Next.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { SystemCheckList } from '../components/system-check-list'
import type { SetupFact } from '../lib/current-setup'
import type { SystemCheck } from '../lib/system-checks'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type SystemCheckStepProps = {
  checks: Array<SystemCheck>
  loading: boolean
  onHeal: (
    action: NonNullable<SystemCheck['heal']>,
    payload?: { gatewayUrl?: string },
  ) => void
  healing: string | null
  /**
   * The `canWriteConfig` verdict. The checks themselves are reads and always
   * run; the self-heal actions start the agent, re-probe the gateway and
   * restart it, so a locked relaunch renders none of them.
   */
  canWrite: boolean
  facts: Array<SetupFact>
}

export function SystemCheckStep({
  checks,
  loading,
  onHeal,
  healing,
  canWrite,
  facts,
}: SystemCheckStepProps) {
  return (
    <WizardPanel>
      <CurrentSetupStrip facts={facts} />
      <WizardNote>
        These checks are informational only, and nothing here blocks setup. On a
        portable or freshly started backend, any of them can come back unknown —
        that means the check could not tell, not that something is broken.
      </WizardNote>
      {!canWrite ? (
        <WizardNote tone="warn">
          Read-only for this run — the checks still run, but nothing here will
          start or restart anything. Choose &ldquo;Change setup&rdquo; on the
          summary first.
        </WizardNote>
      ) : null}
      <SystemCheckList
        checks={checks}
        loading={loading}
        onHeal={onHeal}
        healing={healing}
        readOnly={!canWrite}
      />
    </WizardPanel>
  )
}
