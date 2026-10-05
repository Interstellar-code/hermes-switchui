import { describe, expect, it } from 'vitest'
import {
  attemptShort,
  attemptText,
  nodeTableRows,
  phaseSegments,
  runtimeLimitText,
  summaryCounts,
  triggerText,
  usageCoverage,
} from './inspector-model'
import type { NodeRunRow, PhaseTransition, WorkflowRunRow } from '../api-client'
import type { ParsedWorkflow } from '../types'

const nr = (o: Partial<NodeRunRow>): NodeRunRow => ({
  id: o.dag_node_id ?? 'x',
  workflow_run_id: 'r',
  dag_node_id: 'x',
  node_type: 'bash',
  status: 'completed',
  kanban_task_id: null,
  started_at: 1000,
  completed_at: 1005,
  summary: null,
  error: null,
  ...o,
})

const parsed = {
  nodes: [
    { id: 'a', type: 'bash', phase: 'execute' },
    {
      id: 'b',
      type: 'prompt',
      phase: 'execute',
      hermes_task: { model_hint: 'haiku' },
    },
    { id: 'c', type: 'bash', phase: 'review' },
    { id: 'd', type: 'cancel', phase: 'execute' },
  ],
  edges: [],
} as unknown as ParsedWorkflow

describe('attemptText', () => {
  it('gates on the feature, not on null fields', () => {
    const n = nr({ retries: 2, max_retries: 2 })
    expect(attemptText(n, [])).toBe('attempt 1 · retries not recorded')
    expect(attemptShort(n, [])).toBe('1')
  })
  it('formats attempts when node_attempts is present', () => {
    expect(
      attemptText(nr({ retries: 1, max_retries: 2 }), ['node_attempts']),
    ).toBe('attempt 2 of 3')
    expect(attemptText(nr({}), ['node_attempts'])).toBe('attempt 1')
    expect(
      attemptShort(nr({ retries: 0, max_retries: 0 }), ['node_attempts']),
    ).toBe('1 of 1')
  })
})

describe('nodeTableRows', () => {
  it('overlays runs, flags skipped / not reached, falls back to model_hint', () => {
    const rows = nodeTableRows(
      parsed,
      [
        nr({ dag_node_id: 'a' }),
        nr({
          dag_node_id: 'b',
          node_type: 'prompt',
          status: 'failed',
          total_tokens: 10,
        }),
      ],
      new Map([['d', 'when_condition']]),
    )
    expect(rows.map((r) => r.status)).toEqual([
      'done',
      'failed',
      'not reached',
      'skipped',
    ])
    expect(rows[1].model).toBe('haiku')
    expect(rows[3].skipReason).toBe('when_condition')
    expect(rows[0].tookMs).toBe(5000)
    expect(summaryCounts(rows)).toMatchObject({
      done: 1,
      failed: 1,
      skipped: 1,
      notReached: 1,
    })
  })
  it('hides loop iterations and subgraph children, keeps unknown runs', () => {
    const rows = nodeTableRows(parsed, [
      nr({ id: 'l1', dag_node_id: 'a', loop_iteration: 1 }),
      nr({ id: 'c1', dag_node_id: 'zz', parent_subgraph_node_run_id: 'p' }),
      nr({ id: 'q', dag_node_id: 'extra' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'extra'])
    expect(rows[0].nodeRun).toBeNull()
  })
  it('labels completed approvals approved', () => {
    expect(
      nodeTableRows(null, [nr({ dag_node_id: 'g', node_type: 'approval' })])[0]
        .status,
    ).toBe('approved')
  })
})

describe('phaseSegments', () => {
  const t = (
    to: string,
    at: number,
    from: string | null = null,
  ): PhaseTransition => ({
    id: to + at,
    from_phase: from,
    to_phase: to,
    decided_by: 'system',
    decision_data: null,
    at,
  })
  it('closes a segment at the next transition and tones failure', () => {
    const s = phaseSegments(
      [
        t('plan', 1_000_000_000_000),
        t('running', 1_000_000_009_000),
        t('failed', 1_000_000_091_000),
      ],
      'failed',
    )
    expect(s.map((x) => [x.phase, x.durationMs, x.tone])).toEqual([
      ['plan', 9000, 'ok'],
      ['running', 82000, 'err'],
    ])
  })
  it('keeps the open phase live', () => {
    expect(
      phaseSegments([t('running', 1_000_000_000_000)], 'running')[0].tone,
    ).toBe('live')
  })
})

describe('misc', () => {
  it('usageCoverage counts top-level nodes with tokens', () => {
    expect(
      usageCoverage([
        nr({ dag_node_id: 'a' }),
        nr({ dag_node_id: 'b', total_tokens: 5 }),
      ]),
    ).toEqual({
      reporting: ['b'],
      total: 2,
    })
  })
  it('runtimeLimitText / triggerText', () => {
    expect(runtimeLimitText(3600)).toBe('1h · 3600s')
    expect(runtimeLimitText(null)).toBe('none')
    expect(
      triggerText({
        metadata: { trigger: { kind: 'manual' } },
      } as unknown as WorkflowRunRow),
    ).toBe('manual')
    expect(triggerText({} as WorkflowRunRow)).toBe('not recorded')
  })
})
