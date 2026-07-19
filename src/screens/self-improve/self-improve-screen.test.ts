import { describe, expect, it } from 'vitest'
import { formatCost, selectAvailableProfile } from './self-improve-screen'

describe('self-improve screen helpers', () => {
  it('selects a profile after profiles load', () => {
    expect(selectAvailableProfile('', 'default', ['default', 'reviewer'])).toBe(
      'default',
    )
    expect(
      selectAvailableProfile('reviewer', 'default', ['default', 'reviewer']),
    ).toBe('reviewer')
  })

  it('formats negative cost deltas as currency', () => {
    expect(formatCost(-0.25)).toBe('-$0.25')
  })
})
