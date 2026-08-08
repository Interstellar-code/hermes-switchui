'use client'

/**
 * review-step.tsx — "here is exactly what Save will write."
 *
 * The only step allowed to trigger a write, and even then only through the
 * `onSave` prop — the actual mutation lives in `useOnboardingSave` (a later
 * phase), so a relaunched wizard can never clobber a working config.yaml
 * just by being clicked through. This component only ever reads the draft to
 * build a preview.
 */
import { buildOnboardingYamlPreview } from '../lib/onboarding-write'
import type {
  OnboardingDraft,
  OnboardingTransient,
} from '../lib/onboarding-storage'
import type { ProviderChoice } from '../lib/provider-choices'
import { WizardNote, WizardReview } from '@/components/wizard'

export type ReviewStepProps = {
  choice: ProviderChoice
  draft: OnboardingDraft & OnboardingTransient
  canWrite: boolean
  saving: boolean
  saveError: string | null
  saved: boolean
  onSave: () => void
}

export function ReviewStep({
  choice,
  draft,
  canWrite,
  saving,
  saveError,
  saved,
  onSave,
}: ReviewStepProps) {
  const preview = buildOnboardingYamlPreview({
    choice,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey ?? '',
    defaultModel: draft.defaultModel,
    makeActive: draft.makeActive,
  })

  const notes: Array<{
    tone: 'info' | 'warn' | 'error' | 'ok'
    text: string
  }> = []

  if (choice.authKind === 'api-key' && !preview.env) {
    notes.push({
      tone: 'warn',
      text: 'No API key is being written — the provider will be saved but cannot authenticate until you add one.',
    })
  }
  if (!canWrite) {
    notes.push({
      tone: 'warn',
      text: 'Changes are locked for this run — this preview shows what would be written, but Save will not touch config.yaml.',
    })
  }
  if (saveError) {
    notes.push({ tone: 'error', text: saveError })
  }

  return (
    <div className="ob-review">
      <WizardReview
        target="~/.hermes/config.yaml"
        preview={preview.config}
        extras={
          preview.env
            ? [{ target: '~/.hermes/.env', preview: preview.env }]
            : []
        }
        notes={notes}
      />
      {saved ? (
        <WizardNote tone="ok">
          Saved. Your configuration has been written.
        </WizardNote>
      ) : (
        <button
          type="button"
          className="wz-btn wz-btn-primary"
          disabled={saving || !canWrite}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  )
}
