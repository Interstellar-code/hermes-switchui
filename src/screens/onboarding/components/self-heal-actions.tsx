'use client'

/**
 * self-heal-actions.tsx — the inline remediation control a `TrustBoundary`
 * attaches via its `heal` field. Purely presentational: it never calls the
 * network itself, only reports "the user asked to run this" via `onRun`.
 */
import type { BoundaryHeal } from '../lib/trust-boundaries'
import { WizardField } from '@/components/wizard'

export type SelfHealActionsProps = {
  action: NonNullable<BoundaryHeal>
  busy: boolean
  onRun: (payload?: { gatewayUrl?: string }) => void
  gatewayUrl?: string
  onGatewayUrlChange?: (value: string) => void
}

const RUN_LABEL: Record<NonNullable<BoundaryHeal>, string> = {
  'start-agent': 'Start agent',
  'restart-gateway': 'Restart gateway',
  reprobe: 'Re-check',
  'change-url': 'Save and re-check',
}

const BUSY_LABEL: Record<NonNullable<BoundaryHeal>, string> = {
  'start-agent': 'Starting…',
  'restart-gateway': 'Restarting…',
  reprobe: 'Checking…',
  'change-url': 'Saving…',
}

export function SelfHealActions({
  action,
  busy,
  onRun,
  gatewayUrl,
  onGatewayUrlChange,
}: SelfHealActionsProps) {
  const handleRun = () => {
    if (action === 'change-url') {
      onRun({ gatewayUrl })
      return
    }
    onRun()
  }

  return (
    <div className="ob-heal">
      {action === 'change-url' ? (
        <WizardField label="Gateway URL">
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="url"
              inputMode="url"
              placeholder="http://127.0.0.1:8642"
              value={gatewayUrl ?? ''}
              disabled={busy}
              onChange={(event) => onGatewayUrlChange?.(event.target.value)}
            />
          )}
        </WizardField>
      ) : null}
      <button
        type="button"
        className="wz-btn"
        disabled={busy}
        onClick={handleRun}
      >
        {busy ? BUSY_LABEL[action] : RUN_LABEL[action]}
      </button>
    </div>
  )
}
