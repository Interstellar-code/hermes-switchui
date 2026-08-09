'use client'

/**
 * provider-step.tsx — step 2 of 4: choose a provider, supply what it needs,
 * write it, and prove it with one real call.
 *
 * This is four of the old steps in one screen (provider, connect, review,
 * verify), and the merge is the point rather than a tidy-up. The old flow let
 * a user pass "review" — which showed the YAML and wrote it — and then treated
 * a *free* models poll as verification, with the one check that proves the
 * credential resolved hidden behind an opt-in button two steps later. So the
 * wizard said "Saved" about providers that 401 on first use.
 *
 * Now Save and verify are one action: `verifyProviderAfterSave` polls for
 * resolution and then issues a real completion, and a failure shows the
 * gateway's own words. `credentialFailed` is reported separately from a
 * resolution failure because the remedies are opposite — one wants a gateway
 * restart, the other wants the key looked at.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { ProviderCredentials } from '../components/provider-credentials'
import { ProviderPicker } from '../components/provider-picker'
import { DOCS } from '../lib/docs-links'
import { buildOnboardingYamlPreview } from '../lib/onboarding-write'
import type { SetupFact } from '../lib/current-setup'
import type { OllamaContextVerdict } from '../lib/ollama-context'
import type {
  OnboardingDraft,
  OnboardingTransient,
} from '../lib/onboarding-storage'
import type { ProviderChoice } from '../lib/provider-choices'
import type { PostSaveVerification } from '@/screens/providers/lib/verify-provider'
import { WizardNote, WizardPanel, WizardReview } from '@/components/wizard'

export type ProviderStepProps = {
  choices: Array<ProviderChoice>
  choice: ProviderChoice | null
  draft: OnboardingDraft & OnboardingTransient
  onChange: (patch: Partial<OnboardingDraft & OnboardingTransient>) => void
  errors: Array<string>
  facts: Array<SetupFact>
  activeProviderId: string | null
  configuredProviderIds: Array<string>
  hasStoredKey: boolean
  storedKeyEnv: string | null
  originNote: string | null
  canWrite: boolean
  saving: boolean
  saveError: string | null
  saved: boolean
  onSave: () => void
  verifying: boolean
  verification: PostSaveVerification | null
  canRestart: boolean
  restarting: boolean
  onRestart: () => void
  ollama: OllamaContextVerdict
}

function VerificationReport({
  verification,
  verifying,
  canRestart,
  restarting,
  onRestart,
}: {
  verification: PostSaveVerification | null
  verifying: boolean
  canRestart: boolean
  restarting: boolean
  onRestart: () => void
}) {
  if (verifying) {
    return (
      <div className="ob-verify-state" role="status">
        Asking the gateway whether it can see this provider, then sending one
        real completion…
      </div>
    )
  }
  if (!verification) return null

  const { resolution, live, credentialFailed } = verification

  if (resolution.status !== 'confirmed') {
    return (
      <>
        <div className="ob-verify-state is-pending" role="status">
          <span className="wz-sr">Not confirmed. </span>
          {resolution.message}
        </div>
        {canRestart ? (
          <WizardPanel heading="Gateway restart">
            <p>
              The gateway reads ~/.hermes/config.yaml only at startup, so a new
              provider stays invisible until it restarts.
            </p>
            <button
              type="button"
              className="wz-btn wz-btn-primary"
              disabled={restarting}
              onClick={onRestart}
            >
              {restarting ? 'Restarting…' : 'Restart gateway now'}
            </button>
          </WizardPanel>
        ) : (
          <WizardPanel heading="Restart manually">
            <p>
              The dashboard is not reachable, so restart the gateway from a
              terminal instead:
            </p>
            <pre className="ob-cli">pnpm start:all</pre>
            <pre className="ob-cli">hermes gateway run</pre>
          </WizardPanel>
        )}
      </>
    )
  }

  if (live && !live.ok) {
    return (
      <>
        <div className="ob-verify-state is-missing" role="status">
          <span className="wz-sr">Failed. </span>
          The gateway sees this provider, but the call failed.
        </div>
        {/* Verbatim, in a pre: a paraphrase of "invalid_api_key" helps nobody,
            and the exact string is what a user searches for. */}
        <WizardPanel heading="What the gateway said">
          <pre className="ob-cli" tabIndex={0}>
            {live.gatewayError ?? live.message}
          </pre>
          {credentialFailed ? (
            <p>
              That reads as a credential problem rather than an outage. The key
              may be missing, expired, or shadowed by a second copy in a store
              that outranks the one you just edited — the Connect step reports
              which store the gateway actually resolves.
            </p>
          ) : (
            <p>
              The provider was reachable and refused the request. Restarting the
              gateway will not change this.
            </p>
          )}
        </WizardPanel>
      </>
    )
  }

  return (
    <div className="ob-verify-state is-confirmed" role="status">
      <span className="wz-sr">Verified. </span>
      {resolution.message}
      {live?.ok ? ' It answered a real prompt.' : ''}
    </div>
  )
}

export function ProviderStep({
  choices,
  choice,
  draft,
  onChange,
  errors,
  facts,
  activeProviderId,
  configuredProviderIds,
  hasStoredKey,
  storedKeyEnv,
  originNote,
  canWrite,
  saving,
  saveError,
  saved,
  onSave,
  verifying,
  verification,
  canRestart,
  restarting,
  onRestart,
  ollama,
}: ProviderStepProps) {
  function handleSelect(id: string) {
    const next = choices.find((candidate) => candidate.id === id) ?? null
    onChange({
      providerId: id,
      apiKey: '',
      baseUrl: next?.baseUrl ?? '',
      envKey: next?.envKey ?? '',
      defaultModel: '',
    })
  }

  const preview = choice
    ? buildOnboardingYamlPreview({
        choice,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey ?? '',
        defaultModel: draft.defaultModel,
        makeActive: draft.makeActive,
      })
    : null

  const reviewNotes: Array<{
    tone: 'info' | 'warn' | 'error' | 'ok'
    text: string
  }> = []
  if (choice?.authKind === 'api-key' && preview && !preview.env) {
    reviewNotes.push({
      tone: 'warn',
      text: 'No API key is being written — the provider will be saved but cannot authenticate until you add one.',
    })
  }
  if (!canWrite) {
    reviewNotes.push({
      tone: 'warn',
      text: 'Changes are locked for this run — this preview shows what would be written, but Save will not touch config.yaml.',
    })
  }
  if (saveError) reviewNotes.push({ tone: 'error', text: saveError })

  return (
    <>
      <CurrentSetupStrip facts={facts} />

      <ProviderPicker
        choices={choices}
        selectedId={draft.providerId}
        onSelect={handleSelect}
        activeProviderId={activeProviderId}
        configuredProviderIds={configuredProviderIds}
      />

      {choice ? (
        <>
          <ProviderCredentials
            choice={choice}
            draft={draft}
            onChange={onChange}
            hasStoredKey={hasStoredKey}
            canWrite={canWrite}
            storedKeyEnv={storedKeyEnv}
            originNote={originNote}
          />

          {/* Raised here rather than after the first chat fails: the docs call
              this the single most common source of local-model confusion, and
              the failure it causes is a startup rejection, not a bad answer. */}
          {ollama.kind === 'below-minimum' || ollama.kind === 'unconfigured' ? (
            <WizardPanel heading="Check the context window first">
              <p>{ollama.message}</p>
              <ul>
                {ollama.fixes.map((fix) => (
                  <li key={fix}>{fix}</li>
                ))}
              </ul>
              <p>
                <a href={DOCS.ollama} target="_blank" rel="noreferrer noopener">
                  Ollama setup guide
                </a>{' '}
                ·{' '}
                <a href={DOCS.faq} target="_blank" rel="noreferrer noopener">
                  why /api/show cannot answer this
                </a>
              </p>
            </WizardPanel>
          ) : null}

          {preview ? (
            <WizardReview
              target="~/.hermes/config.yaml"
              preview={preview.config}
              extras={
                preview.env
                  ? [{ target: '~/.hermes/.env', preview: preview.env }]
                  : []
              }
              notes={reviewNotes}
            />
          ) : null}

          <div className="ob-verify-actions">
            <button
              type="button"
              className="wz-btn wz-btn-primary"
              disabled={saving || verifying || !canWrite}
              onClick={onSave}
            >
              {saving
                ? 'Saving…'
                : verifying
                  ? 'Verifying…'
                  : saved
                    ? 'Save and verify again'
                    : 'Save and verify'}
            </button>
          </div>

          <VerificationReport
            verification={verification}
            verifying={verifying}
            canRestart={canRestart}
            restarting={restarting}
            onRestart={onRestart}
          />
        </>
      ) : (
        <WizardNote>
          Pick a provider to see exactly what will be written and to test it.{' '}
          <a href={DOCS.providers} target="_blank" rel="noreferrer noopener">
            Every supported provider is listed in the docs
          </a>
          .
        </WizardNote>
      )}

      {errors.map((error) => (
        <WizardNote tone="error" key={error}>
          {error}
        </WizardNote>
      ))}
    </>
  )
}
