'use client'

/**
 * welcome-step.tsx — one screen, one path.
 *
 * This used to be a fork between "quick" and "full", which asked a first-time
 * user to choose between two flows before they knew what either contained —
 * and the "full" one put profiles, memory and a theme picker in front of a
 * working chat. There is one flow now, so the only thing left to decide here
 * is whether to do it at all.
 *
 * "I'll set this up later" is deliberately low-emphasis and deliberately *not*
 * completion — it records a dismissal, so the user stays re-promptable (see
 * `onboarding-gate.ts`).
 */
import { DOCS } from '../lib/docs-links'

export type WelcomeStepProps = {
  onStart: () => void
  onDismiss: () => void
  showDismiss: boolean
}

/** The canonical order, straight from the quickstart. */
const PLAN: ReadonlyArray<{ n: string; title: string; blurb: string }> = [
  {
    n: '01',
    title: 'Connect',
    blurb:
      'Confirm the gateway is there and say which hop is broken if it is not.',
  },
  {
    n: '02',
    title: 'Provider',
    blurb: 'Choose who serves your models, then prove it with one real call.',
  },
  {
    n: '03',
    title: 'Workspace',
    blurb: 'Tell the agent which directory to work in. Nothing else asks.',
  },
  {
    n: '04',
    title: 'First chat',
    blurb: 'Send one message. If this does not work, nothing built on it will.',
  },
]

function HermesMark() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
      <path d="M8.5 15.5v-7M15.5 15.5v-7M8.5 12h7" />
    </svg>
  )
}

export function WelcomeStep({
  onStart,
  onDismiss,
  showDismiss,
}: WelcomeStepProps) {
  return (
    <>
      <div className="ob-hero">
        <span className="ob-logo">
          <HermesMark />
        </span>
        <h3 className="ob-title">Hermes Switch UI</h3>
        <p className="ob-tagline">
          Four steps to an agent that actually answers. Profiles, memory, MCP
          and skills come after — they are worth nothing until a chat works.
        </p>
      </div>

      <div className="ob-fork">
        {PLAN.map((entry) => (
          <div key={entry.n} className="ob-plan-card">
            <span className="ob-meta">{entry.n}</span>
            <span className="ob-t">{entry.title}</span>
            <span className="ob-s">{entry.blurb}</span>
          </div>
        ))}
      </div>

      <button type="button" className="wz-btn wz-btn-primary" onClick={onStart}>
        Get started
      </button>

      <p className="wz-hint">
        This follows the order in the{' '}
        <a href={DOCS.quickstart} target="_blank" rel="noreferrer noopener">
          official Hermes quickstart
        </a>
        .
      </p>

      {showDismiss ? (
        <button type="button" className="ob-later" onClick={onDismiss}>
          I&apos;ll set this up later
        </button>
      ) : null}
    </>
  )
}
