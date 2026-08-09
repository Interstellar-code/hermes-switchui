'use client'

/**
 * connect-step.tsx — step 1 of 4: is anything actually connected, and if not,
 * which of the three hops is broken.
 *
 * This replaces a ten-row system check whose rows were all derived from one
 * probe and none of which could tell a user *where* the break was. Three
 * boundaries, named after the two things on either side of them, each with the
 * one sentence that stops it being misread. `trust-boundaries.ts` owns every
 * verdict; this file renders them and offers the remediation the verdict asks
 * for.
 *
 * It never blocks. A gateway that is down has to be fixable from the provider
 * step (a wrong URL is the common cause), and the chat gate is the real check.
 */
import { CurrentSetupStrip } from '../components/current-setup-strip'
import { TrustBoundaryList } from '../components/trust-boundary-list'
import { DOCS } from '../lib/docs-links'
import type { SetupFact } from '../lib/current-setup'
import type { TrustBoundary } from '../lib/trust-boundaries'
import { WizardNote, WizardPanel } from '@/components/wizard'

export type ConnectStepProps = {
  boundaries: Array<TrustBoundary>
  loading: boolean
  onHeal: (
    action: NonNullable<TrustBoundary['heal']>,
    payload?: { gatewayUrl?: string },
  ) => void
  healing: string | null
  /**
   * The `canWriteConfig` verdict. The probes are reads and always run; the
   * remediation starts the agent, re-probes and restarts it, so a locked
   * relaunch renders none of them.
   */
  canWrite: boolean
  facts: Array<SetupFact>
  gatewayUrl: string | null
}

export function ConnectStep({
  boundaries,
  loading,
  onHeal,
  healing,
  canWrite,
  facts,
  gatewayUrl,
}: ConnectStepProps) {
  const blocked = boundaries.filter((entry) => entry.status === 'fail')
  const authMismatch = boundaries.some(
    (entry) =>
      entry.id === 'ui-gateway' && entry.status === 'fail' && entry.note,
  )

  return (
    <div className="ob-connect">
      <CurrentSetupStrip facts={facts} />

      <WizardNote>
        Three hops have to work before a single message can be answered, and
        they fail independently. Nothing here blocks setup — the first chat is
        the check that does.
      </WizardNote>

      {!canWrite ? (
        <WizardNote tone="warn">
          Read-only for this run — the checks still run, but nothing here will
          start or restart anything.
        </WizardNote>
      ) : null}

      <TrustBoundaryList
        boundaries={boundaries}
        loading={loading}
        onHeal={onHeal}
        healing={healing}
        readOnly={!canWrite}
      />

      {blocked.length > 0 && !authMismatch ? (
        <WizardPanel heading="If the gateway is not running">
          <p>Start it from a terminal and come back:</p>
          <pre className="ob-cli">pnpm start:all</pre>
          <pre className="ob-cli">hermes gateway run</pre>
        </WizardPanel>
      ) : null}

      {authMismatch ? (
        <WizardPanel heading="Fixing a token mismatch">
          <p>
            The gateway is up and refusing this workspace. Both sides have to
            agree on one secret: the gateway&rsquo;s <code>API_SERVER_KEY</code>{' '}
            and this workspace&rsquo;s <code>HERMES_API_TOKEN</code>. Set them
            to the same value in <code>~/.hermes/.env</code> and this
            workspace&rsquo;s <code>.env</code>, then restart both.
          </p>
          {gatewayUrl ? (
            <p>
              Currently talking to <code>{gatewayUrl}</code>. If that is the
              wrong gateway, change the URL rather than the token.
            </p>
          ) : null}
        </WizardPanel>
      ) : null}

      <p className="wz-hint">
        More on what the gateway reads at boot in the{' '}
        <a href={DOCS.gateway} target="_blank" rel="noreferrer noopener">
          gateway documentation
        </a>
        .
      </p>
    </div>
  )
}
