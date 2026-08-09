import { describe, expect, it } from 'vitest'

import { resolveEntryStep } from './onboarding-mode'
import type { OnboardingOutcome } from './onboarding-storage'

const FRESH: OnboardingOutcome = { kind: 'fresh' }
const IN_PROGRESS: OnboardingOutcome = {
  kind: 'in-progress',
  stepId: 'connect',
  branch: 'full',
}
const DISMISSED: OnboardingOutcome = { kind: 'dismissed', at: 1000 }
const COMPLETE: OnboardingOutcome = {
  kind: 'complete',
  at: 1000,
  branch: 'quick',
  skipped: [],
  completed: [],
}

describe('resolveEntryStep', () => {
  it('relaunch always lands on the stepped full flow, no matter the outcome', () => {
    // The summary used to be the relaunch front door. It is now a deep-link
    // destination only: clicking "Setup Wizard" on a working install opens the
    // rail on the first step, not a landing page to click through.
    for (const outcome of [FRESH, IN_PROGRESS, DISMISSED, COMPLETE]) {
      for (const hasWorkingProvider of [true, false]) {
        expect(
          resolveEntryStep({ mode: 'relaunch', outcome, hasWorkingProvider }),
        ).toEqual({ stepId: 'system-check', branch: 'full' })
      }
    }
  })

  it('relaunch outranks an in-progress draft rather than resuming it', () => {
    // Pinned separately from the loop above because it is the one case where
    // two rules genuinely conflict: a half-finished first-run draft must not
    // be what a returning user sees when they open settings.
    expect(
      resolveEntryStep({
        mode: 'relaunch',
        outcome: IN_PROGRESS,
        hasWorkingProvider: false,
      }),
    ).toEqual({ stepId: 'system-check', branch: 'full' })
  })

  it('first-run with a working provider goes to summary even with a fresh outcome', () => {
    expect(
      resolveEntryStep({
        mode: 'first-run',
        outcome: FRESH,
        hasWorkingProvider: true,
      }),
    ).toEqual({ stepId: 'summary', branch: 'summary' })
  })

  it('an in-progress outcome resumes at its own step and branch, for first-run and resume', () => {
    for (const mode of ['first-run', 'resume'] as const) {
      expect(
        resolveEntryStep({
          mode,
          outcome: IN_PROGRESS,
          hasWorkingProvider: false,
        }),
      ).toEqual({ stepId: 'connect', branch: 'full' })
    }
  })

  it('hasWorkingProvider outranks an in-progress draft on first-run', () => {
    // hasWorkingProvider is checked before outcome in the precedence order,
    // so a working provider always wins over an in-progress draft on
    // first-run — this pins that ordering rather than leaving it implicit.
    expect(
      resolveEntryStep({
        mode: 'first-run',
        outcome: IN_PROGRESS,
        hasWorkingProvider: true,
      }),
    ).toEqual({ stepId: 'summary', branch: 'summary' })
  })

  it('falls back to welcome/quick for a fresh outcome with no working provider', () => {
    expect(
      resolveEntryStep({
        mode: 'first-run',
        outcome: FRESH,
        hasWorkingProvider: false,
      }),
    ).toEqual({ stepId: 'welcome', branch: 'quick' })
  })

  it('falls back to welcome/quick for a dismissed or complete outcome, on resume', () => {
    for (const outcome of [DISMISSED, COMPLETE]) {
      expect(
        resolveEntryStep({
          mode: 'resume',
          outcome,
          hasWorkingProvider: false,
        }),
      ).toEqual({ stepId: 'welcome', branch: 'quick' })
    }
  })
})
