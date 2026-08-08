import { describe, expect, it } from 'vitest'
import {
  AUTO_DETECT_GRACE_MS,
  INITIAL_GATE,
  reduceGate,
} from './onboarding-gate'
import type { OnboardingGate } from './onboarding-gate'
import type { OnboardingOutcome } from './onboarding-storage'

function engaged(): OnboardingGate {
  return reduceGate(INITIAL_GATE, { type: 'ENGAGED' })
}

describe('reduceGate', () => {
  it('regression: AUTO_DETECTED after ENGAGED never completes, so the wizard is not yanked out from under the user', () => {
    const prev = engaged()

    const next = reduceGate(prev, { type: 'AUTO_DETECTED', elapsedMs: 5 })

    expect(next).toBe(prev)
    expect(next.complete).toBe(false)
    expect(next.active).toBe(true)
  })

  it('AUTO_DETECTED inside the grace window and before engagement still completes (already-configured installs skip the wizard)', () => {
    const next = reduceGate(INITIAL_GATE, {
      type: 'AUTO_DETECTED',
      elapsedMs: AUTO_DETECT_GRACE_MS,
    })

    expect(next).toEqual({ complete: true, dismissed: false, active: false })
  })

  it('AUTO_DETECTED past the grace window is a no-op even before engagement', () => {
    const next = reduceGate(INITIAL_GATE, {
      type: 'AUTO_DETECTED',
      elapsedMs: AUTO_DETECT_GRACE_MS + 1,
    })

    expect(next).toBe(INITIAL_GATE)
    expect(next.complete).toBe(false)
  })

  it('WIZARD_DISMISSED settles as dismissed without claiming completion', () => {
    const next = reduceGate(engaged(), { type: 'WIZARD_DISMISSED' })

    expect(next).toEqual({ complete: false, dismissed: true, active: false })
  })

  it('WIZARD_FINISHED completes, is not dismissed, and clears engagement', () => {
    const next = reduceGate(engaged(), { type: 'WIZARD_FINISHED' })

    expect(next).toEqual({ complete: true, dismissed: false, active: false })
  })

  it('STORAGE_CHANGED to complete does not clear active (a cross-tab finish must not unmount this tab)', () => {
    const outcome: OnboardingOutcome = {
      kind: 'complete',
      at: 1,
      branch: 'quick',
      skipped: [],
    }

    const next = reduceGate(engaged(), { type: 'STORAGE_CHANGED', outcome })

    expect(next).toEqual({ complete: true, dismissed: false, active: true })
  })

  it('ENGAGED returns the same object when already engaged', () => {
    const prev = engaged()

    expect(reduceGate(prev, { type: 'ENGAGED' })).toBe(prev)
  })

  describe('HYDRATE maps every OnboardingOutcome kind', () => {
    const cases: Array<{
      name: string
      outcome: OnboardingOutcome
      expected: OnboardingGate
    }> = [
      {
        name: 'fresh',
        outcome: { kind: 'fresh' },
        expected: { complete: false, dismissed: false, active: false },
      },
      {
        name: 'in-progress',
        outcome: { kind: 'in-progress', stepId: 'provider', branch: 'full' },
        expected: { complete: false, dismissed: false, active: false },
      },
      {
        name: 'dismissed',
        outcome: { kind: 'dismissed', at: 42 },
        expected: { complete: false, dismissed: true, active: false },
      },
      {
        name: 'complete',
        outcome: { kind: 'complete', at: 42, branch: 'quick', skipped: [] },
        expected: { complete: true, dismissed: false, active: false },
      },
    ]

    for (const testCase of cases) {
      it(`HYDRATE with a ${testCase.name} outcome`, () => {
        expect(
          reduceGate(INITIAL_GATE, {
            type: 'HYDRATE',
            outcome: testCase.outcome,
          }),
        ).toEqual(testCase.expected)
      })
    }
  })

  it('never mutates the previous state', () => {
    const events: Array<Parameters<typeof reduceGate>[1]> = [
      { type: 'HYDRATE', outcome: { kind: 'dismissed', at: 1 } },
      { type: 'ENGAGED' },
      { type: 'AUTO_DETECTED', elapsedMs: 1 },
      { type: 'AUTO_DETECTED', elapsedMs: 10_000 },
      { type: 'WIZARD_FINISHED' },
      { type: 'WIZARD_DISMISSED' },
      {
        type: 'STORAGE_CHANGED',
        outcome: { kind: 'complete', at: 1, branch: 'full', skipped: [] },
      },
    ]

    for (const event of events) {
      const prev: OnboardingGate = {
        complete: false,
        dismissed: false,
        active: true,
      }
      const snapshot = { ...prev }

      reduceGate(prev, event)

      expect(prev).toEqual(snapshot)
    }
  })
})
