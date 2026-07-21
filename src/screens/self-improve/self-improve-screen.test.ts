import { describe, expect, it } from 'vitest'
import {
  formatCost,
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
})
