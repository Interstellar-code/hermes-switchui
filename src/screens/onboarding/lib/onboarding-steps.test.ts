import { describe, expect, it } from 'vitest'

import {
  ONBOARDING_STEPS,
  RETIRED_STEP_ALIASES,
  extrasUnlocked,
  resolveStepAlias,
  validateChatStep,
  validateProviderStep,
} from './onboarding-steps'
import { CHAT_GATE_UNTESTED } from './chat-gate'
import { ONBOARDING_DRAFT_VERSION } from './onboarding-storage'
import type { ChatGateState } from './chat-gate'
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
    branch: 'main',
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
    branch: 'main',
    mode: 'first-run',
    dirty: false,
    draft: draft(),
    saved: false,
    providerVerified: false,
    hasStoredKey: false,
    catalogBaseUrl: null,
    chat: CHAT_GATE_UNTESTED,
    canWrite: true,
    hasActiveProvider: false,
    ...overrides,
  }
}

const PASSED: ChatGateState = { kind: 'passed', reply: 'Hello.' }
const SKIPPED: ChatGateState = { kind: 'skipped', at: 1 }
const FAILED: ChatGateState = {
  kind: 'failed',
  error: '401 Unauthorized',
  credentialLikely: true,
}

const REQUIRED = ['connect', 'provider', 'workspace', 'chat']
const OPTIONAL = ['extras', 'profile', 'memory', 'plugins', 'theme']

describe('ONBOARDING_STEPS rail', () => {
  it('is exactly the four required steps until the chat gate is settled', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx()).map((step) => step.id)
    expect(ids).toEqual(REQUIRED)
  })

  it('is the canonical order from the docs: connect → provider → workspace → chat', () => {
    // install → choose provider → first successful chat → verify resume, then
    // everything else. The order is the contract, not a layout preference.
    const ids = railSteps(ONBOARDING_STEPS, ctx()).map((step) => step.id)
    expect(ids.indexOf('connect')).toBeLessThan(ids.indexOf('provider'))
    expect(ids.indexOf('provider')).toBeLessThan(ids.indexOf('workspace'))
    expect(ids.indexOf('workspace')).toBeLessThan(ids.indexOf('chat'))
  })

  it('unlocks the optional steps once a real completion has succeeded', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ chat: PASSED })).map(
      (step) => step.id,
    )
    expect(ids).toEqual([...REQUIRED, ...OPTIONAL])
  })

  it('unlocks the optional steps when the user skips with the warning', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ chat: SKIPPED })).map(
      (step) => step.id,
    )
    expect(ids).toEqual([...REQUIRED, ...OPTIONAL])
  })

  it('keeps the optional steps locked while the chat is merely failing', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ chat: FAILED })).map(
      (step) => step.id,
    )
    expect(ids).toEqual(REQUIRED)
  })

  it('offers no optional step before the gate — the rule the docs state outright', () => {
    for (const id of OPTIONAL) {
      const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id)
      expect(step?.enabled?.(ctx()), id).toBe(false)
    }
  })

  it('unlocks the optional steps on a relaunch without re-proving a completion', () => {
    // The relaunched wizard is a settings surface reached from inside a running
    // workspace. Making a returning user prove a completion before they may
    // toggle a plugin is the regression the "usable settings surface" change
    // fixed, so `mode: 'relaunch'` is a deliberate second door.
    expect(extrasUnlocked(ctx({ mode: 'relaunch' }))).toBe(true)
    const ids = railSteps(ONBOARDING_STEPS, ctx({ mode: 'relaunch' })).map(
      (step) => step.id,
    )
    expect(ids).toEqual([...REQUIRED, ...OPTIONAL])
  })

  it('hops the locked optional steps in both directions', () => {
    const locked = ctx()
    expect(nextStepId(ONBOARDING_STEPS, locked, 'chat')).toBe('finish')
    expect(prevStepId(ONBOARDING_STEPS, locked, 'finish')).toBe('chat')

    const open = ctx({ chat: PASSED })
    expect(nextStepId(ONBOARDING_STEPS, open, 'chat')).toBe('extras')
  })

  it('skips the welcome screen on a relaunch', () => {
    const welcome = ONBOARDING_STEPS.find((step) => step.id === 'welcome')
    expect(welcome?.enabled?.(ctx({ mode: 'first-run' }))).toBe(true)
    expect(welcome?.enabled?.(ctx({ mode: 'relaunch' }))).toBe(false)
  })

  it('SUMMARY rail is empty', () => {
    const ids = railSteps(ONBOARDING_STEPS, ctx({ branch: 'summary' })).map(
      (step) => step.id,
    )
    expect(ids).toEqual([])
  })

  it('makes the chat step non-optional, so the footer offers no unlabelled Skip', () => {
    // The escape hatch lives on the step body behind a warning that names what
    // breaks. A footer Skip button would be a bypass with no explanation.
    const chat = ONBOARDING_STEPS.find((step) => step.id === 'chat')
    expect(chat?.optional).not.toBe(true)
    expect(chat?.validate).toBeDefined()
  })

  it('makes connect and workspace skippable, and provider not', () => {
    const optionality = Object.fromEntries(
      ONBOARDING_STEPS.map((step) => [step.id, step.optional === true]),
    )
    expect(optionality.connect).toBe(true)
    expect(optionality.workspace).toBe(true)
    expect(optionality.provider).toBe(false)
  })

  it('welcome, finish, and summary are chromeless', () => {
    for (const id of ['welcome', 'finish', 'summary'] as const) {
      const step = ONBOARDING_STEPS.find((candidate) => candidate.id === id)
      expect(step?.chromeless).toBe(true)
    }
  })

  it("the finish step's title matches FinishStep's own visible heading", () => {
    const finish = ONBOARDING_STEPS.find((step) => step.id === 'finish')
    expect(finish?.title).toBe('Setup complete')
  })

  it('has no duplicate ids', () => {
    const ids = ONBOARDING_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('retired step ids', () => {
  it('keeps every retired id resolvable, so saved deep links do not dead-end', () => {
    // `setup-wizard-store.ts` derives its deep-link allowlist from this table.
    // An id dropped outright would normalise to `null` and dump the user on the
    // front door instead of the step they asked for.
    const ids = ONBOARDING_STEPS.map((step) => step.id)
    for (const retired of Object.keys(RETIRED_STEP_ALIASES)) {
      expect(ids, retired).toContain(retired)
    }
  })

  it('never enables a retired id on any ctx', () => {
    for (const retired of Object.keys(RETIRED_STEP_ALIASES)) {
      const step = ONBOARDING_STEPS.find(
        (candidate) => candidate.id === retired,
      )
      for (const state of [CHAT_GATE_UNTESTED, PASSED, SKIPPED]) {
        expect(step?.enabled?.(ctx({ chat: state })), retired).toBe(false)
      }
      expect(step?.enabled?.(ctx({ mode: 'relaunch' })), retired).toBe(false)
    }
  })

  it('maps each retired id onto the step that took over its job', () => {
    expect(resolveStepAlias('system-check')).toBe('connect')
    expect(resolveStepAlias('review')).toBe('provider')
    expect(resolveStepAlias('verify')).toBe('provider')
    expect(resolveStepAlias('memory')).toBe('memory')
  })
})

describe('validateProviderStep', () => {
  it('requires a provider on a fresh install', () => {
    expect(validateProviderStep(ctx())).toEqual([
      'Choose a provider to continue',
    ])
  })

  it('lets a configured install pass through untouched', () => {
    // The relaunch case: nothing has been picked because nothing needed
    // picking, and demanding a choice would trap a user who only came to look.
    expect(
      validateProviderStep(ctx({ hasActiveProvider: true, dirty: false })),
    ).toEqual([])
  })

  it('requires a base URL for an api-key provider with no catalog default', () => {
    const errors = validateProviderStep(
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

  it('does not require a base URL once a catalog default exists', () => {
    expect(
      validateProviderStep(
        ctx({
          draft: draft({ providerId: 'anthropic', baseUrl: '' }),
          catalogBaseUrl: 'https://api.anthropic.com/v1',
          hasStoredKey: true,
          saved: true,
        }),
      ),
    ).toEqual([])
  })

  it('does not require a base URL for an oauth-only provider', () => {
    expect(
      validateProviderStep(
        ctx({
          draft: draft({ providerId: 'nous', baseUrl: '' }),
          catalogBaseUrl: null,
          hasStoredKey: true,
          saved: true,
        }),
      ),
    ).toEqual([])
  })

  it('requires an API key for api-key providers when none is stored or typed', () => {
    const errors = validateProviderStep(
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

  it('asks for the save once the draft has been edited', () => {
    expect(
      validateProviderStep(
        ctx({
          draft: draft({ providerId: 'anthropic' }),
          catalogBaseUrl: 'https://api.anthropic.com/v1',
          hasStoredKey: true,
          dirty: true,
          saved: false,
        }),
      ),
    ).toEqual(['Press “Save and verify” to write this provider and test it.'])
  })

  it('does not block when the run is not permitted to write', () => {
    // A locked relaunch disables Save and `save()` refuses, so `saved` can
    // never become true. Requiring it would make the step a dead end: Next
    // blocked forever, no Skip offered, only Back or Close.
    expect(
      validateProviderStep(
        ctx({
          draft: draft({ providerId: 'anthropic' }),
          catalogBaseUrl: 'https://api.anthropic.com/v1',
          hasStoredKey: true,
          dirty: true,
          saved: false,
          canWrite: false,
        }),
      ),
    ).toEqual([])
  })
})

describe('validateChatStep', () => {
  it('blocks until a completion has succeeded', () => {
    expect(validateChatStep(ctx())).toEqual([
      'Send one real message first — everything after this step depends on a completion succeeding.',
    ])
  })

  it('passes once a completion has succeeded', () => {
    expect(validateChatStep(ctx({ chat: PASSED }))).toEqual([])
  })

  it('passes once the user has accepted the skip warning', () => {
    expect(validateChatStep(ctx({ chat: SKIPPED }))).toEqual([])
  })

  it("quotes the gateway's own error while it is failing", () => {
    expect(validateChatStep(ctx({ chat: FAILED }))[0]).toContain(
      '401 Unauthorized',
    )
  })
})
