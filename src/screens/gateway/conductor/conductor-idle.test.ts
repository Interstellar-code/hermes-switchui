import { describe, expect, it } from 'vitest'
import { idleStats, untilLabel } from './conductor-idle'
import type { WorkflowRunRow } from '@/screens/workflows/api-client'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const run = (
  status: string,
  startedAgoH: number,
  durS: number,
): WorkflowRunRow =>
  ({
    id: status + startedAgoH,
    workflow_id: 'w',
    status,
    started_at: new Date(NOW - startedAgoH * 3600_000).toISOString(),
    completed_at: new Date(
      NOW - startedAgoH * 3600_000 + durS * 1000,
    ).toISOString(),
  }) as WorkflowRunRow

describe('idleStats', () => {
  it('counts the last 7 days, failures, median of completed, waiting', () => {
    const s = idleStats(
      [
        run('completed', 1, 2),
        run('completed', 2, 4),
        run('failed', 3, 1),
        run('completed', 24 * 8, 99),
        run('paused', 24 * 30, 0),
      ],
      NOW,
    )
    expect(s).toMatchObject({
      runs7d: 3,
      failed7d: 1,
      medianMs: 3000,
      waiting: 1,
    })
  })
  it('median is null with no completed runs', () => {
    expect(idleStats([], NOW).medianMs).toBeNull()
  })
})

describe('untilLabel', () => {
  it('formats', () => {
    expect(untilLabel(NOW + (2 * 1440 + 17 * 60) * 60_000, NOW)).toBe(
      'in 2d 17h',
    )
    expect(untilLabel(NOW + 125 * 60_000, NOW)).toBe('in 2h 05m')
    expect(untilLabel(NOW + 12 * 60_000, NOW)).toBe('in 12m')
    expect(untilLabel(NOW - 1, NOW)).toBe('due now')
  })
})
