import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_STEPS,
  validateConnectStep,
  validateProviderStep,
  validateReviewStep,
} from './onboarding-steps'
import { ONBOARDING_DRAFT_VERSION } from './onboarding-storage'
import type { OnboardingCtx } from './onboarding-steps'
import type { OnboardingDraft } from './onboarding-storage'
import {
  nextStepId,
  prevStepId,
  railSteps,
} from '@/components/wizard/wizard-machine'

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    branch: 'quick',
    stepId: 'welcome',
    providerId: null,
    baseUrl: '',
    envKey: '',
    defaultModel: '',
    makeActive: false,
    themeId: null,
    skipped: [],
    completed: [],
    savedAt: 0,
    ...overrides,
  }
}

function ctx(overrides: Partial<OnboardingCtx> = {}): OnboardingCtx {
  return {
    branch: 'quick',
    mode: 'first-run',
    dirty: false,
    draft: draft(),
    saved: false,
    hasStoredKey: false,
    catalogBaseUrl: null,
    canWrite: true,
    ...overrides,
  }
}

describe('ONBOARDING_STEPS rail', () => {
  it('QUICK rail is exactly provider, connect, review, verify', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ branch: 'quick' })).map(
      (step) => step.id,
    )
    expect(ids).toEqual(['provider', 'connect', 'review', 'verify'])
  })

  it('FULL rail is exactly system-check, provider, connect, review, verify, profile, memory, plugins, theme', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ branch: 'full' })).map(
      (step) => step.id,
    )
    // `profile` sits after `verify` and before `plugins`: switching the agent
    // identity only makes sense once the provider behind it is known to work,
    // and it shares the plugins step's "nothing happens until the gateway
    // restarts" caveat, so the two read as one band. `memory` joins that band
    // between them — it is a property of the identity chosen on the step
    // before, and it carries the same restart caveat.
    expect(ids).toEqual([
      'system-check',
      'provider',
      'connect',
      'review',
      'verify',
      'profile',
      'memory',
      'plugins',
      'theme',
    ])
    expect(ids).toHaveLength(9)
  })

  it('drops review from the FULL relaunch rail until the draft is dirty', () => {
    const clean = railSteps(
      ONBOARDING_STEPS,
      ctx({ branch: 'full', mode: 'relaunch', dirty: false }),
    ).map((step) => step.id)
    expect(clean).toEqual([
      'system-check',
      'provider',
      'connect',
      'verify',
      'profile',
      'memory',
      'plugins',
      'theme',
    ])
    expect(clean).toHaveLength(8)

    const dirty = railSteps(
      ONBOARDING_STEPS,
      ctx({ branch: 'full', mode: 'relaunch', dirty: true }),
    ).map((step) => step.id)
    expect(dirty).toContain('review')
    expect(dirty).toHaveLength(9)
    // It reappears in place, not at the end: `verify` reads the gateway for
    // the provider named in the draft, so a save that has not happened yet
    // would make verify report on the old configuration.
    expect(dirty.indexOf('review')).toBeLessThan(dirty.indexOf('verify'))
  })

  it('keeps review on first-run and resume whether or not anything is dirty', () => {
    for (const mode of ['first-run', 'resume'] as const) {
      for (const dirty of [false, true]) {
        const ids = railSteps(
          ONBOARDING_STEPS,
          ctx({ branch: 'full', mode, dirty }),
        ).map((step) => step.id)
        expect(ids, `${mode}/${dirty}`).toContain('review')
      }
    }
  })

  it('drops review entirely when the run may not write', () => {
    // Reviewing a configuration you are not permitted to save is a step with
    // no purpose; `validateReviewStep` already refuses to block there, and
    // removing it from the rail means it cannot be reached at all.
    for (const mode of ['first-run', 'relaunch'] as const) {
      const ids = railSteps(
        ONBOARDING_STEPS,
        ctx({ branch: 'full', mode, dirty: true, canWrite: false }),
      ).map((step) => step.id)
      expect(ids, mode).not.toContain('review')
    }
  })

  it('never blocks navigation with a review step that is not on the rail', () => {
    // A step that is not in `activeSteps` cannot gate NEXT — the machine only
    // validates the step it is standing on, and hops the missing one in both
    // directions. This is what makes the conditional review safe.
    const relaunchClean = ctx({
      branch: 'full',
      mode: 'relaunch',
      dirty: false,
      saved: false,
    })
    expect(nextStepId(ONBOARDING_STEPS, relaunchClean, 'connect')).toBe(
      'verify',
    )
    expect(prevStepId(ONBOARDING_STEPS, relaunchClean, 'verify')).toBe(
      'connect',
    )

    const relaunchDirty = ctx({
      branch: 'full',
      mode: 'relaunch',
      dirty: true,
      saved: false,
    })
    expect(nextStepId(ONBOARDING_STEPS, relaunchDirty, 'connect')).toBe(
      'review',
    )
    expect(prevStepId(ONBOARDING_STEPS, relaunchDirty, 'verify')).toBe('review')
  })

  it('the memory step exists on the full branch only', () => {
    const memory = ONBOARDING_STEPS.find((step) => step.id === 'memory')
    expect(memory).toBeDefined()
    expect(memory?.enabled?.(ctx({ branch: 'full' }))).toBe(true)
    expect(memory?.enabled?.(ctx({ branch: 'quick' }))).toBe(false)
    expect(memory?.enabled?.(ctx({ branch: 'summary' }))).toBe(false)
    // Choosing a memory provider is never a precondition for finishing setup.
    expect(memory?.validate).toBeUndefined()
  })

  it('the profile step exists on the full branch only', () => {
    const profile = ONBOARDING_STEPS.find((step) => step.id === 'profile')
    expect(profile).toBeDefined()
    expect(profile?.enabled?.(ctx({ branch: 'full' }))).toBe(true)
    expect(profile?.enabled?.(ctx({ branch: 'quick' }))).toBe(false)
    expect(profile?.enabled?.(ctx({ branch: 'summary' }))).toBe(false)
    // Activation is never a precondition for finishing setup.
    expect(profile?.validate).toBeUndefined()
  })

  it('SUMMARY rail is empty', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ branch: 'summary' })).map(
      (step) => step.id,
    )
    expect(ids).toEqual([])
  })

  it('provider, connect, and review are never optional', () => {
    for (const branch of ['quick', 'full'] as const) {
      for (const id of ['provider', 'connect', 'review'] as const) {
        const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id)
        expect(step?.optional, `${id} in ${branch}`).not.toBe(true)
      }
    }
  })

  it('welcome, finish, and summary are chromeless', () => {
    for (const id of ['welcome', 'finish', 'summary'] as const) {
      const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id)
      expect(step?.chromeless).toBe(true)
    }
  })

  it("the finish step's title matches FinishStep's own visible heading", () => {
    // Both render on the same screen — the shell title above, the <h3> below.
    // They disagreed ("You're set" vs "Setup complete"), and the former is not
    // the house voice.
    const finish = ONBOARDING_STEPS.find((step) => step.id === 'finish')
    expect(finish?.title).toBe('Setup complete')
  })

  it('has no duplicate ids', () => {
    const ids = ONBOARDING_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('system-check, verify, profile, memory, plugins, and theme are optional', () => {
    for (const id of [
      'system-check',
      'verify',
      'profile',
      'memory',
      'plugins',
      'theme',
    ] as const) {
      const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id)
      expect(step?.optional).toBe(true)
    }
  })
})

describe('validateProviderStep', () => {
  it('requires a provider', () => {
    expect(validateProviderStep(ctx())).toEqual([
      'Choose a provider to continue',
    ])
  })

  it('passes once a provider is chosen', () => {
    expect(
      validateProviderStep(ctx({ draft: draft({ providerId: 'anthropic' }) })),
    ).toEqual([])
  })
})

describe('validateConnectStep', () => {
  it("is silent when no provider is chosen yet — that is the provider step's job", () => {
    expect(validateConnectStep(ctx())).toEqual([])
  })

  it('requires a base URL for an api-key provider with no catalog default', () => {
    const errors = validateConnectStep(
      ctx({
        draft: draft({ providerId: 'manifest', baseUrl: '' }),
        catalogBaseUrl: null,
        hasStoredKey: true,
      }),
    )
    expect(errors).toContain(
      'Enter the base URL for this provider before continuing.',
    )
  })

  it('does not require a base URL once catalog default exists', () => {
    const errors = validateConnectStep(
      ctx({
        draft: draft({ providerId: 'anthropic', baseUrl: '' }),
        catalogBaseUrl: 'https://api.anthropic.com/v1',
        hasStoredKey: true,
      }),
    )
    expect(errors).toEqual([])
  })

  it('does not require a base URL for an oauth-only provider', () => {
    const errors = validateConnectStep(
      ctx({
        draft: draft({ providerId: 'nous', baseUrl: '' }),
        catalogBaseUrl: null,
        hasStoredKey: true,
      }),
    )
    expect(errors).toEqual([])
  })

  it('requires an API key for api-key providers when none is stored or typed', () => {
    const errors = validateConnectStep(
      ctx({
        draft: {
          ...draft({ providerId: 'anthropic', baseUrl: '' }),
          apiKey: '',
        },
        catalogBaseUrl: 'https://api.anthropic.com/v1',
        hasStoredKey: false,
      }),
    )
    expect(errors).toContain(
      'Enter an API key to continue — this provider requires one.',
    )
  })

  it('skips the API key requirement when a key is already stored', () => {
    const errors = validateConnectStep(
      ctx({
        draft: draft({ providerId: 'anthropic' }),
        catalogBaseUrl: 'https://api.anthropic.com/v1',
        hasStoredKey: true,
      }),
    )
    expect(errors).toEqual([])
  })

  it('skips the API key requirement when one has been typed', () => {
    const errors = validateConnectStep(
      ctx({
        draft: { ...draft({ providerId: 'anthropic' }), apiKey: 'sk-typed' },
        catalogBaseUrl: 'https://api.anthropic.com/v1',
        hasStoredKey: false,
      }),
    )
    expect(errors).toEqual([])
  })
})

describe('validateReviewStep', () => {
  it('blocks until saved', () => {
    expect(validateReviewStep(ctx({ saved: false }))).toEqual([
      'Press Save to write the configuration',
    ])
  })

  it('passes once saved', () => {
    expect(validateReviewStep(ctx({ saved: true }))).toEqual([])
  })

  it('does not block when the run is not permitted to write', () => {
    // A locked relaunch disables Save and `save()` refuses, so `saved` can
    // never become true. Requiring it made review a dead end: Next blocked
    // forever, no Skip offered, only Back or Close. A step the user cannot
    // complete must not be allowed to trap them.
    expect(validateReviewStep(ctx({ saved: false, canWrite: false }))).toEqual(
      [],
    )
  })

  it('still blocks an unsaved review once writing is permitted again', () => {
    expect(validateReviewStep(ctx({ saved: false, canWrite: true }))).toEqual([
      'Press Save to write the configuration',
    ])
  })
})
