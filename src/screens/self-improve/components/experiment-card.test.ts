import { describe, expect, it } from 'vitest'
import {
  applyErrorMessage,
  effectBadgeLabel,
  latestRunForKind,
  resultsForRun,
} from './experiment-card'
import { parseScenarioSnapshot } from './scenario-checklist'
import type { ExperimentHistoryResponse } from '@/lib/self-improve-types'

describe('effectBadgeLabel', () => {
  it('labels 1 and null as next session, 0 as live now', () => {
    expect(effectBadgeLabel(1)).toBe('Takes effect on next session')
    expect(effectBadgeLabel(null)).toBe('Takes effect on next session')
    expect(effectBadgeLabel(0)).toBe('Live now')
  })
})

describe('applyErrorMessage', () => {
  it('returns the patch-conflict copy for a 422 error', () => {
    const err = Object.assign(new Error('ignored'), { status: 422 })
    expect(applyErrorMessage(err)).toBe('Patch failed — experiment not applied')
  })

  it('falls back to the error message for a non-422 error', () => {
    const err = Object.assign(new Error('boom'), { status: 500 })
    expect(applyErrorMessage(err)).toBe('boom')
  })

  it('falls back to a generic message for non-Error values', () => {
    expect(applyErrorMessage('nope')).toBe('Apply failed')
  })
})

describe('evaluation run mapping', () => {
  const history = {
    eval_runs: [
      {
        id: 1,
        kind: 'offline',
        aggregate_score: 0.5,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        kind: 'offline',
        aggregate_score: 0.75,
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 3,
        kind: 'live',
        aggregate_score: 0.8,
        created_at: '2026-01-03T00:00:00Z',
      },
    ],
    scenario_results: [
      { id: 10, eval_run_id: 1 },
      { id: 20, eval_run_id: 2 },
      { id: 30, eval_run_id: 3 },
    ],
  } as ExperimentHistoryResponse

  it('uses the newest run per kind and only its scenario results', () => {
    expect(latestRunForKind(history, 'offline')?.id).toBe(2)
    expect(resultsForRun(history, 2).map((result) => result.id)).toEqual([20])
    expect(resultsForRun(history, 3).map((result) => result.id)).toEqual([30])
  })
})

describe('scenario snapshot mapping', () => {
  it('uses saved input where the evaluator supplied it', () => {
    expect(
      parseScenarioSnapshot(
        '{"name":"Memory priority","input":"Use memory first"}',
      ),
    ).toEqual({ name: 'Memory priority', input: 'Use memory first' })
  })
})
