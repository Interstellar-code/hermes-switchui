import { describe, expect, it } from 'vitest'
import {
  NEXT_STEP_TAB,
  formatCost,
  formatWindowRange,
  outcomeLabel,
  parseScenarioChecks,
  passSummary,
  safeRate,
  selectAvailableProfile,
} from './self-improve-screen'

describe('self-improve screen helpers', () => {
  it('sends tab-backed next steps to a visible tab', () => {
    expect(NEXT_STEP_TAB.observe).toBe('run')
    expect(NEXT_STEP_TAB['add-training']).toBe('evaluation')
  })

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

  it('uses plain-language outcomes and keeps absent evaluation distinct from a failed run', () => {
    expect(outcomeLabel('proposed')).toBe('Awaiting review')
    expect(outcomeLabel('live')).toBe('Checking in real use')
    expect(outcomeLabel('verified')).toBe('Proven better')
    expect(outcomeLabel('reverted')).toBe('Not kept')
    expect(passSummary([])).toBe('Not run yet')
    expect(passSummary([{ pass_fail: 0 }, { pass_fail: 1 }])).toBe('1/2 passed')
  })
})
