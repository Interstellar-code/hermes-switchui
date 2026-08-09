'use client'

/**
 * provider-credentials.tsx — whatever the chosen provider needs to connect.
 *
 * Lifted verbatim out of the old `connect-step`, which was a step of its own
 * between "choose a provider" and "review what will be written". Those three
 * screens are one screen now (see `onboarding-steps.ts`), so this is a
 * component rather than a step — but the branching is unchanged, because it
 * was right: it branches purely on `choice.authKind`, and it never writes
 * anything. It only edits the transient draft via `onChange`; the write is
 * still gated behind `useOnboardingSave` (see CLAUDE.md's write-path rule).
 *
 * What is new is `originNote`: where the credential the gateway will actually
 * resolve lives today. `hasStoredKey` was a boolean, and a boolean is exactly
 * what `/api/credentials` exists to stop us rendering.
 */
import { useEffect, useRef, useState } from 'react'
import { useOnboardingModels } from '../hooks/use-onboarding-models'
import type {
  OnboardingDraft,
  OnboardingTransient,
} from '../lib/onboarding-storage'
import type { ProviderChoice } from '../lib/provider-choices'
import {
  WizardField,
  WizardFieldRow,
  WizardNote,
  WizardPanel,
} from '@/components/wizard'
import { writeTextToClipboard } from '@/lib/clipboard'
import { useNousOAuth } from '@/screens/providers/hooks/use-nous-oauth'

export type ProviderCredentialsProps = {
  choice: ProviderChoice
  draft: OnboardingDraft & OnboardingTransient
  onChange: (patch: Partial<OnboardingDraft & OnboardingTransient>) => void
  hasStoredKey: boolean
  /**
   * False during a locked relaunch. Editing the draft is always safe — it is
   * never persisted in relaunch mode — but the OAuth device flow is not a
   * draft edit: it writes tokens into the gateway's auth store the moment the
   * user approves. A screen that promises the existing setup is read-only must
   * not offer it.
   */
  canWrite: boolean
  /**
   * The env var already holding this provider's credential, or `auth-store`
   * for one the gateway holds itself. `hasStoredKey` only ever reached the
   * API-key branch, so an OAuth or CLI provider with a live credential was
   * shown a screen that read exactly like a first-time sign-in.
   */
  storedKeyEnv: string | null
  /**
   * A sentence about credential provenance from `/api/credentials`, when there
   * is one worth showing — "resolves from the pool, not from .env" is the case
   * a stored-key boolean can never express.
   */
  originNote: string | null
}

/** How a stored credential is described, given where it lives. */
function credentialLocation(env: string): string {
  return env === 'auth-store' ? 'the gateway auth store' : env
}

/** The model selector, always rendered — a `<select>` when the backend
 * exposes `/v1/models`, otherwise a free-text fallback. */
function ModelField({
  choice,
  draft,
  onChange,
}: {
  choice: ProviderChoice
  draft: OnboardingDraft & OnboardingTransient
  onChange: ProviderCredentialsProps['onChange']
}) {
  const { models, loading, error, refetch } = useOnboardingModels({
    enabled: true,
    providerId: choice.id,
  })

  return (
    <WizardField
      label="Default model"
      hint={
        loading
          ? 'Loading models…'
          : models.length > 0
            ? 'Fetched from this backend.'
            : 'This backend does not expose /v1/models — type the model name to use.'
      }
      error={
        error ? (
          <>
            Could not load models ({error}).{' '}
            <button type="button" className="wz-btn" onClick={refetch}>
              Retry
            </button>
          </>
        ) : undefined
      }
    >
      {(fieldProps) =>
        models.length > 0 ? (
          <select
            {...fieldProps}
            value={draft.defaultModel}
            onChange={(event) => onChange({ defaultModel: event.target.value })}
          >
            <option value="">Choose a model…</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...fieldProps}
            type="text"
            value={draft.defaultModel}
            onChange={(event) => onChange({ defaultModel: event.target.value })}
            placeholder="e.g. gpt-4.1"
          />
        )
      }
    </WizardField>
  )
}

export function ProviderCredentials({
  choice,
  draft,
  onChange,
  hasStoredKey,
  canWrite,
  storedKeyEnv,
  originNote,
}: ProviderCredentialsProps) {
  const oauth = useNousOAuth()
  const [copiedCli, setCopiedCli] = useState(false)
  // The "Copied" reset is a timer, so it outlives an unmount unless cleared.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The providers dialog only resets this hook when it opens; onboarding
  // reuses one long-lived instance across provider switches, so it has to
  // reset on every `choice.id` change or a stale OAuth session leaks across
  // providers.
  useEffect(() => {
    oauth.reset()
  }, [choice.id])

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    },
    [],
  )

  async function copyCliCommand(command: string) {
    try {
      await writeTextToClipboard(command)
      setCopiedCli(true)
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedCli(false), 1800)
    } catch {
      // Clipboard unavailable — the command is still visible to copy by hand.
    }
  }

  const cliCommand = choice.cliCommand

  return (
    <div className="ob-connect">
      {originNote ? <WizardNote tone="warn">{originNote}</WizardNote> : null}

      {/* The API-key branch says this in its own field hint; every other auth
          kind has no field to hang it on, so it gets stated outright. */}
      {choice.authKind !== 'api-key' && storedKeyEnv ? (
        <WizardNote tone="ok">
          {choice.name} already has a credential stored in{' '}
          {credentialLocation(storedKeyEnv)}. Continue to keep using it, or sign
          in again to replace it.
        </WizardNote>
      ) : null}

      {choice.authKind === 'oauth' && choice.supportsOAuth && !canWrite ? (
        <WizardNote>
          Signing in to {choice.name} would replace the credentials this
          workspace already uses, and this run is read-only.
        </WizardNote>
      ) : null}

      {choice.authKind === 'oauth' && choice.supportsOAuth && canWrite ? (
        <div className="ob-oauth">
          {oauth.stage === 'idle' || oauth.stage === 'error' ? (
            <>
              {oauth.error ? (
                <WizardNote tone="error">{oauth.error}</WizardNote>
              ) : null}
              <button
                type="button"
                className="wz-btn wz-btn-primary"
                onClick={() => void oauth.start(choice.id)}
              >
                {oauth.stage === 'error'
                  ? 'Retry sign-in'
                  : `Connect with ${choice.name}`}
              </button>
            </>
          ) : null}
          {oauth.stage === 'starting' ? (
            <p role="status">Starting sign-in…</p>
          ) : null}
          {/* A live region, because the code appears without the user doing
              anything and is the one thing they have to read off the screen.
              The visible copy is hidden from assistive tech in favour of a
              spelled-out one: read as a word, an eight-character code is
              unusable, and `aria-label` on a `<p>` is not reliably honoured. */}
          {oauth.stage === 'waiting' ? (
            <div className="ob-oauth-wait" role="status">
              <p>Enter this code at the portal:</p>
              <p className="ob-oauth-code" aria-hidden="true">
                {oauth.userCode}
              </p>
              <span className="wz-sr">
                Code: {oauth.userCode.split('').join(' ')}
              </span>
              {oauth.verificationUrl ? (
                <button
                  type="button"
                  className="wz-btn"
                  onClick={() =>
                    window.open(oauth.verificationUrl, '_blank', 'noopener')
                  }
                >
                  Open portal
                </button>
              ) : null}
              <p>Waiting for approval…</p>
            </div>
          ) : null}
          {oauth.stage === 'success' ? (
            <WizardNote tone="ok">
              Signed in. The credential is stored by the gateway.
            </WizardNote>
          ) : null}
        </div>
      ) : null}

      {choice.authKind === 'oauth' && !choice.supportsOAuth ? (
        <WizardNote tone="warn">
          {choice.name} signs in through OAuth, but the gateway only implements
          the device-code flow for Nous Portal today. Sign in outside Hermes
          Switch UI, then continue — the credential is detected automatically.
        </WizardNote>
      ) : null}

      {choice.authKind === 'cli-token' && cliCommand ? (
        <WizardPanel heading="Sign in from a terminal">
          <p>
            {choice.name} authenticates through the CLI — the gateway has no
            device-code flow for it. Run this, then continue:
          </p>
          <pre className="ob-cli" tabIndex={0}>
            {cliCommand}
          </pre>
          <button
            type="button"
            className="wz-btn"
            onClick={() => void copyCliCommand(cliCommand)}
          >
            {copiedCli ? 'Copied' : 'Copy command'}
          </button>
          {/* The button's own label changing is not reliably announced while
              it holds focus; this region is. */}
          <span className="wz-sr" role="status">
            {copiedCli ? 'Command copied to the clipboard.' : ''}
          </span>
        </WizardPanel>
      ) : null}

      {choice.authKind === 'api-key' ? (
        <WizardFieldRow>
          {choice.baseUrl === null ? (
            <WizardField label="Base URL" htmlFor="ob-connect-base-url">
              {(fieldProps) => (
                <input
                  {...fieldProps}
                  type="text"
                  value={draft.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) =>
                    onChange({ baseUrl: event.target.value })
                  }
                />
              )}
            </WizardField>
          ) : null}
          <WizardField
            label="API key"
            hint={
              storedKeyEnv
                ? `A key is already stored in ${credentialLocation(storedKeyEnv)} — leave blank to keep it.`
                : hasStoredKey
                  ? 'Leave blank to keep the existing key.'
                  : undefined
            }
            htmlFor="ob-connect-api-key"
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="password"
                value={draft.apiKey ?? ''}
                placeholder={hasStoredKey ? 'unchanged' : 'sk-…'}
                onChange={(event) => onChange({ apiKey: event.target.value })}
              />
            )}
          </WizardField>
        </WizardFieldRow>
      ) : null}

      {choice.authKind === 'local' ? (
        <WizardField
          label="Base URL"
          hint={`${choice.name} runs locally — make sure it is started before continuing.`}
          htmlFor="ob-connect-base-url"
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="text"
              value={draft.baseUrl}
              placeholder={choice.baseUrl ?? 'http://127.0.0.1:11434/v1'}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
            />
          )}
        </WizardField>
      ) : null}

      <ModelField choice={choice} draft={draft} onChange={onChange} />
    </div>
  )
}
