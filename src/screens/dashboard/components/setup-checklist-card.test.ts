import { describe, expect, it } from 'vitest'
import {
  describeRequiredSteps,
  shouldShowSetupChecklistCard,
} from './setup-checklist-card'
import type { ChecklistItem } from '@/screens/onboarding/lib/checklist'

function item(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: 'connect',
    label: 'Reach the gateway',
    detail: '',
    state: 'todo',
    goTo: 'connect',
    required: true,
    ...overrides,
  }
}

describe('shouldShowSetupChecklistCard', () => {
  it('renders once ready, with outstanding items, and not dismissed', () => {
    expect(
      shouldShowSetupChecklistCard({
        ready: true,
        outstanding: 2,
        dismissed: false,
      }),
    ).toBe(true)
  })

  it('stays hidden before the client-only read settles', () => {
    expect(
      shouldShowSetupChecklistCard({
        ready: false,
        outstanding: 2,
        dismissed: false,
      }),
    ).toBe(false)
  })

  it('stays hidden once everything is done', () => {
    expect(
      shouldShowSetupChecklistCard({
        ready: true,
        outstanding: 0,
        dismissed: false,
      }),
    ).toBe(false)
  })

  it('stays hidden once the user dismissed it, even with outstanding items', () => {
    expect(
      shouldShowSetupChecklistCard({
        ready: true,
        outstanding: 3,
        dismissed: true,
      }),
    ).toBe(false)
  })
})

describe('describeRequiredSteps', () => {
  it('counts a blocked required item, unlike the all-items outstanding count', () => {
    // connect + workspace already recorded done; provider was never set up,
    // so `chat` is `blocked` (not `todo`) rather than counted directly. The
    // old `outstandingCount`-based headline read this as "1 step left" —
    // just `provider` — masking that `chat` is also required and unfinished.
    const items: Array<ChecklistItem> = [
      item({ id: 'connect', state: 'done', required: true }),
      item({ id: 'provider', state: 'todo', required: true, goTo: 'provider' }),
      item({ id: 'workspace', state: 'done', required: true, goTo: 'workspace' }),
      item({ id: 'chat', state: 'blocked', required: true, goTo: 'chat' }),
      item({ id: 'profile', state: 'blocked', required: false, goTo: 'profile' }),
    ]

    expect(describeRequiredSteps(items)).toBe('2 of 4 required steps left.')
  })

  it('reads as fully done once every required item resolves', () => {
    const items: Array<ChecklistItem> = [
      item({ id: 'connect', state: 'done', required: true }),
      item({ id: 'provider', state: 'done', required: true, goTo: 'provider' }),
      item({ id: 'workspace', state: 'done', required: true, goTo: 'workspace' }),
      item({ id: 'chat', state: 'done', required: true, goTo: 'chat' }),
    ]

    expect(describeRequiredSteps(items)).toBe('0 of 4 required steps left.')
  })
})
