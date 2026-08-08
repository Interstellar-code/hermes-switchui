'use client'

/**
 * theme-step.tsx — the optional "pick a theme" wizard step. A thin wrapper
 * over `ThemePicker`; matrix is the default theme, so on a fresh wizard
 * `selected` will usually already point at it.
 */
import { ThemePicker } from '../components/theme-picker'
import type { ThemeId } from '@/lib/theme'
import { WizardPanel } from '@/components/wizard'

export type ThemeStepProps = {
  selected: ThemeId
  onSelect: (id: ThemeId) => void
}

export function ThemeStep({ selected, onSelect }: ThemeStepProps) {
  return (
    <WizardPanel>
      <ThemePicker selected={selected} onSelect={onSelect} />
    </WizardPanel>
  )
}
