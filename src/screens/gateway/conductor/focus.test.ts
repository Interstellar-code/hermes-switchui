import { describe, expect, it } from 'vitest'
import { selectFocus } from './focus'
import type { Mission } from '@/server/conductor-store'

const m = (id: string, status: Mission['status'], createdAt: number) =>
  ({ id, status, createdAt }) as Mission

const missions = [
  m('old-live', 'live', 1),
  m('new-live', 'live', 5),
  m('waiting', 'waiting', 9),
  m('done', 'done', 10),
]

describe('selectFocus (D2)', () => {
  it('explicit selection wins, even before the run is listed', () => {
    expect(
      selectFocus({
        selectedRunId: 'just-launched',
        missions,
        nextScheduled: null,
      }),
    ).toEqual({ kind: 'run', runId: 'just-launched', reason: 'selected' })
  })

  it('then the newest live run', () => {
    expect(
      selectFocus({ selectedRunId: null, missions, nextScheduled: null }),
    ).toEqual({
      kind: 'run',
      runId: 'new-live',
      reason: 'live',
    })
  })

  it('then the newest waiting run', () => {
    const ms = [m('w1', 'waiting', 1), m('w2', 'waiting', 2), m('d', 'done', 3)]
    expect(
      selectFocus({ selectedRunId: null, missions: ms, nextScheduled: null }),
    ).toEqual({
      kind: 'run',
      runId: 'w2',
      reason: 'waiting',
    })
  })

  it('then the idle preview of the next scheduled workflow', () => {
    expect(
      selectFocus({
        selectedRunId: null,
        missions: [m('d', 'done', 3)],
        nextScheduled: { workflowId: 'githubawesome-monitor' },
      }),
    ).toEqual({ kind: 'preview', workflowId: 'githubawesome-monitor' })
  })

  it('empty when nothing applies', () => {
    expect(
      selectFocus({ selectedRunId: null, missions: [], nextScheduled: null }),
    ).toEqual({
      kind: 'empty',
    })
  })
})
