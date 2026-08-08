'use client'

/**
 * provider-wizard-dialog.tsx — Choose → Connect → Review & Save.
 *
 * Exactly one write happens, on the Review step, using the pure builders in
 * ../lib/write-paths. The review shows the literal YAML about to be applied so
 * nothing is written that the user has not seen — the previous wizard wrote a
 * shape (`auth.profiles.*`) that nothing read, to a route that did not exist.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { isOAuthSupported, useNousOAuth } from '../hooks/use-nous-oauth'
import { useProviderMutations } from '../hooks/use-provider-mutations'
import {
  sendLiveTestPrompt,
  verifyProviderVisible,
} from '../lib/verify-provider'
import { ProviderWriteError } from '../lib/write-paths'
import type { LiveTestOutcome, VerifyOutcome } from '../lib/verify-provider'
import type { ProviderView } from '../lib/provider-view'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import {
  PROVIDER_CATALOG,
  getProviderBaseUrl,
  getProviderEnvKey,
} from '@/lib/provider-catalog'
import { toast } from '@/components/ui/toast'
import '@/styles/matrix-providers.css'

type Step = 'choose' | 'connect' | 'review' | 'verify'

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'choose', label: 'Choose provider' },
  { id: 'connect', label: 'Connect' },
  { id: 'review', label: 'Review & save' },
  { id: 'verify', label: 'Verify' },
]

type Props = {
  open: boolean
  /** Pre-selected provider id, or null to start at the picker. */
  providerId: string | null
  views: Array<ProviderView>
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

/** Renders the config.yaml fragment the save will merge in. */
function buildYamlPreview(input: {
  id: string
  baseUrl: string
  envKey: string
  makeActive: boolean
  defaultModel: string
  inline: boolean
}): string {
  if (input.inline) {
    return [
      'model:',
      `  provider: ${input.id}`,
      input.baseUrl ? `  base_url: ${input.baseUrl}` : null,
      input.defaultModel ? `  default: ${input.defaultModel}` : null,
      '  api_key: ********',
    ]
      .filter(Boolean)
      .join('\n')
  }

  const lines = [
    'providers:',
    `  ${input.id}:`,
    '    type: openai',
    input.baseUrl ? `    base_url: ${input.baseUrl}` : null,
    input.envKey ? `    key_env: ${input.envKey}` : null,
  ].filter(Boolean)

  if (input.makeActive) {
    lines.push(
      'model:',
      `  provider: ${input.id}`,
      `  default: ${input.defaultModel || 'auto'}`,
    )
  }
  return lines.join('\n')
}

export function ProviderWizardDialog({
  open,
  providerId,
  views,
  onOpenChange,
  onSaved,
}: Props) {
  const { saveProvider, restartGateway } = useProviderMutations()

  const [step, setStep] = useState<Step>('choose')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [envKey, setEnvKey] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [makeActive, setMakeActive] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyOutcome | null>(null)
  const [liveResult, setLiveResult] = useState<LiveTestOutcome | null>(null)
  const [liveTesting, setLiveTesting] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const oauth = useNousOAuth()
  // Verification polls for up to 20s; it must not outlive the dialog.
  const verifyAbort = useRef<AbortController | null>(null)

  const selected = useMemo(
    () => views.find((candidate) => candidate.id === selectedId) ?? null,
    [views, selectedId],
  )

  // Providers you can add, plus anything already configured (for editing).
  const choices = useMemo(
    () => [...views].sort((a, b) => a.name.localeCompare(b.name)),
    [views],
  )

  // Re-seed each time the dialog opens so a previous run never leaks state.
  useEffect(() => {
    if (!open) return
    setSaveError('')
    setApiKey('')
    setVerifyResult(null)
    setLiveResult(null)
    setVerifying(false)
    setLiveTesting(false)
    verifyAbort.current?.abort()
    oauth.reset()
    if (providerId) {
      setSelectedId(providerId)
      setStep('connect')
    } else {
      setSelectedId(null)
      setStep('choose')
    }
    // Keyed on the dialog opening, not on the oauth hook re-rendering.
  }, [open, providerId])

  useEffect(() => {
    if (!selectedId) return
    const current = views.find((candidate) => candidate.id === selectedId)
    setBaseUrl(current?.baseUrl ?? getProviderBaseUrl(selectedId) ?? '')
    setEnvKey(current?.envKey ?? getProviderEnvKey(selectedId) ?? '')
    setDefaultModel(current?.activeModel ?? '')
    setMakeActive(current?.isActive ?? false)
  }, [selectedId, views])

  const isInline = selected?.configShape === 'inline-model'
  const needsKey = selected?.authKind === 'api-key'
  const isOAuthOnly =
    selected != null &&
    (selected.authKind === 'oauth' || selected.authKind === 'cli-token')

  async function handleSave() {
    if (!selected) return
    setSaveError('')
    try {
      await saveProvider.mutateAsync({
        id: selected.id,
        baseUrl,
        envKey,
        apiKey,
        defaultModel,
        makeActive,
        shape: isInline ? 'inline-model' : 'providers-map',
      })
      onSaved()
      // Stay open and prove it landed rather than declaring success blind.
      setStep('verify')
      setVerifying(true)
      verifyAbort.current?.abort()
      const controller = new AbortController()
      verifyAbort.current = controller
      const outcome = await verifyProviderVisible(selected.id, {
        signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        setVerifyResult(outcome)
        setVerifying(false)
      }
    } catch (error) {
      setSaveError(
        error instanceof ProviderWriteError || error instanceof Error
          ? error.message
          : 'Save failed',
      )
    }
  }

  async function handleLiveTest() {
    setLiveTesting(true)
    setLiveResult(await sendLiveTestPrompt())
    setLiveTesting(false)
  }

  async function handleRestart() {
    if (!selected) return
    setRestarting(true)
    try {
      await restartGateway.mutateAsync()
      toast('Gateway restart requested', { type: 'success' })
      setVerifying(true)
      verifyAbort.current?.abort()
      const controller = new AbortController()
      verifyAbort.current = controller
      const outcome = await verifyProviderVisible(selected.id, {
        signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        setVerifyResult(outcome)
        setVerifying(false)
      }
    } catch (restartError) {
      toast(
        restartError instanceof Error
          ? restartError.message
          : 'Could not restart the gateway',
        { type: 'error' },
      )
    } finally {
      setRestarting(false)
    }
  }

  useEffect(() => () => verifyAbort.current?.abort(), [])

  const stepIndex = STEPS.findIndex((entry) => entry.id === step)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-screen="providers"
        showCloseButton={false}
        className="pv-dialog sm:max-w-[720px]"
      >
        <div className="pv-wz-hd">
          <DialogTitle asChild>
            <h2>{selected ? `Configure ${selected.name}` : 'Add provider'}</h2>
          </DialogTitle>
          <DialogDescription asChild>
            <p>
              Writes to ~/.hermes/config.yaml. Nothing is saved until you press
              Save on the review step.
            </p>
          </DialogDescription>
        </div>

        <ol className="pv-wz-steps">
          {STEPS.map((entry, index) => (
            <li
              key={entry.id}
              className={
                entry.id === step
                  ? 'is-current'
                  : index < stepIndex
                    ? 'is-done'
                    : undefined
              }
            >
              <span className="pv-n">{index + 1}</span>
              {entry.label}
            </li>
          ))}
        </ol>

        <div className="pv-wz-body">
          {step === 'choose' ? (
            <div className="pv-wz-grid">
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={`pv-wz-pick${choice.id === selectedId ? ' on' : ''}`}
                  onClick={() => {
                    setSelectedId(choice.id)
                    setStep('connect')
                  }}
                >
                  <span className="pv-t">{choice.name}</span>
                  <span className="pv-s">{choice.description}</span>
                  <span className="pv-tag pv-auth">{choice.authKind}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 'connect' && selected ? (
            <>
              {isInline ? (
                <div className="pv-note pv-warn">
                  {selected.name} is defined inline in the <code>model:</code>{' '}
                  block, with its key stored in config.yaml. Edits stay in that
                  shape — adding a <code>providers:</code> entry would create a
                  second definition the gateway ignores.
                </div>
              ) : null}

              {isOAuthOnly && isOAuthSupported(selected.id) ? (
                <div className="pv-panel-card">
                  <h4>Sign in</h4>
                  {oauth.stage === 'idle' || oauth.stage === 'error' ? (
                    <>
                      {oauth.error ? (
                        <div className="pv-note pv-err">{oauth.error}</div>
                      ) : null}
                      <button
                        type="button"
                        className="pv-btn pv-btn-primary"
                        onClick={() => void oauth.start(selected.id)}
                      >
                        Connect with {selected.name}
                      </button>
                    </>
                  ) : null}
                  {oauth.stage === 'starting' ? <p>Starting sign-in…</p> : null}
                  {oauth.stage === 'waiting' ? (
                    <>
                      <p>Enter this code in the browser window:</p>
                      <div className="pv-diff">{oauth.userCode}</div>
                      {oauth.verificationUrl ? (
                        <a
                          className="pv-btn"
                          href={oauth.verificationUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ justifySelf: 'start' }}
                        >
                          Open {selected.name} ↗
                        </a>
                      ) : null}
                      <p>Waiting for approval…</p>
                    </>
                  ) : null}
                  {oauth.stage === 'success' ? (
                    <div className="pv-note pv-ok">
                      Signed in. The credential is stored by the gateway.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isOAuthOnly && !isOAuthSupported(selected.id) ? (
                <div className="pv-note pv-warn">
                  {selected.name} signs in through{' '}
                  {selected.authKind === 'oauth' ? 'OAuth' : 'the CLI'}, and the
                  gateway only implements the device-code flow for Nous Portal
                  today. Run <code>hermes setup</code> in a terminal, then
                  return here — the credential is detected automatically.
                </div>
              ) : null}

              <div className="pv-field">
                <label htmlFor="pv-base-url">Base URL</label>
                <input
                  id="pv-base-url"
                  value={baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </div>

              {needsKey ? (
                <div className="pv-field-row">
                  <div className="pv-field">
                    <label htmlFor="pv-env-key">Env var</label>
                    <input
                      id="pv-env-key"
                      value={envKey}
                      placeholder="PROVIDER_API_KEY"
                      onChange={(event) => setEnvKey(event.target.value)}
                      disabled={isInline}
                    />
                    <span className="pv-hint">
                      {isInline
                        ? 'Stored inline in config.yaml for this provider.'
                        : 'Written to ~/.hermes/.env'}
                    </span>
                  </div>
                  <div className="pv-field">
                    <label htmlFor="pv-api-key">API key</label>
                    <input
                      id="pv-api-key"
                      type="password"
                      value={apiKey}
                      placeholder={selected.configured ? 'unchanged' : 'sk-…'}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    <span className="pv-hint">
                      {selected.configured
                        ? 'Leave blank to keep the stored key.'
                        : 'Required to reach this provider.'}
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="pv-field">
                <label htmlFor="pv-default-model">Default model</label>
                <input
                  id="pv-default-model"
                  value={defaultModel}
                  placeholder="auto"
                  onChange={(event) => setDefaultModel(event.target.value)}
                />
              </div>

              <label className="pv-check">
                <input
                  type="checkbox"
                  checked={makeActive}
                  onChange={(event) => setMakeActive(event.target.checked)}
                />
                Make this the active provider
              </label>
            </>
          ) : null}

          {step === 'review' && selected ? (
            <>
              <div className="pv-note">
                This is the exact fragment that will be merged into
                ~/.hermes/config.yaml.
              </div>
              <pre className="pv-diff">
                {buildYamlPreview({
                  id: selected.id,
                  baseUrl,
                  envKey,
                  makeActive,
                  defaultModel,
                  inline: isInline,
                })}
              </pre>
              {apiKey && !isInline ? (
                <div className="pv-note">
                  ~/.hermes/.env →{' '}
                  <code>
                    {envKey}=••••••{apiKey.slice(-4)}
                  </code>
                </div>
              ) : null}
              {!apiKey && needsKey && !selected.configured ? (
                <div className="pv-note pv-warn">
                  No API key entered — the provider will be saved but cannot
                  authenticate until you add one.
                </div>
              ) : null}
              {saveError ? (
                <div className="pv-note pv-err">{saveError}</div>
              ) : null}
            </>
          ) : null}

          {step === 'verify' && selected ? (
            <>
              {verifying ? (
                <div className="pv-note">
                  Saved. Checking whether the gateway can see {selected.name}…
                </div>
              ) : verifyResult ? (
                <div
                  className={`pv-note ${
                    verifyResult.status === 'confirmed' ? 'pv-ok' : 'pv-warn'
                  }`}
                >
                  {verifyResult.message}
                </div>
              ) : null}

              {verifyResult && verifyResult.status !== 'confirmed' ? (
                <div className="pv-panel-card">
                  <h4>Gateway restart</h4>
                  <p>
                    The gateway reads ~/.hermes/config.yaml only at startup, so
                    a new provider stays invisible until it restarts.
                  </p>
                  <button
                    type="button"
                    className="pv-btn pv-btn-primary"
                    disabled={restarting}
                    onClick={() => void handleRestart()}
                    style={{ justifySelf: 'start' }}
                  >
                    {restarting ? 'Restarting…' : 'Restart gateway now'}
                  </button>
                </div>
              ) : null}

              <div className="pv-panel-card">
                <h4>Live test</h4>
                <p>
                  Sends one real prompt through this provider. It costs tokens
                  and can hit a rate limit, so it is opt-in.
                </p>
                <button
                  type="button"
                  className="pv-btn"
                  disabled={liveTesting}
                  onClick={() => void handleLiveTest()}
                  style={{ justifySelf: 'start' }}
                >
                  {liveTesting ? 'Waiting for a reply…' : 'Send a test prompt'}
                </button>
                {liveResult ? (
                  <div
                    className={`pv-note ${liveResult.ok ? 'pv-ok' : 'pv-err'}`}
                  >
                    {liveResult.message}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="pv-wz-foot">
          <button
            type="button"
            className="pv-btn"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <span className="pv-grow" />
          {step === 'connect' || step === 'review' ? (
            <button
              type="button"
              className="pv-btn"
              onClick={() => setStep(step === 'review' ? 'connect' : 'choose')}
            >
              Back
            </button>
          ) : null}
          {step === 'connect' ? (
            <button
              type="button"
              className="pv-btn pv-btn-primary"
              onClick={() => setStep('review')}
              disabled={!selected}
            >
              Review
            </button>
          ) : null}
          {step === 'review' ? (
            <button
              type="button"
              className="pv-btn pv-btn-primary"
              onClick={() => void handleSave()}
              disabled={saveProvider.isPending}
            >
              {saveProvider.isPending ? 'Saving…' : 'Save'}
            </button>
          ) : null}
          {step === 'verify' ? (
            <button
              type="button"
              className="pv-btn pv-btn-primary"
              onClick={() => onOpenChange(false)}
            >
              Done
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Catalog ids, exported for tests that assert the picker is complete. */
export const WIZARD_CATALOG_SIZE = PROVIDER_CATALOG.length
