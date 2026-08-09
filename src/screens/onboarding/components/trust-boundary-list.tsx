'use client'

/**
 * trust-boundary-list.tsx — one row per hop, with the sentence that stops the
 * status being misread.
 *
 * Structurally the same as `SystemCheckList` (and reuses its `ob-check-*`
 * classes on purpose — this replaces that list on the Connect step), with one
 * addition that is the whole point: `note`. A 401 renders as a failure, and
 * without a line saying "the gateway is running, this is a token mismatch" the
 * user restarts a healthy process. The note is not a tooltip and not a
 * disclosure — it is always visible, because it is the part they need.
 */
import { useState } from 'react'
import { SelfHealActions } from './self-heal-actions'
import type { CSSProperties } from 'react'
import type { BoundaryStatus, TrustBoundary } from '../lib/trust-boundaries'

export type TrustBoundaryListProps = {
  boundaries: Array<TrustBoundary>
  loading: boolean
  onHeal: (
    action: NonNullable<TrustBoundary['heal']>,
    payload?: { gatewayUrl?: string },
  ) => void
  healing: string | null
  /** Locked relaunch: render the results, offer no control that mutates. */
  readOnly?: boolean
}

const STAGGER_STEP_MS = 60

/**
 * The dot is the only visual carrier of status, and it is a colour. Every row
 * therefore also states its status in text, hidden visually but not from
 * assistive tech — `unknown` reads as "could not tell" rather than as a
 * failure, matching the rule the pure builder applies upstream.
 */
const STATUS_LABEL: Record<BoundaryStatus, string> = {
  ok: 'Working',
  warn: 'Warning',
  fail: 'Blocked',
  unknown: 'Could not tell',
}

function typeDelayStyle(index: number): CSSProperties {
  return { '--ob-type-delay': `${index * STAGGER_STEP_MS}ms` } as CSSProperties
}

export function TrustBoundaryList({
  boundaries,
  loading,
  onHeal,
  healing,
  readOnly = false,
}: TrustBoundaryListProps) {
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({})

  return (
    <div className="ob-checks" role="status" aria-live="polite">
      {boundaries.map((boundary, index) => {
        // Absent rather than disabled while read-only: these buttons restart
        // the gateway, and a greyed-out one still implies it is on the table.
        const heal = readOnly ? null : boundary.heal
        return (
          <div key={boundary.id} className="ob-check-row">
            <span
              className={`ob-check-dot is-${boundary.status}`}
              aria-hidden="true"
            />
            <span className="ob-type" style={typeDelayStyle(index)}>
              <span className="ob-check-label">{boundary.label}</span>
            </span>
            <span className="wz-sr">{STATUS_LABEL[boundary.status]}.</span>
            <span className="ob-check-detail">
              {boundary.detail}
              {boundary.note ? <> {boundary.note}</> : null}
            </span>
            {heal ? (
              <SelfHealActions
                action={heal}
                busy={healing === heal}
                onRun={(payload) => onHeal(heal, payload)}
                gatewayUrl={urlDrafts[boundary.id] ?? ''}
                onGatewayUrlChange={(value) =>
                  setUrlDrafts((prev) => ({ ...prev, [boundary.id]: value }))
                }
              />
            ) : null}
          </div>
        )
      })}
      {loading && boundaries.length === 0 ? (
        <div className="ob-check-row">
          <span className="ob-check-detail">Checking…</span>
        </div>
      ) : null}
    </div>
  )
}
