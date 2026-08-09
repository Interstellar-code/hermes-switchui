'use client'

/**
 * theme-step.tsx — the optional "pick a theme" wizard step. A thin wrapper
 * over `ThemePicker`; matrix is the default theme, so on a fresh wizard
 * `selected` will usually already point at it.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { ThemePicker } from '../components/theme-picker'
import type { SetupFact } from '../lib/current-setup'
import type { ThemeId } from '@/lib/theme'
import { WizardPanel } from '@/components/wizard'

export type ThemeStepProps = {
  selected: ThemeId
  onSelect: (id: ThemeId) => void
  /** The theme already applied when the wizard opened. */
  current: ThemeId
  facts: Array<SetupFact>
}

export function ThemeStep({
  selected,
  onSelect,
  current,
  facts,
}: ThemeStepProps) {
  return (
    <WizardPanel>
      <CurrentSetupStrip facts={facts} />
      <ThemePicker selected={selected} onSelect={onSelect} current={current} />
    </WizardPanel>
  )
}
