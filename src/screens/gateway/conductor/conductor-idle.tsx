import { Suspense, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FlowCanvas, graphLoading } from './mission-canvas'
import { buildDag } from './dag-model'
import { fmtDuration } from './dag-layout'
import { useConductorScheduled } from './use-conductor-queries'
import type { CanvasFocus } from './focus'
import type { WorkflowRunRow } from '@/screens/workflows/api-client'
import type { ScheduledWorkflow } from '@/server/conductor-store'
import {
  fetchRunIndexRuns,
  runDurationMs,
  runIndexInterval,
  toEpochMs,
} from '@/screens/workflows/run-status'
import { useWorkflowParsed } from '@/screens/workflows/use-workflows'

const WEEK_MS = 7 * 24 * 3600 * 1000

export interface IdleStats {
  runs7d: number
  failed7d: number
  medianMs: number | null
  waiting: number
}

/** Tile numbers from the run index (one shared query, newest 200 runs). */
export function idleStats(rows: Array<WorkflowRunRow>, now: number): IdleStats {
  const recent = rows.filter((r) => {
    const t = toEpochMs(r.started_at)
    return t != null && now - t <= WEEK_MS
  })
  const durations = recent
    .filter((r) => r.status === 'completed')
    .map(runDurationMs)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)
  const mid = durations.length >> 1
  const medianMs = durations.length
    ? durations.length % 2
      ? durations[mid]
      : (durations[mid - 1] + durations[mid]) / 2
    : null
  return {
    runs7d: recent.length,
    failed7d: recent.filter((r) => r.status === 'failed').length,
    medianMs,
    waiting: rows.filter((r) => r.status === 'paused').length,
  }
}

/** "in 2d 17h" / "in 3h 05m" / "in 12m"; "due" when past. */
export function untilLabel(targetMs: number, now: number): string {
  const diff = targetMs - now
  if (diff <= 0) return 'due now'
  const m = Math.floor(diff / 60_000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d) return `in ${d}d ${h}h`
  if (h) return `in ${h}h ${String(m % 60).padStart(2, '0')}m`
  return `in ${Math.max(1, m)}m`
}

function PreviewGraph({ workflowId }: { workflowId: string }) {
  const { data } = useWorkflowParsed(workflowId)
  const dag = useMemo(() => (data ? buildDag(data.parsed) : null), [data])
  return (
    <div className="idle-prev" aria-label={`Preview of ${workflowId}`}>
      <span className="pl">PREVIEW · {workflowId} graph</span>
      {dag && dag.nodes.length > 0 ? (
        <Suspense fallback={graphLoading}>
          <FlowCanvas
            key={workflowId}
            dag={dag}
            workflowId={workflowId}
            preview
          />
        </Suspense>
      ) : (
        <div className="dag-empty">Loading graph…</div>
      )}
    </div>
  )
}

interface IdleProps {
  focus: Extract<CanvasFocus, { kind: 'preview' | 'empty' }>
  /** Earliest enabled scheduled entry (from the layout); drives the preview hero. */
  nextScheduled: ScheduledWorkflow | null
  onRunNow: (workflowId: string) => void
  onNewMission: () => void
}

export function ConductorIdle({
  focus,
  nextScheduled: next,
  onRunNow,
  onNewMission,
}: IdleProps) {
  const { data: sched } = useConductorScheduled()
  const { data: rows = [] } = useQuery({
    queryKey: ['workflow-runs', 'index'],
    queryFn: fetchRunIndexRuns,
    refetchInterval: (q) => runIndexInterval(q.state.data),
  })
  const now = Date.now()
  const stats = idleStats(rows, now)

  const offline = sched != null && !sched.schedulerAlive
  const pendingCount = sched?.scheduled.filter((s) => s.enabled).length ?? 0

  return (
    <div className="idle">
      <div className="hero">
        {focus.kind === 'preview' ? (
          <>
            <div className="hero-txt">
              <span className="meta">NEXT SCHEDULED</span>
              <span className="big">
                {focus.workflowId}
                {next?.nextRunAt
                  ? ` · ${new Date(next.nextRunAt).toLocaleString([], {
                      weekday: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </span>
              <span className="meta">
                {next?.cron ? `cron ${next.cron}` : 'scheduled'}
                {sched?.profile ? ` · profile ${sched.profile}` : ''}
                {next?.nextRunAt ? ` · ${untilLabel(next.nextRunAt, now)}` : ''}
              </span>
            </div>
            <span className="grow" />
            <button
              type="button"
              className="btn"
              onClick={() => onRunNow(focus.workflowId)}
            >
              RUN NOW
            </button>
          </>
        ) : (
          <div className="hero-txt">
            <span className="meta">
              {offline && pendingCount > 0
                ? 'SCHEDULER OFFLINE'
                : 'NOTHING RUNNING'}
            </span>
            <span className="big">
              {offline && pendingCount > 0
                ? `${pendingCount} scheduled workflow${pendingCount > 1 ? 's' : ''} will not fire`
                : rows.length
                  ? 'Nothing running'
                  : 'No missions yet'}
            </span>
            <span className="meta">
              {offline && pendingCount > 0
                ? 'The workflow scheduler daemon is not running.'
                : 'Start a workflow run and it will show up here live.'}
            </span>
          </div>
        )}
        <button type="button" className="btn p" onClick={onNewMission}>
          + NEW MISSION
        </button>
      </div>

      {focus.kind === 'preview' ? (
        <PreviewGraph workflowId={focus.workflowId} />
      ) : (
        <div className="idle-prev empty" />
      )}

      <div className="stats">
        <Tile v={stats.runs7d} l="RUNS · 7 DAYS" />
        <Tile
          v={stats.failed7d}
          l="FAILED · 7 DAYS"
          tone={stats.failed7d ? 'bad' : ''}
        />
        <Tile v={fmtDuration(stats.medianMs)} l="MEDIAN DURATION" />
        <Tile
          v={stats.waiting}
          l="WAITING FOR YOU"
          tone={stats.waiting ? 'warn' : ''}
        />
      </div>
    </div>
  )
}

function Tile({
  v,
  l,
  tone = '',
}: {
  v: string | number
  l: string
  tone?: string
}) {
  return (
    <div className="s">
      <div className={`sv ${tone}`}>{v}</div>
      <div className="sl">{l}</div>
    </div>
  )
}
