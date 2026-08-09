'use client'

/**
 * chat-step.tsx — step 4 of 4, and the gate.
 *
 * The official quickstart puts "first successful chat" ahead of gateway, MCP,
 * skills and voice, and states the rule outright: *if Hermes cannot complete a
 * normal chat, do not add more features yet.* The wizard this replaces offered
 * profiles, memory, kanban and projects before a single completion had ever
 * succeeded, so this step exists to make that impossible by accident.
 *
 * It blocks by default. It also offers a way past, because the wizard is a
 * settings surface as well as a first run and a hard block would strand a
 * returning user whose gateway is down. What the escape hatch must not be is
 * vague: `buildSkipWarning` names the actual consequences, derived from the
 * actual failure, and the user has to press a second, differently-labelled
 * button after reading them.
 *
 * The Ollama context warning is raised *before* the send rather than after the
 * failure, because the failure it causes is a startup rejection — the agent
 * does not answer badly, it does not load.
 */
import { useState } from 'react'
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { buildSkipWarning } from '../lib/chat-gate'
import { DOCS } from '../lib/docs-links'
import type { ChatGateState } from '../lib/chat-gate'
import type { SetupFact } from '../lib/current-setup'
import type { GatewayTip } from '../lib/gateway-onboarding'
import type { OllamaContextVerdict } from '../lib/ollama-context'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type ChatStepProps = {
  state: ChatGateState
  prompt: string
  onSend: () => void
  onSkip: () => void
  activeProvider: string | null
  ollama: OllamaContextVerdict
  /**
   * Hints the gateway keeps its own one-shot flags for and has not yet shown.
   * Anything it *has* shown is absent — the whole reason this wizard reads
   * `onboarding.seen` is to stop saying things the agent already said.
   */
  tips: Array<GatewayTip>
  facts: Array<SetupFact>
  /**
   * `validateChatStep`'s output. Rendered here rather than in the footer
   * because the footer has no error slot — pressing Next against a blocked
   * gate used to produce no visible response at all.
   */
  errors: Array<string>
}

export function ChatStep({
  state,
  prompt,
  onSend,
  onSkip,
  activeProvider,
  ollama,
  tips,
  facts,
  errors,
}: ChatStepProps) {
  const [confirmingSkip, setConfirmingSkip] = useState(false)
  const warning = buildSkipWarning({ state, activeProvider, ollama })
  const warnContext =
    ollama.kind === 'below-minimum' || ollama.kind === 'unconfigured'

  return (
    <div className="ob-verify">
      <CurrentSetupStrip facts={facts} />

      {warnContext && state.kind !== 'passed' ? (
        <WizardPanel heading="This will probably fail">
          <p>{ollama.message}</p>
          <ul>
            {ollama.fixes.map((fix) => (
              <li key={fix}>{fix}</li>
            ))}
          </ul>
          <p>
            <a href={DOCS.ollama} target="_blank" rel="noreferrer noopener">
              Ollama setup guide
            </a>
          </p>
        </WizardPanel>
      ) : null}

      <div
        className={
          state.kind === 'passed'
            ? 'ob-verify-state is-confirmed'
            : state.kind === 'failed'
              ? 'ob-verify-state is-missing'
              : 'ob-verify-state'
        }
        role="status"
      >
        {state.kind === 'passed' ? (
          <>
            <span className="wz-sr">Passed. </span>
            The agent answered: “{state.reply}”
          </>
        ) : state.kind === 'failed' ? (
          <>
            <span className="wz-sr">Failed. </span>
            The agent could not answer.
          </>
        ) : state.kind === 'sending' ? (
          'Waiting for the provider to answer…'
        ) : state.kind === 'skipped' ? (
          'Skipped. Nothing has proved this agent can answer.'
        ) : (
          'One real message, end to end. This is the only check that proves the whole chain.'
        )}
      </div>

      {state.kind === 'failed' ? (
        <WizardPanel heading="What the gateway said">
          {/* Verbatim. The exact string is what the user searches for. */}
          <pre className="ob-cli" tabIndex={0}>
            {state.error}
          </pre>
          {state.credentialLikely ? (
            <p>
              That reads as a credential problem. Go back to Provider — the
              Connect step reports which store the gateway actually resolves the
              key from, which is usually not the one that was edited.
            </p>
          ) : null}
        </WizardPanel>
      ) : null}

      <WizardPanel heading="The message">
        <pre className="ob-cli">{prompt}</pre>
        <div className="ob-verify-actions">
          <button
            type="button"
            className="wz-btn wz-btn-primary"
            disabled={state.kind === 'sending'}
            onClick={onSend}
          >
            {state.kind === 'sending'
              ? 'Sending…'
              : state.kind === 'untested'
                ? 'Send first message'
                : 'Try again'}
          </button>
        </div>
      </WizardPanel>

      {state.kind === 'passed' ? (
        <WizardNote tone="ok">
          A full round trip succeeded — provider, credential, gateway and
          stream. Everything optional is unlocked from here.
        </WizardNote>
      ) : null}

      {tips.length > 0 && state.kind === 'passed' ? (
        <WizardPanel heading="Worth knowing">
          <ul>
            {tips.map((tip) => (
              <li key={tip.id}>{tip.text}</li>
            ))}
          </ul>
        </WizardPanel>
      ) : null}

      {state.kind !== 'passed' && state.kind !== 'skipped' ? (
        <WizardPanel heading="Continue without a working chat">
          {confirmingSkip ? (
            <>
              <p>Here is what that costs:</p>
              <ul>
                {warning.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="ob-verify-actions">
                <button
                  type="button"
                  className="wz-btn wz-btn-danger"
                  onClick={onSkip}
                >
                  Continue anyway
                </button>
                <button
                  type="button"
                  className="wz-btn"
                  onClick={() => setConfirmingSkip(false)}
                >
                  Go back
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                You can move on without this, but the rest of the wizard
                configures things that only run inside a completion.
              </p>
              <button
                type="button"
                className="wz-btn"
                onClick={() => setConfirmingSkip(true)}
              >
                Skip this check
              </button>
            </>
          )}
        </WizardPanel>
      ) : null}

      {state.kind === 'skipped' ? (
        <WizardNote tone="warn">
          {warning[0]} You can come back to this step from the setup wizard at
          any time.
        </WizardNote>
      ) : null}

      {errors.map((error) => (
        <WizardNote tone="error" key={error}>
          {error}
        </WizardNote>
      ))}
    </div>
  )
}
