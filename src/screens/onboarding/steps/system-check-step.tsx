'use client'

/**
 * system-check-step.tsx — the optional "system check" wizard step. Purely a
 * thin wrapper: `SystemCheckList` owns the row rendering, this step only
 * frames it with the one thing that matters — none of these checks can
 * block Next.
 */
import { SystemCheckList } from '../components/system-check-list'
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
}

export function SystemCheckStep({
  checks,
  loading,
  onHeal,
  healing,
}: SystemCheckStepProps) {
  return (
    <WizardPanel>
      <WizardNote>
        These checks are informational only, and nothing here blocks setup. On a
        portable or freshly started backend, any of them can come back unknown —
        that means the check could not tell, not that something is broken.
      </WizardNote>
      <SystemCheckList
        checks={checks}
        loading={loading}
        onHeal={onHeal}
        healing={healing}
      />
    </WizardPanel>
  )
}
