/**
 * The shared wizard shell.
 *
 * Compose it as: `useWizard` for the state, `WizardShell` for the chrome,
 * `WizardStepper` for the rail, and the primitives for the step bodies.
 * Nothing here knows about providers, crons or onboarding — the caller owns
 * the step definitions, the draft (`ctx`) and every write.
 */
export { WizardShell } from './wizard-shell'
export type { WizardShellProps } from './wizard-shell'

export { WizardStepper } from './wizard-stepper'
export type { WizardStepperProps } from './wizard-stepper'

export { WizardReview } from './wizard-review'
export type { WizardReviewProps } from './wizard-review'

export {
  WizardField,
  WizardFieldRow,
  WizardFooter,
  WizardGrid,
  WizardNote,
  WizardPanel,
  WizardPick,
} from './wizard-primitives'
export type {
  WizardFieldProps,
  WizardFooterProps,
  WizardNoteProps,
  WizardPanelProps,
  WizardPickProps,
} from './wizard-primitives'

export { useWizard } from './use-wizard'
export type { UseWizardOptions, UseWizardResult } from './use-wizard'

export {
  activeSteps,
  applyWizardAction,
  canLeave,
  initialWizardState,
  isReachable,
  nextStepId,
  prevStepId,
  progressLabel,
  railSteps,
  reconcileCurrentId,
  stepIndex,
} from './wizard-machine'

export type {
  WizardAction,
  WizardState,
  WizardStatus,
  WizardStepDef,
} from './types'
