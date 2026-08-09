'use client'

/**
 * provider-step.tsx — the wizard's "pick a provider" step.
 *
 * Purely a leaf: it renders the picker and validation errors, and translates
 * a click into a patch. Switching providers resets every per-provider
 * transient field (`apiKey`, `baseUrl`, `defaultModel`) and re-seeds
 * `baseUrl`/`envKey` from the newly chosen `ProviderChoice` — otherwise a
 * previous provider's API key or base URL would silently carry over onto the
 * next one, which is exactly the kind of leak this rebuild exists to close.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { ProviderPicker } from '../components/provider-picker'
import type { SetupFact } from '../lib/current-setup'
import type {
  OnboardingDraft,
  OnboardingTransient,
} from '../lib/onboarding-storage'
import type { ProviderChoice } from '../lib/provider-choices'
import { WizardNote } from '@/components/wizard'

export type ProviderStepProps = {
  choices: Array<ProviderChoice>
  draft: OnboardingDraft & OnboardingTransient
  onChange: (patch: Partial<OnboardingDraft & OnboardingTransient>) => void
  errors: Array<string>
  detecting: boolean
  facts: Array<SetupFact>
  /** Marked and hoisted in the grid — see `ProviderPicker`. */
  activeProviderId: string | null
  configuredProviderIds: Array<string>
}

export function ProviderStep({
  choices,
  draft,
  onChange,
  errors,
  detecting,
  facts,
  activeProviderId,
  configuredProviderIds,
}: ProviderStepProps) {
  function handleSelect(id: string) {
    const choice = choices.find((candidate) => candidate.id === id) ?? null
    onChange({
      providerId: id,
      apiKey: '',
      baseUrl: choice?.baseUrl ?? '',
      envKey: choice?.envKey ?? '',
      defaultModel: '',
    })
  }

  return (
    <>
      <CurrentSetupStrip facts={facts} />
      {detecting ? (
        <WizardNote tone="info">Detecting local providers…</WizardNote>
      ) : null}
      <ProviderPicker
        choices={choices}
        selectedId={draft.providerId}
        onSelect={handleSelect}
        activeProviderId={activeProviderId}
        configuredProviderIds={configuredProviderIds}
      />
      {errors.map((error) => (
        <WizardNote tone="error" key={error}>
          {error}
        </WizardNote>
      ))}
    </>
  )
}
