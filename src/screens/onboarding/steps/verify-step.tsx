'use client'

/**
 * verify-step.tsx — did the save actually take effect?
 *
 * Entirely handler-driven: every action (`onVerify`, `onRestart`,
 * `onLiveTest`) is supplied by the parent, which owns the polling in
 * `verify-provider.ts`. Nothing here fires on mount — verification and the
 * live test both spend a real request (the live test spends tokens too), so
 * the parent decides when that is worth doing.
 *
 * `providerId` empty is a real state, not a bug to paper over: it means the
 * draft has no provider *and* the workspace has none configured. Verification
 * has nothing to ask about, so this step says so in prose rather than
 * rendering a Verify button whose handler cannot do anything — a control that
 * looks live and no-ops is worse than no control.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import type { SetupFact } from '../lib/current-setup'
import type {
  LiveTestOutcome,
  VerifyOutcome,
} from '@/screens/providers/lib/verify-provider'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type VerifyStepProps = {
  providerId: string
  outcome: VerifyOutcome | null
  verifying: boolean
  onVerify: () => void
  canRestart: boolean
  restarting: boolean
  onRestart: () => void
  liveOutcome: LiveTestOutcome | null
  liveTesting: boolean
  onLiveTest: () => void
  facts: Array<SetupFact>
}

const STATE_CLASS: Record<VerifyOutcome['status'], string> = {
  confirmed: 'is-confirmed',
  'pending-restart': 'is-pending',
  missing: 'is-missing',
}

/**
 * `STATE_CLASS` paints the outcome; this names it. The outcome message is
 * prose written for the specific failure and does not always start with the
 * verdict, so the verdict is stated separately rather than inferred from the
 * colour of the box it sits in.
 */
const STATE_LABEL: Record<VerifyOutcome['status'], string> = {
  confirmed: 'Verified',
  'pending-restart': 'Restart needed',
  missing: 'Not found',
}

export function VerifyStep({
  providerId,
  outcome,
  verifying,
  onVerify,
  canRestart,
  restarting,
  onRestart,
  liveOutcome,
  liveTesting,
  onLiveTest,
  facts,
}: VerifyStepProps) {
  const hasProvider = providerId.trim().length > 0
  const stateModifier = outcome ? ` ${STATE_CLASS[outcome.status]}` : ''
  const stateMessage = !hasProvider
    ? 'There is no provider to verify yet.'
    : verifying
      ? `Checking whether the gateway can see ${providerId}…`
      : outcome
        ? outcome.message
        : 'Not verified yet — press Verify connection to check.'

  return (
    <div className="ob-verify">
      <CurrentSetupStrip facts={facts} />
      <div className={`ob-verify-state${stateModifier}`} role="status">
        {outcome && !verifying && hasProvider ? (
          <span className="wz-sr">{STATE_LABEL[outcome.status]}. </span>
        ) : null}
        {stateMessage}
      </div>

      {hasProvider ? (
        <div className="ob-verify-actions">
          <button
            type="button"
            className="wz-btn wz-btn-primary"
            disabled={verifying}
            onClick={onVerify}
          >
            {verifying
              ? 'Verifying…'
              : outcome
                ? 'Verify again'
                : 'Verify connection'}
          </button>
        </div>
      ) : (
        <WizardNote tone="warn">
          Choose a provider on the Provider step — this workspace has none
          configured, so there is nothing for the gateway to report on yet.
        </WizardNote>
      )}

      {outcome && outcome.status !== 'confirmed' ? (
        canRestart ? (
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
        )
      ) : null}

      <WizardPanel heading="Live test">
        <p>
          Sends one real prompt through this provider. It spends tokens and can
          hit a rate limit, so it stays opt-in.
        </p>
        <button
          type="button"
          className="wz-btn"
          disabled={liveTesting}
          onClick={onLiveTest}
        >
          {liveTesting ? 'Waiting for a reply…' : 'Send a test prompt'}
        </button>
        {liveOutcome ? (
          <WizardNote tone={liveOutcome.ok ? 'ok' : 'error'}>
            {liveOutcome.message}
          </WizardNote>
        ) : null}
      </WizardPanel>
    </div>
  )
}
