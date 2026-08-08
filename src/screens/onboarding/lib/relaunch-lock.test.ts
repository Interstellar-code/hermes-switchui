import { describe, expect, it } from 'vitest'

import { canWriteConfig } from './relaunch-lock'
import { ONBOARDING_STEPS } from './onboarding-steps'
import type { OnboardingStepId } from './onboarding-steps'
import type { OnboardingMode } from './onboarding-mode'

const ALL_STEP_IDS: Array<OnboardingStepId> = ONBOARDING_STEPS.map(
  (step) => step.id,
)
const ALL_MODES: Array<OnboardingMode> = ['first-run', 'resume', 'relaunch']

describe('canWriteConfig — full matrix', () => {
  for (const mode of ALL_MODES) {
    for (const stepId of ALL_STEP_IDS) {
      for (const unlocked of [true, false]) {
        const expected =
          mode === 'relaunch' ? stepId !== 'summary' && unlocked : true

        it(`mode=${mode} stepId=${stepId} unlocked=${unlocked} → ${expected}`, () => {
          expect(canWriteConfig({ mode, unlocked, stepId })).toBe(expected)
        })
      }
    }
  }
})

describe('canWriteConfig — contract summary', () => {
  it('first-run always allows writes, on every step', () => {
    for (const stepId of ALL_STEP_IDS) {
      expect(
        canWriteConfig({ mode: 'first-run', unlocked: false, stepId }),
      ).toBe(true)
      expect(
        canWriteConfig({ mode: 'first-run', unlocked: true, stepId }),
      ).toBe(true)
    }
  })

  it('resume always allows writes, on every step', () => {
    for (const stepId of ALL_STEP_IDS) {
      expect(canWriteConfig({ mode: 'resume', unlocked: false, stepId })).toBe(
        true,
      )
      expect(canWriteConfig({ mode: 'resume', unlocked: true, stepId })).toBe(
        true,
      )
    }
  })

  it('relaunch blocks the summary step even when unlocked', () => {
    expect(
      canWriteConfig({ mode: 'relaunch', unlocked: true, stepId: 'summary' }),
    ).toBe(false)
  })

  it('relaunch blocks every other step unless unlocked', () => {
    for (const stepId of ALL_STEP_IDS.filter((id) => id !== 'summary')) {
      expect(
        canWriteConfig({ mode: 'relaunch', unlocked: false, stepId }),
      ).toBe(false)
      expect(canWriteConfig({ mode: 'relaunch', unlocked: true, stepId })).toBe(
        true,
      )
    }
  })
})
