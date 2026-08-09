'use client'

/**
 * use-wizard.ts — React binding for `wizard-machine`.
 *
 * `useState` + `applyWizardAction`, deliberately NOT `useReducer`: the
 * transition depends on `ctx` (the caller's live draft), which changes on every
 * keystroke. A reducer only ever sees `(state, action)`, so it would validate
 * against whatever draft existed when the reducer was created. Instead `ctx`
 * and `steps` live in refs that are refreshed *during render*, so `next()`
 * always validates the values the user can currently see on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activeSteps,
  applyWizardAction,
  initialWizardState,
  isReachable as isReachableIn,
  nextStepId,
  prevStepId,
  progressLabel as progressLabelFor,
  railSteps,
  reconcileCurrentId,
  stepIndex,
} from './wizard-machine'
import type {
  WizardAction,
  WizardNavOptions,
  WizardState,
  WizardStatus,
  WizardStepDef,
} from './types'

export type UseWizardOptions<TId extends string, TCtx> = {
  steps: ReadonlyArray<WizardStepDef<TId, TCtx>>
  ctx: TCtx
  initialId?: TId
  initialState?: WizardState<TId>
  /**
   * Make every active step reachable from the rail. Defaults to false — the
   * visited-plus-one rule. See `isReachable` for why this is an opt-in.
   */
  freeNavigation?: boolean
  onStepChange?: (id: TId, state: WizardState<TId>) => void
  onFinish?: (state: WizardState<TId>) => void
}

export type UseWizardResult<TId extends string, TCtx> = {
  state: WizardState<TId>
  /** The current step definition, or undefined if `steps` is empty. */
  step: WizardStepDef<TId, TCtx> | undefined
  /** Steps shown in the stepper: enabled, minus chromeless ones. */
  rail: Array<WizardStepDef<TId, TCtx>>
  /** 0-based index of the current step in `rail`; -1 when it is chromeless. */
  index: number
  total: number
  /** `Step 3 of 6`, or '' when the current step is off-rail. */
  progressLabel: string
  errors: Array<string>
  canBack: boolean
  canSkip: boolean
  isLast: boolean
  next: () => void
  back: () => void
  skip: () => void
  goto: (id: TId) => void
  finish: () => void
  reset: (id?: TId) => void
  isReachable: (id: TId) => boolean
  statusOf: (id: TId) => WizardStatus
  dispatch: (action: WizardAction<TId>) => void
}

export function useWizard<TId extends string, TCtx>({
  steps,
  ctx,
  initialId,
  initialState,
  freeNavigation = false,
  onStepChange,
  onFinish,
}: UseWizardOptions<TId, TCtx>): UseWizardResult<TId, TCtx> {
  // Refreshed during render, before any callback can read them.
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const navRef = useRef<WizardNavOptions>({ freeNavigation })
  navRef.current = { freeNavigation }
  const onStepChangeRef = useRef(onStepChange)
  onStepChangeRef.current = onStepChange
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  const [state, setState] = useState<WizardState<TId>>(() => {
    if (initialState) return initialState
    // `.find` rather than `[0]` so the empty case is typed, not asserted away.
    const first =
      initialId ??
      activeSteps(steps, ctx).find(Boolean)?.id ??
      steps.find(Boolean)?.id
    if (first == null) {
      throw new Error('useWizard needs at least one step definition')
    }
    return initialWizardState(first)
  })

  // A branch flipping off can strand `currentId` on a step that no longer
  // exists. Snap back during render so nothing ever paints the dead step.
  const reconciled = reconcileCurrentId(steps, ctx, state.currentId)
  if (reconciled !== state.currentId) {
    setState((prev) =>
      prev.currentId === state.currentId
        ? {
            ...prev,
            currentId: reconciled,
            status: {
              ...prev.status,
              [reconciled]: prev.status[reconciled] ?? 'active',
            },
          }
        : prev,
    )
  }

  const currentId = reconciled
  const step = useMemo(
    () => steps.find((entry) => entry.id === currentId),
    [steps, currentId],
  )
  const rail = useMemo(() => railSteps(steps, ctx), [steps, ctx])
  const progress = useMemo(
    () => progressLabelFor(steps, ctx, currentId),
    [steps, ctx, currentId],
  )

  const dispatch = useCallback((action: WizardAction<TId>) => {
    setState((prev) =>
      applyWizardAction(
        stepsRef.current,
        ctxRef.current,
        prev,
        action,
        navRef.current,
      ),
    )
  }, [])

  const next = useCallback(() => dispatch({ type: 'NEXT' }), [dispatch])
  const back = useCallback(() => dispatch({ type: 'BACK' }), [dispatch])
  const skip = useCallback(() => dispatch({ type: 'SKIP' }), [dispatch])
  const finish = useCallback(() => dispatch({ type: 'FINISH' }), [dispatch])
  const goto = useCallback(
    (id: TId) => dispatch({ type: 'GOTO', id }),
    [dispatch],
  )
  const reset = useCallback(
    (id?: TId) => dispatch({ type: 'RESET', id }),
    [dispatch],
  )

  const isReachable = useCallback(
    (id: TId) =>
      isReachableIn(steps, ctx, { ...state, currentId }, id, {
        freeNavigation,
      }),
    [steps, ctx, state, currentId, freeNavigation],
  )
  const statusOf = useCallback(
    (id: TId): WizardStatus => state.status[id] ?? 'pending',
    [state],
  )

  // Fire on transitions only — mounting is not a step change.
  const lastNotified = useRef<TId | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    if (lastNotified.current === null) {
      lastNotified.current = currentId
      return
    }
    if (lastNotified.current === currentId) return
    lastNotified.current = currentId
    onStepChangeRef.current?.(currentId, stateRef.current)
  }, [currentId])

  const wasFinished = useRef(state.finished)
  useEffect(() => {
    if (state.finished && !wasFinished.current) {
      onFinishRef.current?.(state)
    }
    wasFinished.current = state.finished
  }, [state])

  return {
    state: state.currentId === currentId ? state : { ...state, currentId },
    step,
    rail,
    index: stepIndex(rail, currentId),
    total: rail.length,
    progressLabel: progress.label,
    errors: state.errors[currentId] ?? [],
    canBack: prevStepId(steps, ctx, currentId) != null,
    canSkip: step?.optional === true,
    isLast: nextStepId(steps, ctx, currentId) == null,
    next,
    back,
    skip,
    goto,
    finish,
    reset,
    isReachable,
    statusOf,
    dispatch,
  }
}
