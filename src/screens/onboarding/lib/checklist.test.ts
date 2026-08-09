import { describe, expect, it } from 'vitest'

import { buildChecklist, outstandingCount } from './checklist'
import { ONBOARDING_DRAFT_VERSION } from './onboarding-storage'
import type { OnboardingDraft, OnboardingOutcome } from './onboarding-storage'

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    branch: 'full',
    stepId: 'plugins',
    providerId: 'anthropic',
    baseUrl: '',
    envKey: '',
    defaultModel: '',
    makeActive: true,
    themeId: null,
    skipped: [],
    completed: [],
    savedAt: 0,
    ...overrides,
  }
}

const FRESH: OnboardingOutcome = { kind: 'fresh' }

describe('buildChecklist', () => {
  it('provider is done when there is an active provider', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: 'anthropic',
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'provider')?.state).toBe('done')
  })

  it('provider is todo, never skipped, even if listed in draft.skipped', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['provider'] }),
      activeProvider: null,
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'provider')?.state).toBe('todo')
  })

  it('verify is blocked when there is no active provider yet', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: null,
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'verify')?.state).toBe('blocked')
  })

  it('verify is skipped when listed in draft.skipped and a provider exists', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['verify'] }),
      activeProvider: 'anthropic',
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'verify')?.state).toBe('skipped')
  })

  it('verify is done when verified is true, regardless of skipped', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['verify'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'verify')?.state).toBe('done')
  })

  it('plugins is done only when pluginsTouched is true — a 200 from enable is not enough on its own', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'plugins')?.state).toBe('todo')
  })

  it('profile is done only when profileTouched is true — a 200 from activate is not enough', () => {
    // Activation writes the `~/.hermes/active_profile` pointer and nothing
    // else; the gateway does not re-read it until it restarts, so this item
    // is treated exactly like the plugins one.
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'profile')?.state).toBe('todo')
    expect(items.find((i) => i.id === 'profile')?.goTo).toBe('profile')
  })

  it('profile is skipped when the step was skipped, and done once touched', () => {
    const skipped = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['profile'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(skipped.find((i) => i.id === 'profile')?.state).toBe('skipped')

    const touched = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['profile'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: true,
      memoryTouched: false,
    })
    expect(touched.find((i) => i.id === 'profile')?.state).toBe('done')
  })

  it('memory is done only when memoryTouched is true — a 200 from the PATCH is not enough', () => {
    // The write only rewrites `~/.hermes/config.yaml`; `agent_init.py` reads
    // `memory.provider` once, at gateway startup, so this item is treated
    // exactly like the profile and plugins ones.
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: true,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'memory')?.state).toBe('todo')
    expect(items.find((i) => i.id === 'memory')?.goTo).toBe('memory')
  })

  it('memory is skipped when the step was skipped, and done once touched', () => {
    const skipped = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['memory'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: true,
      memoryTouched: false,
    })
    expect(skipped.find((i) => i.id === 'memory')?.state).toBe('skipped')

    const touched = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['memory'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: true,
      memoryTouched: true,
    })
    expect(touched.find((i) => i.id === 'memory')?.state).toBe('done')
  })

  it('falls back to the outcome skipped list once the draft is gone', () => {
    const complete: OnboardingOutcome = {
      kind: 'complete',
      at: 1,
      branch: 'full',
      skipped: ['theme'],
      completed: [],
    }
    const items = buildChecklist({
      outcome: complete,
      draft: null,
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.find((i) => i.id === 'theme')?.state).toBe('skipped')
  })

  it('with no draft and a non-complete outcome, nothing is skipped', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: null,
      activeProvider: null,
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.every((i) => i.state !== 'skipped')).toBe(true)
  })

  it('derives verify/profile/memory/plugins from the completion record once the draft is gone', () => {
    // The exact state a finished full run leaves behind: the draft is deleted
    // by `handleFinish`, so `completed` on the outcome is the only evidence
    // that verify, profile, memory and plugins were done. Without it every
    // out-of-wizard consumer reports them outstanding forever.
    const complete: OnboardingOutcome = {
      kind: 'complete',
      at: 1,
      branch: 'full',
      skipped: [],
      completed: [
        'verify',
        'profile',
        'memory',
        'plugins',
        'theme',
        'system-check',
      ],
    }
    const items = buildChecklist({
      outcome: complete,
      draft: null,
      activeProvider: 'anthropic',
      // All four false, exactly as `use-onboarding-checklist` passes them
      // outside a live wizard session.
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(items.map((item) => item.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
    ])
    expect(outstandingCount(items)).toBe(0)
  })

  it('a completion record with no `completed` field leaves items outstanding', () => {
    // Tolerant read: a record written before `completed` existed is still a
    // valid completion, it simply cannot prove any step was done.
    const items = buildChecklist({
      outcome: {
        kind: 'complete',
        at: 1,
        branch: 'quick',
        skipped: [],
        completed: [],
      },
      draft: null,
      activeProvider: 'anthropic',
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    expect(outstandingCount(items)).toBe(6)
  })

  it('goTo matches each item id 1:1 with a step id', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: null,
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    for (const item of items) {
      expect(item.goTo).toBe(item.id)
    }
  })
})

describe('outstandingCount', () => {
  it('counts todo and skipped, not done or blocked', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft({ skipped: ['theme'] }),
      activeProvider: null,
      verified: false,
      pluginsTouched: false,
      profileTouched: false,
      memoryTouched: false,
    })
    // provider: todo, verify: blocked (no provider), profile: todo,
    // memory: todo, plugins: todo, theme: skipped, system-check: todo
    // → 5 todo + 1 skipped = 6
    expect(outstandingCount(items)).toBe(6)
  })

  it('is zero once everything is done', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft({ completed: ['theme', 'system-check'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
      profileTouched: true,
      memoryTouched: true,
    })
    expect(outstandingCount(items)).toBe(0)
  })
})
