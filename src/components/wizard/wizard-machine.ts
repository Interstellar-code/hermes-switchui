/**
 * wizard-machine.ts — the pure half of the wizard shell. No React import: every
 * function here is a total function of (steps, ctx, state, action).
 *
 * Why a function rather than a reducer: the transition depends on `ctx`, the
 * caller's live draft, which changes on every keystroke. A `useReducer` would
 * close over a stale `ctx` and validate the wrong values, so `applyWizardAction`
 * takes `ctx` explicitly and `use-wizard` feeds it the freshest one it has.
 *
 * `status` records the *visit outcome* of a step, not "is this the current
 * step" — `state.currentId` answers that. So `'active'` means "visited, not yet
 * completed", and the presence of any status at all means "visited", which is
 * what `isReachable` keys off.
 */
import type {
  WizardAction,
  WizardNavOptions,
  WizardState,
  WizardStepDef,
} from './types'

export function initialWizardState<TId extends string>(
  firstId: TId,
): WizardState<TId> {
  return {
    currentId: firstId,
    status: { [firstId]: 'active' } as WizardState<TId>['status'],
    errors: {},
    finished: false,
  }
}

/** Steps the current `ctx` actually routes through. */
export function activeSteps<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
): Array<WizardStepDef<TId, TCtx>> {
  return steps.filter((step) => step.enabled?.(ctx) ?? true)
}

/** Active steps that appear in the stepper rail. */
export function railSteps<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
): Array<WizardStepDef<TId, TCtx>> {
  return activeSteps(steps, ctx).filter((step) => !step.chromeless)
}

export function stepIndex<TId extends string>(
  list: ReadonlyArray<{ id: TId }>,
  id: TId,
): number {
  return list.findIndex((entry) => entry.id === id)
}

export function nextStepId<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
  from: TId,
): TId | null {
  const active = activeSteps(steps, ctx)
  const index = stepIndex(active, from)
  if (index < 0) return null
  return active[index + 1]?.id ?? null
}

export function prevStepId<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
  from: TId,
): TId | null {
  const active = activeSteps(steps, ctx)
  const index = stepIndex(active, from)
  if (index <= 0) return null
  return active[index - 1]?.id ?? null
}

/**
 * Optional steps never block: their `validate` output is advisory, and Skip is
 * the escape hatch the footer offers instead.
 */
export function canLeave<TId extends string, TCtx>(
  step: WizardStepDef<TId, TCtx> | undefined,
  ctx: TCtx,
): { ok: true } | { ok: false; errors: Array<string> } {
  if (!step) return { ok: true }
  const errors = step.validate?.(ctx) ?? []
  if (errors.length === 0 || step.optional) return { ok: true }
  return { ok: false, errors }
}

/**
 * Visited steps, plus the one immediately ahead. Nothing further — unless the
 * consumer opts into `freeNavigation`, in which case every *active* step is
 * reachable and the rail becomes a plain tab bar.
 *
 * The opt-in exists because the default is a teaching aid, not a safety
 * mechanism: it walks a first-time user through the flow in order. A returning
 * user opening the same wizard as a settings surface already knows which step
 * they want, and gating it behind "visit every step in between" is friction
 * with nothing behind it. It is never a permission — a step still has to be
 * `enabled(ctx)` to be reachable at all, and writes answer to their own gate.
 */
export function isReachable<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
  state: WizardState<TId>,
  target: TId,
  options: WizardNavOptions = {},
): boolean {
  const active = activeSteps(steps, ctx)
  if (stepIndex(active, target) < 0) return false
  if (options.freeNavigation) return true
  if (state.status[target] != null) return true
  return nextStepId(steps, ctx, state.currentId) === target
}

/**
 * Rail-relative progress. Chromeless and disabled steps are not in the rail, so
 * they report position 0 and an empty label rather than a misleading number.
 */
export function progressLabel<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
  id: TId,
): { position: number; total: number; label: string } {
  const rail = railSteps(steps, ctx)
  const index = stepIndex(rail, id)
  if (index < 0) return { position: 0, total: rail.length, label: '' }
  const position = index + 1
  return {
    position,
    total: rail.length,
    label: `Step ${position} of ${rail.length}`,
  }
}

/**
 * The current step can stop existing mid-flow when `ctx` flips a branch off.
 * Snap to the nearest *earlier* active step so the user lands somewhere they
 * have already seen, never somewhere they have not filled in yet.
 */
export function reconcileCurrentId<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
  currentId: TId,
): TId {
  const active = activeSteps(steps, ctx)
  if (active.length === 0) return currentId
  if (stepIndex(active, currentId) >= 0) return currentId

  const declaredIndex = stepIndex(steps, currentId)
  if (declaredIndex >= 0) {
    for (let i = declaredIndex - 1; i >= 0; i -= 1) {
      const candidate = steps[i]
      if (candidate.enabled?.(ctx) ?? true) return candidate.id
    }
  }
  return active[0].id
}

function withStatus<TId extends string>(
  state: WizardState<TId>,
  id: TId,
  status: NonNullable<WizardState<TId>['status'][TId]>,
): WizardState<TId>['status'] {
  return { ...state.status, [id]: status }
}

export function applyWizardAction<TId extends string, TCtx>(
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>,
  ctx: TCtx,
  state: WizardState<TId>,
  action: WizardAction<TId>,
  options: WizardNavOptions = {},
): WizardState<TId> {
  const current = steps.find((step) => step.id === state.currentId)

  switch (action.type) {
    case 'GOTO': {
      if (action.id === state.currentId) return state
      if (!isReachable(steps, ctx, state, action.id, options)) return state
      return {
        ...state,
        currentId: action.id,
        status: {
          ...state.status,
          [action.id]: state.status[action.id] ?? 'active',
        },
      }
    }

    case 'NEXT': {
      const verdict = canLeave(current, ctx)
      if (!verdict.ok) {
        return {
          ...state,
          errors: { ...state.errors, [state.currentId]: verdict.errors },
        }
      }
      const errors = { ...state.errors }
      delete errors[state.currentId]
      const target = nextStepId(steps, ctx, state.currentId)
      if (target == null) {
        return {
          ...state,
          errors,
          status: withStatus(state, state.currentId, 'done'),
          finished: true,
        }
      }
      return {
        ...state,
        errors,
        currentId: target,
        status: {
          ...withStatus(state, state.currentId, 'done'),
          [target]: state.status[target] ?? 'active',
        },
      }
    }

    case 'BACK': {
      const target = prevStepId(steps, ctx, state.currentId)
      if (target == null) return state
      return {
        ...state,
        currentId: target,
        status: {
          ...state.status,
          [target]: state.status[target] ?? 'active',
        },
      }
    }

    case 'SKIP': {
      if (!current?.optional) return state
      const errors = { ...state.errors }
      delete errors[state.currentId]
      const target = nextStepId(steps, ctx, state.currentId)
      if (target == null) {
        return {
          ...state,
          errors,
          status: withStatus(state, state.currentId, 'skipped'),
          finished: true,
        }
      }
      return {
        ...state,
        errors,
        currentId: target,
        status: {
          ...withStatus(state, state.currentId, 'skipped'),
          [target]: state.status[target] ?? 'active',
        },
      }
    }

    case 'SET_ERRORS': {
      return {
        ...state,
        errors: { ...state.errors, [action.id]: action.errors },
      }
    }

    case 'FINISH': {
      return {
        ...state,
        status: withStatus(state, state.currentId, 'done'),
        finished: true,
      }
    }

    case 'RESET': {
      // `.find` rather than `[0]` so an empty step list is a value, not a throw.
      const fallback =
        activeSteps(steps, ctx).find(Boolean)?.id ?? steps.find(Boolean)?.id
      const target = action.id ?? fallback
      if (target == null) return state
      return initialWizardState(target)
    }
  }
}
