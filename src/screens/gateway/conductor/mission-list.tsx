import {
  useConductorMissions,
  useConductorScheduled,
} from './use-conductor-queries'
import { MissionCard, formatClock } from './mission-card'
import { groupRail } from './rail-grouping'
import type { RailRow } from './rail-grouping'
import type { Mission } from './use-conductor-queries'
import type { FilterTab } from '@/stores/conductor-ui-store'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

function filterMissions(
  missions: Array<Mission>,
  tab: FilterTab,
): Array<Mission> {
  if (tab === 'all') return missions
  if (tab === 'live') return missions.filter((m) => m.status === 'live')
  if (tab === 'waiting') return missions.filter((m) => m.status === 'waiting')
  if (tab === 'done')
    return missions.filter(
      (m) => m.status === 'done' || m.status === 'cancelled',
    )
  return missions.filter((m) => m.status === 'err')
}

function matches(m: Mission, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [m.title, m.workflowId, m.id, m.triggerKind ?? ''].some((v) =>
    v.toLowerCase().includes(needle),
  )
}

function RailRowView({ row }: { row: RailRow }) {
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)
  if (row.kind === 'run') return <MissionCard mission={row.mission} />
  if (row.kind === 'fold') {
    const newest = row.missions[0]
    return (
      <button
        type="button"
        className={`miss fold ${newest.status}`}
        onClick={() => setSelectedRunId(newest.id)}
        title={`${row.count} consecutive runs; opens the newest`}
      >
        <span className="rail" />
        <span className="body">
          <span className="ttl">{newest.title}</span>
          <span className="sub">
            {newest.triggerKind ?? 'run'} · last {formatClock(row.to)} ·{' '}
            {newest.elapsed}
          </span>
          <span className="badges">
            <span className={`b ${newest.status}`}>
              {newest.status} ×{row.count}
            </span>
            <span className="b trig">{newest.triggerKind ?? '—'}</span>
            <span className="b">
              {formatClock(row.from)} – {formatClock(row.to)}
            </span>
          </span>
        </span>
      </button>
    )
  }
  const { item } = row
  return (
    <div className={`miss sched${item.enabled ? '' : ' off'}`}>
      <div className="rail" />
      <div className="body">
        <div className="ttl">{item.workflowId}</div>
        <div className="sub">{item.scheduleLabel}</div>
        <div className="badges">
          <span className="b">
            {item.enabled
              ? item.nextRunAt != null
                ? `next ${formatClock(item.nextRunAt)}`
                : 'no next run'
              : 'paused'}
          </span>
          {item.lastRunAt != null && (
            <span className="b">last {formatClock(item.lastRunAt)}</span>
          )}
          {item.lastStatus && <span className="b">{item.lastStatus}</span>}
        </div>
      </div>
    </div>
  )
}

export function MissionList({ search = '' }: { search?: string }) {
  const filterTab = useConductorUIStore((s) => s.filterTab)
  const { data: missions = [] } = useConductorMissions()
  const { data: sched } = useConductorScheduled()

  // Scheduled entries aren't runs: only the unfiltered view lists them.
  const groups = groupRail(
    filterMissions(missions, filterTab).filter((m) => matches(m, search)),
    filterTab === 'all' ? sched?.scheduled : [],
  )

  return (
    <div className="h-list">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <div className="h-day">
            {g.label}
            {g.key === 'scheduled' && (
              <span
                className={`sched-state ${sched?.schedulerAlive ? 'on' : 'off'}`}
              >
                {sched?.schedulerAlive
                  ? 'scheduler alive'
                  : 'scheduler offline'}
              </span>
            )}
          </div>
          {g.rows.map((row) => (
            <RailRowView key={row.key} row={row} />
          ))}
        </section>
      ))}
      {groups.length === 0 && (
        <div className="h-day" style={{ opacity: 0.5 }}>
          No missions
        </div>
      )}
    </div>
  )
}
