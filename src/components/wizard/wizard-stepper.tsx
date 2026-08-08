'use client'

/**
 * wizard-stepper.tsx — the rail.
 *
 * Every step is a real `<button>`, not a decorative `<li>`: users navigate
 * wizards by clicking back to a step they have already filled in, and a
 * `<span>` cannot be reached by keyboard. Steps that are not reachable are
 * `disabled` rather than hidden, so the rail keeps showing how much is left.
 *
 * `.wz-progress` carries the same information as prose. Above 640px the rail is
 * visible and the sentence is sr-only; under 640px the rail collapses and the
 * sentence takes over.
 */
import type { WizardStatus, WizardStepDef } from './types'

export type WizardStepperProps<TId extends string, TCtx> = {
  /** Already filtered to the rail — see `railSteps()`. */
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>
  currentId: TId
  statusOf: (id: TId) => WizardStatus
  isReachable: (id: TId) => boolean
  onSelect: (id: TId) => void
  /** e.g. `Step 3 of 6`. */
  progressLabel: string
}

export function WizardStepper<TId extends string, TCtx>({
  steps,
  currentId,
  statusOf,
  isReachable,
  onSelect,
  progressLabel,
}: WizardStepperProps<TId, TCtx>) {
  const total = steps.length

  return (
    <nav aria-label="Setup progress">
      <ol className="wz-steps">
        {steps.map((step, index) => {
          const status = statusOf(step.id)
          const isCurrent = step.id === currentId
          const done = status === 'done'
          return (
            <li
              key={step.id}
              data-status={status}
              className={
                isCurrent ? 'is-current' : done ? 'is-done' : undefined
              }
            >
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Step ${index + 1} of ${total}: ${step.label}`}
                disabled={!isReachable(step.id)}
                onClick={() => onSelect(step.id)}
              >
                <span className="wz-n" aria-hidden="true">
                  {done ? '✓' : index + 1}
                </span>
                <span className="wz-step-label">{step.label}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="wz-progress" role="status">
        {progressLabel}
      </p>
    </nav>
  )
}
