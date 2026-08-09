'use client'

/**
 * extras-step.tsx — everything that is genuinely optional, offered only once
 * the gate has been settled.
 *
 * Each card leads with a *reason*, not a label. The old wizard asked a
 * first-time user to "choose an agent profile" with no statement of what a
 * profile was for, which is how a wizard produces a decision nobody
 * understands and a setting nobody can explain a week later.
 *
 * A card can be suppressed, and when it is, it says so rather than vanishing:
 * the gateway makes its own profile-building offer in conversation, and the
 * honest thing is to tell the user that is why this screen is not asking.
 */
import type { ExtraCard } from '../lib/extras'
import type { OnboardingStepId } from '../lib/onboarding-steps'
import { WizardNote } from '@/components/wizard'

export type ExtrasStepProps = {
  cards: Array<ExtraCard>
  onJump: (stepId: OnboardingStepId) => void
  /** Leaves the wizard for a workspace route. */
  onOpenRoute: (href: string) => void
  /** True when the user skipped the chat gate rather than passing it. */
  unproven: boolean
}

export function ExtrasStep({
  cards,
  onJump,
  onOpenRoute,
  unproven,
}: ExtrasStepProps) {
  const offered = cards.filter((card) => !card.suppressedBy)
  const suppressed = cards.filter((card) => card.suppressedBy)

  return (
    <>
      {unproven ? (
        <WizardNote tone="warn">
          No completion has succeeded yet, so anything configured here is being
          set up for an agent that has not been shown to run.
        </WizardNote>
      ) : (
        <WizardNote>
          None of this is required. Each card says what it buys you; skip the
          step entirely and the workspace still works.
        </WizardNote>
      )}

      <div className="ob-fork">
        {offered.map((card) => (
          <button
            key={card.id}
            type="button"
            className="ob-fork-card"
            onClick={() =>
              card.goTo
                ? onJump(card.goTo)
                : card.href
                  ? onOpenRoute(card.href)
                  : undefined
            }
          >
            <span className="ob-meta">{card.state ?? 'Not set up'}</span>
            <span className="ob-t">{card.label}</span>
            <span className="ob-s">{card.reason}</span>
          </button>
        ))}
      </div>

      {suppressed.length > 0 ? (
        <div className="ob-checks">
          {suppressed.map((card) => (
            <div className="ob-check-row" key={card.id}>
              <span className="ob-check-dot is-ok" aria-hidden="true" />
              <span className="ob-check-label">{card.label}</span>
              <span className="ob-check-detail">{card.suppressedBy}</span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="wz-hint">
        Documentation:{' '}
        {cards.map((card, index) => (
          <span key={card.id}>
            {index > 0 ? ' · ' : ''}
            <a href={card.docs} target="_blank" rel="noreferrer noopener">
              {card.label}
            </a>
          </span>
        ))}
      </p>
    </>
  )
}
