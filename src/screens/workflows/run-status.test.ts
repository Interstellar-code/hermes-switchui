import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchRunIndexRuns,
  indexRunsByWorkflow,
  phaseLabel,
  runAgainInput,
  runIndexInterval,
} from './run-status'
import type { WorkflowRunRow } from './api-client'
import type { Mission } from '@/server/conductor-store'

const run = (over: Partial<WorkflowRunRow>): WorkflowRunRow => ({
  id: 'r',
  workflow_id: 'wf',
  conversation_id: 'c',
  status: 'completed',
  current_phase: 'running',
  user_message: 'go',
  working_path: '/tmp',
  started_at: '2026-09-27T16:00:00+00:00',
  completed_at: '2026-09-27T16:00:10+00:00',
  error: null,
  ...over,
})

describe('indexRunsByWorkflow', () => {
  it('summarises per workflow: active, waiting, last, recent, median, sparkline', () => {
    const runs = [
      run({
        id: 'a1',
        started_at: '2026-09-27T16:00:00+00:00',
        completed_at: '2026-09-27T16:00:02+00:00',
      }),
      run({
        id: 'a2',
        started_at: '2026-09-27T17:00:00+00:00',
        completed_at: '2026-09-27T17:00:04+00:00',
      }),
      run({
        id: 'a3',
        status: 'running',
        started_at: '2026-09-27T18:00:00+00:00',
        completed_at: null,
      }),
      // real shape: completed with completed_at null → no duration
      run({
        id: 'a4',
        started_at: '2026-05-30T11:45:26+00:00',
        completed_at: null,
      }),
      run({
        id: 'b1',
        workflow_id: 'agent-improve-loop',
        status: 'paused',
        started_at: '2026-08-03T07:36:39.625000+00:00',
        completed_at: null,
      }),
    ]
    const idx = indexRunsByWorkflow(runs)
    expect(idx.wf.last?.id).toBe('a3')
    expect(idx.wf.active.map((r) => r.id)).toEqual(['a3'])
    expect(idx.wf.recent.map((r) => r.id)).toEqual(['a3', 'a2', 'a1', 'a4'])
    expect(idx.wf.medianMs).toBe(3000)
    expect(idx.wf.sparkline.map((p) => p.id)).toEqual(['a4', 'a1', 'a2', 'a3'])
    expect(idx['agent-improve-loop'].waiting.map((r) => r.id)).toEqual(['b1'])
    expect(idx['agent-improve-loop'].medianMs).toBeNull()
  })

  it('caps recent and sparkline at 10', () => {
    const runs = Array.from({ length: 15 }, (_, i) =>
      run({
        id: `r${i}`,
        started_at: 1_700_000_000 + i,
        completed_at: 1_700_000_001 + i,
      }),
    )
    const s = indexRunsByWorkflow(runs).wf
    expect(s.recent).toHaveLength(10)
    expect(s.sparkline).toHaveLength(10)
    expect(s.recent[0].id).toBe('r14')
    expect(s.medianMs).toBe(1000)
  })
})

describe('runIndexInterval', () => {
  it('2s while live or waiting, 10s idle', () => {
    expect(runIndexInterval([run({ status: 'running' })])).toBe(2000)
    expect(runIndexInterval([run({ status: 'paused' })])).toBe(2000)
    expect(runIndexInterval([run({ status: 'completed' })])).toBe(10_000)
    expect(runIndexInterval(undefined)).toBe(10_000)
  })
})

describe('phaseLabel (D3)', () => {
  it('maps vocabulary case-insensitively', () => {
    expect(phaseLabel('Discover')).toBe('PLAN')
    expect(phaseLabel('plan')).toBe('PLAN')
    expect(phaseLabel('Execute')).toBe('EXECUTE')
    expect(phaseLabel('review')).toBe('REVIEW')
    expect(phaseLabel('approval')).toBe('REVIEW')
    expect(phaseLabel('Report')).toBe('REPORT')
    expect(phaseLabel('route')).toBe('ROUTE')
    expect(phaseLabel('nonsense')).toBeNull()
    expect(phaseLabel(null)).toBeNull()
  })
})

describe('runAgainInput (D6)', () => {
  it('builds from a run row: metadata.inputs + user_message', () => {
    const input = runAgainInput(
      run({
        workflow_id: 'repo-review',
        user_message: 'review it',
        metadata: { inputs: { repo: 'x' } },
      }),
    )
    expect(input).toMatchObject({
      workflow_id: 'repo-review',
      user_message: 'review it',
      variables: { repo: 'x' },
      schedule: { type: 'now' },
    })
    expect(input?.conversation_id).toBeTruthy()
  })

  it('builds from a Mission; empty inputs → no variables', () => {
    const mission = {
      workflowId: 'wf',
      userMessage: 'go',
      inputs: {},
    } as unknown as Mission
    expect(runAgainInput(mission)).toMatchObject({
      workflow_id: 'wf',
      variables: undefined,
    })
  })

  it('null without a recorded message', () => {
    expect(runAgainInput(run({ user_message: '' }))).toBeNull()
  })
})

describe('fetchRunIndexRuns', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('makes exactly one request: /api/workflow-runs?limit=200', async () => {
    const urls: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(url)
        return Promise.resolve(
          new Response(JSON.stringify({ runs: [run({ id: 'r1' })] })),
        )
      }),
    )
    const runs = await fetchRunIndexRuns()
    expect(urls).toEqual(['/api/workflow-runs?limit=200'])
    expect(runs.map((r) => r.id)).toEqual(['r1'])
  })
})
