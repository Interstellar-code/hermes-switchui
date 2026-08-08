/**
 * types.ts — the shared wizard vocabulary.
 *
 * A wizard is a list of `WizardStepDef` plus a caller-owned `ctx` (the draft
 * being edited). Everything about *which* step comes next is derived from those
 * two inputs, never stored: branching wizards renumber themselves when the ctx
 * flips a branch, so a stored "step 3 of 6" would go stale the moment the user
 * ticks a checkbox.
 */

export type WizardStatus = 'pending' | 'active' | 'done' | 'skipped'

export type WizardStepDef<TId extends string = string, TCtx = unknown> = {
  id: TId
  /** Rail label, sentence-case; CSS applies mono/uppercase/tracking. */
  label: string
  /** Body heading; defaults to `label`. */
  title?: string
  blurb?: string
  /** Branching. A step whose `enabled` returns false is skipped over entirely. */
  enabled?: (ctx: TCtx) => boolean
  /** Offers Skip; `validate` does not block Next. */
  optional?: boolean
  /** Return the reasons the user cannot leave this step; empty means go ahead. */
  validate?: (ctx: TCtx) => Array<string>
  /** In the flow, absent from the rail (splash / success / interstitial steps). */
  chromeless?: boolean
}

export type WizardState<TId extends string = string> = {
  currentId: TId
  status: Partial<Record<TId, WizardStatus>>
  errors: Partial<Record<TId, Array<string>>>
  finished: boolean
}

export type WizardAction<TId extends string = string> =
  | { type: 'GOTO'; id: TId }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'SKIP' }
  | { type: 'SET_ERRORS'; id: TId; errors: Array<string> }
  | { type: 'FINISH' }
  | { type: 'RESET'; id?: TId }
