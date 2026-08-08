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
    })
    expect(items.find((i) => i.id === 'plugins')?.state).toBe('todo')
  })

  it('falls back to the outcome skipped list once the draft is gone', () => {
    const complete: OnboardingOutcome = {
      kind: 'complete',
      at: 1,
      branch: 'full',
      skipped: ['theme'],
    }
    const items = buildChecklist({
      outcome: complete,
      draft: null,
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
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
    })
    expect(items.every((i) => i.state !== 'skipped')).toBe(true)
  })

  it('goTo matches each item id 1:1 with a step id', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft(),
      activeProvider: null,
      verified: false,
      pluginsTouched: false,
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
    })
    // provider: todo, verify: blocked (no provider), plugins: todo,
    // theme: skipped, system-check: todo → 3 todo + 1 skipped = 4
    expect(outstandingCount(items)).toBe(4)
  })

  it('is zero once everything is done', () => {
    const items = buildChecklist({
      outcome: FRESH,
      draft: draft({ completed: ['theme', 'system-check'] }),
      activeProvider: 'anthropic',
      verified: true,
      pluginsTouched: true,
    })
    expect(outstandingCount(items)).toBe(0)
  })
})
