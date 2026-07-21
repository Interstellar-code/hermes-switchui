import { describe, expect, it } from 'vitest'
import {
  formatCost,
  formatWindowRange,
  parseScenarioChecks,
  safeRate,
  selectAvailableProfile,
} from './self-improve-screen'

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

  it('does not present raw counts as a rate with no sessions', () => {
    expect(safeRate(265, 0)).toBe('—')
    expect(safeRate(1, 4)).toBe('25.0%')
  })

  it('parses structured and legacy scenario checks for display', () => {
    expect(
      parseScenarioChecks('[{"type":"must_contain","value":"hello"}]'),
    ).toEqual([{ type: 'must_contain', value: 'hello' }])
    expect(parseScenarioChecks('["legacy check"]')).toEqual(['legacy check'])
    expect(parseScenarioChecks('legacy raw check')).toEqual([
      'legacy raw check',
    ])
    expect(
      parseScenarioChecks(
        '[{"type":"unknown","value":"bad"},{"type":"judge","rubric":"Useful"}]',
      ),
    ).toEqual([{ type: 'judge', rubric: 'Useful' }])
  })

  it('formats a window range, or returns null when either end is missing', () => {
    expect(formatWindowRange(null, null)).toBeNull()
    expect(formatWindowRange('2026-07-14T00:00:00Z', null)).toBeNull()
    expect(formatWindowRange(null, '2026-07-21T00:00:00Z')).toBeNull()
    expect(
      formatWindowRange('2026-07-14T00:00:00Z', '2026-07-21T00:00:00Z'),
    ).toContain('→')
  })
})
