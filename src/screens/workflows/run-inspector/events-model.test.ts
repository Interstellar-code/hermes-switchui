import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHIPS,
  chipOf,
  eventSummary,
  filterEvents,
  finalReport,
  latestOutput,
  mergeEvents,
  skipReasonsFrom,
  yamlBlockRange,
} from './events-model'
import type { NodeRunRow, WorkflowEventRow } from '../api-client'
import type { ParsedWorkflow } from '../types'

// The API returns ISO `created_at` and object `data`; the declared row type is narrower.
const row = (o: Record<string, unknown>): WorkflowEventRow =>
  ({
    id: 'e1',
    workflow_run_id: 'r',
    event_type: 'node_started',
    data: null,
    created_at: '2026-10-05T10:00:00.000Z',
    ...o,
  }) as unknown as WorkflowEventRow
// Live SSE frame = bus wrapper (engine/emitter/bus.py `_row_payload`).
const live = (
  type: string,
  env: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
  at = 5,
) => ({
  type,
  data: { run_id: 'r', event_type: type, node_run_id: null, ...env, data },
  receivedAt: at,
})

describe('mergeEvents', () => {
  it('parses string data, resolves node via node_run_id, drops hidden types', () => {
    const items = mergeEvents(
      [
        row({
          id: 'a',
          node_run_id: 'n1',
          data: '{"output":"hi","duration_ms":4}',
          event_type: 'node_completed',
        }),
        row({ id: 'b', event_type: 'node_log' }),
      ],
      [live('connected')],
      [{ id: 'n1', dag_node_id: 'apply' } as NodeRunRow],
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0].nodeId).toBe('apply')
    expect(items[0].summary).toBe('hi · 4ms')
  })
  it('dedupes by seq, then id; skips replayed live; reads node from env.data', () => {
    const T = Date.parse('2026-10-05T10:00:00.000Z')
    const items = mergeEvents(
      [
        row({ id: 'a', seq: 1 }),
        row({
          id: 'b',
          seq: 2,
          event_type: 'node_failed',
          node_run_id: 'nr',
          data: { error: 'x', node_id: 'n' },
        }),
      ],
      [
        live('node_started', { seq: 1, id: 'other' }),
        live('node_started', { id: 'a' }),
        live('node_started', { _replayed: true, id: 'z' }, { node_id: 'z' }),
        live(
          'node_paused',
          { id: 'p', seq: 9 },
          { node_id: 'live-only' },
          T + 9000,
        ),
      ],
      [],
      [],
    )
    expect(items.map((i) => i.type)).toEqual([
      'node_started',
      'node_failed',
      'node_paused',
    ])
    expect(items[2]).toMatchObject({ nodeId: 'live-only', key: 'live:s:9' })
  })
  it('id-less live (0.1.0) dedupes vs DB on (type, node_run_id ?? node_id) within 2s', () => {
    const T = Date.parse('2026-10-05T10:00:00.000Z')
    const items = mergeEvents(
      [
        row({
          id: 'b',
          event_type: 'node_failed',
          node_run_id: 'nr',
          data: { error: 'x', node_id: 'n' },
        }),
      ],
      [
        live('node_failed', { node_run_id: 'nr' }, { error: 'x' }, T + 1500),
        live('node_failed', { node_run_id: 'nr' }, { error: 'y' }, T + 2500),
        live('node_completed', {}, { node_id: 'n', output: 'ok' }, T + 100),
      ],
      [],
      [],
    )
    expect(items.map((i) => `${i.type}:${i.summary}`)).toEqual([
      'node_failed:x',
      'node_completed:ok',
      'node_failed:y',
    ])
  })
  it('merges phase transitions as workflow_phase rows in time order', () => {
    const items = mergeEvents(
      [row({ id: 'a', created_at: '2026-10-05T10:00:05.000Z' })],
      [],
      [],
      [
        {
          id: 't',
          from_phase: 'plan',
          to_phase: 'running',
          decided_by: 'engine',
          decision_data: null,
          at: Date.parse('2026-10-05T10:00:01.000Z'),
        },
      ],
    )
    expect(items.map((i) => i.type)).toEqual(['workflow_phase', 'node_started'])
    expect(items[0].summary).toBe('plan → running (decided_by engine)')
  })
})

describe('filters', () => {
  const items = mergeEvents(
    [
      row({ id: '1', event_type: 'node_started', data: { node_id: 'a' } }),
      row({
        id: '2',
        event_type: 'node_skipped',
        data: { node_id: 'b', reason: 'when' },
      }),
      row({
        id: '3',
        event_type: 'approval_received',
        data: { node_id: 'a', decision: 'approve' },
      }),
      row({ id: '4', event_type: 'workflow_failed', data: { error: 'boom' } }),
      row({ id: '5', event_type: 'tool_called', data: {} }),
    ],
    [],
    [],
    [],
  )
  it('chips: skipped hidden by default, approval/workflow_* grouped, rest = other', () => {
    expect(chipOf('approval_requested')).toBe('approval')
    expect(chipOf('workflow_phase')).toBe('workflow_*')
    expect(chipOf('tool_called')).toBe('other')
    const f = filterEvents(items, {
      node: null,
      chips: DEFAULT_CHIPS,
      search: '',
    })
    expect(f.map((e) => e.type)).not.toContain('node_skipped')
    expect(f).toHaveLength(4)
  })
  it('node + search', () => {
    expect(
      filterEvents(items, { node: 'a', chips: DEFAULT_CHIPS, search: '' }),
    ).toHaveLength(2)
    expect(
      filterEvents(items, { node: null, chips: DEFAULT_CHIPS, search: 'BOOM' }),
    ).toHaveLength(1)
  })
  it('skipReasonsFrom keeps only run-less skips', () => {
    expect(skipReasonsFrom(items).get('b')).toBe('when')
  })
  it('summaries', () => {
    expect(
      eventSummary('workflow_started', {
        trigger: { kind: 'manual' },
        inputs: { a: 1 },
      }),
    ).toBe('manual trigger · 1 input')
    expect(
      eventSummary('approval_received', { decision: 'approve', comment: 'go' }),
    ).toBe('response: approve · note "go"')
  })
})

const parsed = {
  nodes: [
    { id: 'a', type: 'bash' },
    { id: 'rep', type: 'prompt' },
    { id: 'amend', type: 'prompt' },
    { id: 'stop', type: 'cancel' },
  ],
  edges: [
    ['a', 'rep'],
    ['a', 'amend'],
    ['a', 'stop'],
  ],
} as unknown as ParsedWorkflow
const nr = (o: Partial<NodeRunRow>) =>
  ({
    node_type: 'bash',
    summary: null,
    status: 'completed',
    completed_at: 1,
    ...o,
  }) as NodeRunRow

describe('finalReport / latestOutput', () => {
  it('returns completed sinks; explains missing ones; ignores cancel sinks', () => {
    const r = finalReport(
      parsed,
      [
        nr({ dag_node_id: 'a', status: 'failed' }),
        nr({ dag_node_id: 'amend', summary: 'done!' }),
      ],
      'err',
    )
    expect(r.sinks).toEqual([{ id: 'amend', text: 'done!' }])
    expect(r.missing).toEqual([
      { id: 'rep', reason: 'not reached because a failed' },
    ])
  })
  it('latestOutput picks the newest completed with output', () => {
    expect(
      latestOutput([
        nr({ dag_node_id: 'x', summary: 'old', completed_at: 1 }),
        nr({ dag_node_id: 'y', summary: 'new', completed_at: 9 }),
        nr({ dag_node_id: 'z', summary: '', completed_at: 99 }),
      ]),
    ).toEqual({ nodeId: 'y', text: 'new' })
  })
})

describe('yamlBlockRange', () => {
  const yaml = [
    'name: wf',
    'nodes:',
    '  - id: one',
    '    type: bash',
    '    run: |',
    '      echo hi',
    '',
    '  - id: two',
    '    type: bash',
    'other: 1',
  ].join('\n')
  it('spans the list item including blank-line-trailing scripts', () => {
    expect(yamlBlockRange(yaml, 'one')).toEqual({ start: 3, end: 6 })
    expect(yamlBlockRange(yaml, 'two')).toEqual({ start: 8, end: 9 })
  })
  it('handles id not being the first key; null when absent', () => {
    const y = [
      'nodes:',
      '  - type: bash',
      '    id: late',
      '    run: x',
      '  - id: n2',
    ].join('\n')
    expect(yamlBlockRange(y, 'late')).toEqual({ start: 2, end: 4 })
    expect(yamlBlockRange(y, 'nope')).toBeNull()
  })
})
