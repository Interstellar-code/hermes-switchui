'use client'

/**
 * system-check-list.tsx — renders the flat `SystemCheck` array as one row
 * per check: a status dot, a typewriter-revealed label, the detail text,
 * and (when the check offers one) a `SelfHealActions` control.
 *
 * The reveal stagger is purely decorative: every row's full text is in the
 * DOM immediately (the `.ob-type` wrapper only clips it visually during the
 * animation, and the stylesheet disables the animation entirely under
 * `prefers-reduced-motion`), so nothing here withholds content from
 * assistive tech.
 */
import { useState } from 'react'
import { SelfHealActions } from './self-heal-actions'
import type { CSSProperties } from 'react'
import type { SystemCheck } from '../lib/system-checks'

export type SystemCheckListProps = {
  checks: Array<SystemCheck>
  loading: boolean
  onHeal: (
    action: NonNullable<SystemCheck['heal']>,
    payload?: { gatewayUrl?: string },
  ) => void
  healing: string | null
}

/** Stagger step between rows, capped so a long check list doesn't crawl. */
const STAGGER_STEP_MS = 60
const STAGGER_CAP_MS = 480

/**
 * The dot is the only visual carrier of status, and it is a colour. Every row
 * therefore also states its status in text, hidden visually but not from
 * assistive tech — `unknown` reads as "could not tell" rather than as a
 * failure, matching the rule `system-checks.ts` applies upstream.
 */
const STATUS_LABEL: Record<SystemCheck['status'], string> = {
  ok: 'Passed',
  warn: 'Warning',
  fail: 'Failed',
  unknown: 'Could not tell',
}

function typeDelayStyle(index: number): CSSProperties {
  const delay = Math.min(index * STAGGER_STEP_MS, STAGGER_CAP_MS)
  return { '--ob-type-delay': `${delay}ms` } as CSSProperties
}

export function SystemCheckList({
  checks,
  loading,
  onHeal,
  healing,
}: SystemCheckListProps) {
  // Local drafts for any 'change-url' row's URL field, keyed by check id.
  // buildSystemChecks never currently emits 'change-url', but the type
  // allows it and the control must still work if that changes.
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({})

  return (
    <div className="ob-checks" role="status" aria-live="polite">
      {checks.map((check, index) => {
        const heal = check.heal
        return (
          <div key={check.id} className="ob-check-row">
            <span
              className={`ob-check-dot is-${check.status}`}
              aria-hidden="true"
            />
            <span className="ob-type" style={typeDelayStyle(index)}>
              <span className="ob-check-label">{check.label}</span>
            </span>
            <span className="wz-sr">{STATUS_LABEL[check.status]}.</span>
            <span className="ob-check-detail">{check.detail}</span>
            {heal ? (
              <SelfHealActions
                action={heal}
                busy={healing === heal}
                onRun={(payload) => onHeal(heal, payload)}
                gatewayUrl={urlDrafts[check.id] ?? ''}
                onGatewayUrlChange={(value) =>
                  setUrlDrafts((prev) => ({ ...prev, [check.id]: value }))
                }
              />
            ) : null}
          </div>
        )
      })}
      {loading && checks.length === 0 ? (
        <div className="ob-check-row">
          <span className="ob-check-detail">Running checks…</span>
        </div>
      ) : null}
    </div>
  )
}
