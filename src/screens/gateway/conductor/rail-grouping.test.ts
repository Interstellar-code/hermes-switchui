import { describe, expect, it } from 'vitest'
import { groupRail } from './rail-grouping'
import type { Mission } from '@/server/conductor-store'

const NOW = new Date('2026-10-04T15:00:00').getTime()
const H = 3_600_000

function m(id: string, over: Partial<Mission> = {}): Mission {
  return {
    id,
    title: 'wf',
    subtitle: '',
    status: 'done',
    elapsed: '00:10',
    tokens: '—',
    dayGroup: 'today',
    createdAt: NOW - H,
    workflowId: 'wf',
    triggerKind: null,
    inputs: {},
    userMessage: '',
    error: null,
    ...over,
  }
}

describe('groupRail', () => {
  it('splits into the five sections in order', () => {
    const groups = groupRail(
      [
        m('w', { status: 'waiting' }),
        m('l', { status: 'live', workflowId: 'a' }),
        m('t', { workflowId: 'b' }),
        m('r', { workflowId: 'c', createdAt: NOW - 30 * H }),
      ],
      [
        {
          id: 'job1',
          workflowId: 's',
          scheduleLabel: 'cron 0 9 * * 1',
          cron: '0 9 * * 1',
          nextRunAt: 1,
          enabled: true,
          lastRunAt: null,
          lastStatus: null,
        },
      ],
      NOW,
    )
    expect(groups.map((g) => g.key)).toEqual([
      'needs',
      'live',
      'today',
      'scheduled',
      'recent',
    ])
  })

  it('folds consecutive same-workflow runs with a time range', () => {
    const [today] = groupRail(
      [
        m('a', { createdAt: NOW - 1 * H }),
        m('b', { createdAt: NOW - 2 * H }),
        m('c', { createdAt: NOW - 3 * H }),
        m('d', { workflowId: 'other', createdAt: NOW - 4 * H }),
        m('e', { createdAt: NOW - 5 * H }),
      ],
      [],
      NOW,
    )
    expect(today.rows.map((r) => r.kind)).toEqual(['fold', 'run', 'run'])
    const fold = today.rows[0]
    if (fold.kind !== 'fold') throw new Error('expected fold')
    expect(fold.count).toBe(3)
    expect(fold.from).toBe(NOW - 3 * H)
    expect(fold.to).toBe(NOW - 1 * H)
  })

  it('never folds a failed run into done runs', () => {
    const [today] = groupRail(
      [m('a'), m('b', { status: 'err', createdAt: NOW - 2 * H })],
      [],
      NOW,
    )
    expect(today.rows).toHaveLength(2)
  })

  it('omits empty groups', () => {
    expect(groupRail([], [], NOW)).toEqual([])
  })
})
