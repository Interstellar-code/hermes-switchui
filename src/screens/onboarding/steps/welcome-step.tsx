'use client'

/**
 * welcome-step.tsx — the fork the whole flow hangs off: quick or full.
 *
 * The two cards are real `<button>`s rather than clickable cards, because
 * this is the first thing a keyboard user meets and a `<div onClick>` here
 * would be a dead end. "I'll set this up later" is deliberately low-emphasis
 * and deliberately *not* completion — it records a dismissal, so the user
 * stays re-promptable (see `onboarding-gate.ts`).
 */
export type WelcomeStepProps = {
  onChooseBranch: (branch: 'quick' | 'full') => void
  onDismiss: () => void
  showDismiss: boolean
}

const FORKS: ReadonlyArray<{
  id: 'quick' | 'full'
  title: string
  blurb: string
  meta: string
}> = [
  {
    id: 'quick',
    title: 'Quick start',
    blurb: 'Pick a provider, connect it, and go. About a minute.',
    meta: '4 steps',
  },
  {
    id: 'full',
    title: 'Full setup',
    blurb: 'Also check your system, choose core plugins, and pick a theme.',
    meta: '7 steps',
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
  onChooseBranch,
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
          Connect a model provider to start using the workspace.
        </p>
      </div>

      <div className="ob-fork">
        {FORKS.map((fork) => (
          <button
            key={fork.id}
            type="button"
            className="ob-fork-card"
            onClick={() => onChooseBranch(fork.id)}
          >
            <span className="ob-meta">{fork.meta}</span>
            <span className="ob-t">{fork.title}</span>
            <span className="ob-s">{fork.blurb}</span>
          </button>
        ))}
      </div>

      {showDismiss ? (
        <button type="button" className="ob-later" onClick={onDismiss}>
          I&apos;ll set this up later
        </button>
      ) : null}
    </>
  )
}
