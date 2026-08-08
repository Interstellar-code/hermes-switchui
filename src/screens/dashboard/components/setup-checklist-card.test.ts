import { describe, expect, it } from 'vitest'
import { shouldShowSetupChecklistCard } from './setup-checklist-card'

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
