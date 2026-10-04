/**
 * rail-grouping.ts — Conductor rail sections (pure):
 * NEEDS YOU / LIVE / TODAY / SCHEDULED / RECENT, with consecutive runs of the
 * same workflow (and status) folded into one "×N" row.
 */
import type { Mission, ScheduledWorkflow } from '@/server/conductor-store'

export type RailGroupKey = 'needs' | 'live' | 'today' | 'scheduled' | 'recent'

export type RailRow =
  | { kind: 'run'; key: string; mission: Mission }
  | {
      kind: 'fold'
      key: string
      /** newest first */
      missions: Array<Mission>
      count: number
      from: number
      to: number
    }
  | { kind: 'scheduled'; key: string; item: ScheduledWorkflow }

export interface RailGroup {
  key: RailGroupKey
  label: string
  rows: Array<RailRow>
}

/** Fold adjacent same-workflow, same-status runs (input sorted newest first). */
export function foldRuns(missions: Array<Mission>): Array<RailRow> {
  const rows: Array<RailRow> = []
  let i = 0
  while (i < missions.length) {
    let j = i + 1
    while (
      j < missions.length &&
      missions[j].workflowId === missions[i].workflowId &&
      missions[j].status === missions[i].status
    )
      j++
    const run = missions.slice(i, j)
    rows.push(
      run.length === 1
        ? { kind: 'run', key: run[0].id, mission: run[0] }
        : {
            kind: 'fold',
            key: `fold:${run[run.length - 1].id}`,
            missions: run,
            count: run.length,
            from: run[run.length - 1].createdAt,
            to: run[0].createdAt,
          },
    )
    i = j
  }
  return rows
}

export function groupRail(
  missions: Array<Mission>,
  scheduled: Array<ScheduledWorkflow> = [],
  now: number = Date.now(),
): Array<RailGroup> {
  const startOfDay = new Date(now).setHours(0, 0, 0, 0)
  const sorted = [...missions].sort((a, b) => b.createdAt - a.createdAt)
  const finished = sorted.filter(
    (m) =>
      m.status === 'done' || m.status === 'err' || m.status === 'cancelled',
  )
  const plain = (list: Array<Mission>): Array<RailRow> =>
    list.map((mission) => ({ kind: 'run', key: mission.id, mission }))

  const groups: Array<RailGroup> = [
    {
      key: 'needs',
      label: 'Needs you',
      rows: plain(sorted.filter((m) => m.status === 'waiting')),
    },
    {
      key: 'live',
      label: 'Live',
      rows: plain(
        sorted.filter((m) => m.status === 'live' || m.status === 'queued'),
      ),
    },
    {
      key: 'today',
      label: 'Today',
      rows: foldRuns(finished.filter((m) => m.createdAt >= startOfDay)),
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      rows: [...scheduled]
        .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
        .map((item) => ({
          kind: 'scheduled',
          key: `sched:${item.id}`,
          item,
        })),
    },
    {
      key: 'recent',
      label: 'Recent',
      rows: foldRuns(finished.filter((m) => m.createdAt < startOfDay)),
    },
  ]
  return groups.filter((g) => g.rows.length > 0)
}
