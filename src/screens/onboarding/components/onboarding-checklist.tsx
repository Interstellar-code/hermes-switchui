'use client'

/**
 * onboarding-checklist.tsx — "here is what is done and what is still open",
 * rendered from a plain `Array<ChecklistItem>`.
 *
 * Deliberately free of wizard state: it takes items and an optional jump
 * callback, nothing else. The summary step, the finish step and (a later
 * phase) the dashboard all render the same list, and only the first two of
 * those live inside a wizard — so anything this component knew about
 * `useWizard` would have to be faked by the third caller.
 */
import type { ChecklistItem, ChecklistItemState } from '../lib/checklist'
import type { OnboardingStepId } from '../lib/onboarding-steps'

export type OnboardingChecklistProps = {
  items: Array<ChecklistItem>
  onJump?: (stepId: OnboardingStepId) => void
}

/** The icon is the only carrier of state, so it gets the accessible name. */
const STATE_LABEL: Record<ChecklistItemState, string> = {
  done: 'Done',
  skipped: 'Skipped',
  todo: 'Not started',
  blocked: 'Blocked',
}

const ICON_PATH: Record<ChecklistItemState, string> = {
  done: 'M20 6 9 17l-5-5',
  skipped: 'M5 12h14',
  todo: 'M12 5v14M5 12h14',
  blocked: 'M12 8v5M12 16.5v.01M12 3l9 16H3z',
}

function StateIcon({ state }: { state: ChecklistItemState }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATH[state]} />
    </svg>
  )
}

export function OnboardingChecklist({
  items,
  onJump,
}: OnboardingChecklistProps) {
  return (
    <ul className="ob-list">
      {items.map((item) => (
        <li key={item.id} className={`ob-list-item is-${item.state}`}>
          <span
            className="ob-list-icon"
            role="img"
            aria-label={STATE_LABEL[item.state]}
          >
            <StateIcon state={item.state} />
          </span>
          <span className="ob-list-label">{item.label}</span>
          {onJump && item.state !== 'done' ? (
            <button
              type="button"
              className="wz-btn ob-list-action"
              aria-label={`Open: ${item.label}`}
              onClick={() => onJump(item.goTo)}
            >
              Open
            </button>
          ) : null}
          <span className="ob-list-detail">{item.detail}</span>
        </li>
      ))}
    </ul>
  )
}
