import { describe, expect, it } from 'vitest'
import {
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
import type { WizardAction, WizardState, WizardStepDef } from './types'

/**
 * The machine is pure, so these tests are the specification: every branch,
 * validation and reachability rule the React binding relies on is pinned here
 * rather than in a rendered wizard, where a broken transition would surface as
 * an unexplained blank step.
 */

type Ctx = { mode: 'simple' | 'advanced'; name: string }
type Id = 'intro' | 'name' | 'extras' | 'advanced' | 'splash' | 'done'

const STEPS: Array<WizardStepDef<Id, Ctx>> = [
  { id: 'intro', label: 'Intro' },
  {
    id: 'name',
    label: 'Name',
    validate: (ctx) => (ctx.name ? [] : ['Name is required']),
  },
  { id: 'extras', label: 'Extras', optional: true },
  {
    id: 'advanced',
    label: 'Advanced',
    enabled: (ctx) => ctx.mode === 'advanced',
  },
  { id: 'splash', label: 'Splash', chromeless: true },
  { id: 'done', label: 'Done' },
]

const SIMPLE: Ctx = { mode: 'simple', name: 'x' }
const ADVANCED: Ctx = { mode: 'advanced', name: 'x' }
const BLANK: Ctx = { mode: 'simple', name: '' }

function run(
  ctx: Ctx,
  state: WizardState<Id>,
  ...actions: Array<WizardAction<Id>>
): WizardState<Id> {
  return actions.reduce(
    (acc, action) => applyWizardAction(STEPS, ctx, acc, action),
    state,
  )
}

const start = () => initialWizardState<Id>('intro')

describe('initialWizardState', () => {
  it('marks the first step visited so it is reachable immediately', () => {
    expect(start()).toEqual({
      currentId: 'intro',
      status: { intro: 'active' },
      errors: {},
      finished: false,
    })
  })
})

describe('step lists', () => {
  it('filters by enabled()', () => {
    expect(activeSteps(STEPS, SIMPLE).map((s) => s.id)).toEqual([
      'intro',
      'name',
      'extras',
      'splash',
      'done',
    ])
    expect(activeSteps(STEPS, ADVANCED).map((s) => s.id)).toEqual([
      'intro',
      'name',
      'extras',
      'advanced',
      'splash',
      'done',
    ])
  })

  it('drops chromeless steps from the rail but keeps them in the flow', () => {
    expect(railSteps(STEPS, SIMPLE).map((s) => s.id)).toEqual([
      'intro',
      'name',
      'extras',
      'done',
    ])
    expect(stepIndex(activeSteps(STEPS, SIMPLE), 'splash')).toBe(3)
  })
})

describe('NEXT / BACK hop over disabled steps', () => {
  it('skips a disabled step going forward', () => {
    expect(nextStepId(STEPS, SIMPLE, 'extras')).toBe('splash')
    expect(nextStepId(STEPS, ADVANCED, 'extras')).toBe('advanced')
  })

  it('skips a disabled step going backward', () => {
    expect(prevStepId(STEPS, SIMPLE, 'splash')).toBe('extras')
    expect(prevStepId(STEPS, ADVANCED, 'splash')).toBe('advanced')
  })

  it('applies the hop through NEXT and BACK', () => {
    const atExtras = run(SIMPLE, start(), { type: 'NEXT' }, { type: 'NEXT' })
    expect(atExtras.currentId).toBe('extras')

    const forward = run(SIMPLE, atExtras, { type: 'NEXT' })
    expect(forward.currentId).toBe('splash')

    const backward = run(SIMPLE, forward, { type: 'BACK' })
    expect(backward.currentId).toBe('extras')
  })

  it('has no previous step at the head of the flow', () => {
    expect(prevStepId(STEPS, SIMPLE, 'intro')).toBeNull()
    expect(run(SIMPLE, start(), { type: 'BACK' })).toEqual(start())
  })
})

describe('validation gates NEXT', () => {
  it('records errors and does not move when validate fails', () => {
    const atName = run(BLANK, start(), { type: 'NEXT' })
    expect(atName.currentId).toBe('name')

    const blocked = run(BLANK, atName, { type: 'NEXT' })
    expect(blocked.currentId).toBe('name')
    expect(blocked.errors.name).toEqual(['Name is required'])
    expect(blocked.status).toEqual(atName.status)
    expect(blocked.finished).toBe(false)
  })

  it('clears the recorded errors once validate passes', () => {
    const blocked = run(BLANK, start(), { type: 'NEXT' }, { type: 'NEXT' })
    expect(blocked.errors.name).toHaveLength(1)

    // Same state, a ctx where the field is filled in — the draft changed under it.
    const moved = run(SIMPLE, blocked, { type: 'NEXT' })
    expect(moved.errors.name).toBeUndefined()
    expect(moved.status.name).toBe('done')
    expect(moved.currentId).toBe('extras')
  })

  it('never blocks an optional step, even when its validate fails', () => {
    const optionalStep: WizardStepDef<Id, Ctx> = {
      id: 'extras',
      label: 'Extras',
      optional: true,
      validate: () => ['nope'],
    }
    expect(canLeave(optionalStep, SIMPLE)).toEqual({ ok: true })
    expect(canLeave(STEPS[1], BLANK)).toEqual({
      ok: false,
      errors: ['Name is required'],
    })
  })
})

describe('SKIP', () => {
  it('is a no-op on a step that is not optional', () => {
    const atName = run(SIMPLE, start(), { type: 'NEXT' })
    expect(run(SIMPLE, atName, { type: 'SKIP' })).toEqual(atName)
  })

  it('marks an optional step skipped and moves on', () => {
    const atExtras = run(SIMPLE, start(), { type: 'NEXT' }, { type: 'NEXT' })
    const skipped = run(SIMPLE, atExtras, { type: 'SKIP' })
    expect(skipped.status.extras).toBe('skipped')
    expect(skipped.currentId).toBe('splash')
  })
})

describe('isReachable', () => {
  const atName = run(SIMPLE, start(), { type: 'NEXT' })

  it('allows a step already visited', () => {
    expect(isReachable(STEPS, SIMPLE, atName, 'intro')).toBe(true)
    expect(isReachable(STEPS, SIMPLE, atName, 'name')).toBe(true)
  })

  it('allows the immediate next step', () => {
    expect(isReachable(STEPS, SIMPLE, atName, 'extras')).toBe(true)
  })

  it('refuses a step two ahead', () => {
    expect(isReachable(STEPS, SIMPLE, atName, 'splash')).toBe(false)
    expect(isReachable(STEPS, SIMPLE, atName, 'done')).toBe(false)
  })

  it('refuses a step the current ctx disabled', () => {
    const atExtras = run(SIMPLE, atName, { type: 'NEXT' })
    expect(isReachable(STEPS, SIMPLE, atExtras, 'advanced')).toBe(false)
    expect(isReachable(STEPS, ADVANCED, atExtras, 'advanced')).toBe(true)
  })
})

describe('GOTO', () => {
  it('moves to a reachable step', () => {
    const atExtras = run(SIMPLE, start(), { type: 'NEXT' }, { type: 'NEXT' })
    const back = run(SIMPLE, atExtras, { type: 'GOTO', id: 'intro' })
    expect(back.currentId).toBe('intro')
  })

  it('is a no-op for an unreachable step', () => {
    const atName = run(SIMPLE, start(), { type: 'NEXT' })
    expect(run(SIMPLE, atName, { type: 'GOTO', id: 'done' })).toEqual(atName)
  })
})

describe('progressLabel', () => {
  it('is rail-relative and renumbers when ctx flips the branch', () => {
    expect(progressLabel(STEPS, SIMPLE, 'done')).toEqual({
      position: 4,
      total: 4,
      label: 'Step 4 of 4',
    })
    expect(progressLabel(STEPS, ADVANCED, 'done')).toEqual({
      position: 5,
      total: 5,
      label: 'Step 5 of 5',
    })
  })

  it('gives chromeless steps no position and no label', () => {
    expect(progressLabel(STEPS, SIMPLE, 'splash')).toEqual({
      position: 0,
      total: 4,
      label: '',
    })
  })
})

describe('finishing', () => {
  it('sets finished and stays put when NEXT runs off the end', () => {
    const atDone: WizardState<Id> = {
      ...start(),
      currentId: 'done',
      status: { done: 'active' },
    }
    const finished = run(SIMPLE, atDone, { type: 'NEXT' })
    expect(finished.finished).toBe(true)
    expect(finished.currentId).toBe('done')
    expect(finished.status.done).toBe('done')
  })

  it('FINISH marks the current step done', () => {
    const atName = run(SIMPLE, start(), { type: 'NEXT' }, { type: 'FINISH' })
    expect(atName.finished).toBe(true)
    expect(atName.status.name).toBe('done')
  })
})

describe('SET_ERRORS and RESET', () => {
  it('records errors for an arbitrary step', () => {
    const withErrors = run(SIMPLE, start(), {
      type: 'SET_ERRORS',
      id: 'name',
      errors: ['boom'],
    })
    expect(withErrors.errors.name).toEqual(['boom'])
  })

  it('RESET returns to the first active step, or a named one', () => {
    const deep = run(SIMPLE, start(), { type: 'NEXT' }, { type: 'NEXT' })
    expect(run(SIMPLE, deep, { type: 'RESET' })).toEqual(start())
    expect(run(SIMPLE, deep, { type: 'RESET', id: 'name' })).toEqual(
      initialWizardState<Id>('name'),
    )
  })
})

describe('reconcileCurrentId', () => {
  it('leaves an active step alone', () => {
    expect(reconcileCurrentId(STEPS, ADVANCED, 'advanced')).toBe('advanced')
  })

  it('snaps to the nearest earlier active step when the branch closes', () => {
    expect(reconcileCurrentId(STEPS, SIMPLE, 'advanced')).toBe('extras')
  })

  it('falls forward to the first active step when nothing precedes it', () => {
    const onlyLater: Array<WizardStepDef<Id, Ctx>> = [
      { id: 'intro', label: 'Intro', enabled: () => false },
      { id: 'name', label: 'Name' },
    ]
    expect(reconcileCurrentId(onlyLater, SIMPLE, 'intro')).toBe('name')
  })
})
