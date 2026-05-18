import { useQuery } from '@tanstack/react-query'
import { LaneLegend } from './lane-legend'
import { LaneRow, type LaneBlock } from './lane-row'
import type { LaneScale } from '@/stores/conductor-ui-store'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

interface WorkerRun {
  runId: string
  nodeId: string
  label: string
  elapsed: string
  startedAt: number
}

interface WorkerLane {
  id: string
  name: string
  role: string
  activeCount: number
  runs: Array<WorkerRun>
}

const NOW_LEFT_PCT = 91 // NOW marker position on the x-axis

const SCALE_MS: Record<LaneScale, number> = {
  '1M': 60_000,
  '5M': 5 * 60_000,
  '15M': 15 * 60_000,
  '1H': 60 * 60_000,
}

const SCALE_LABELS: Array<{ id: LaneScale; label: string }> = [
  { id: '1M', label: '1m' },
  { id: '5M', label: '5m' },
  { id: '15M', label: '15m' },
  { id: '1H', label: '1h' },
]

async function fetchWorkers(): Promise<{ lanes: Array<WorkerLane> }> {
  const res = await fetch('/api/conductor/workers')
  if (!res.ok) throw new Error(`conductor/workers: ${res.status}`)
  return res.json() as Promise<{ lanes: Array<WorkerLane> }>
}

// Convert a running node_run to a positioned LaneBlock relative to the
// selected lookback window. Bar extends from startedAt (clamped to window
// left edge) to the NOW marker.
function runToBlock(run: WorkerRun, now: number, windowMs: number): LaneBlock {
  const windowStart = now - windowMs
  const leftPct =
    run.startedAt <= windowStart
      ? 0
      : ((run.startedAt - windowStart) / windowMs) * NOW_LEFT_PCT
  const widthPct = Math.max(NOW_LEFT_PCT - leftPct, 1)
  return {
    className: 'run live',
    style: { left: `${leftPct.toFixed(1)}%`, width: `${widthPct.toFixed(1)}%` },
    label: `${run.label} · ${run.elapsed}`,
  }
}

// Build a window-relative tick row (10 evenly-spaced labels + "now").
function buildTicks(windowMs: number): Array<string> {
  const stepMs = windowMs / 10
  const ticks: Array<string> = []
  for (let i = 10; i >= 1; i--) {
    const ms = stepMs * i
    const totalS = Math.floor(ms / 1000)
    const mm = Math.floor(totalS / 60)
    const ss = totalS % 60
    ticks.push(`-${mm}:${ss.toString().padStart(2, '0')}`)
  }
  ticks.push('now')
  ticks.push('+0:30')
  return ticks
}

export function WorkerLanes() {
  const laneScale = useConductorUIStore((s) => s.laneScale)
  const setLaneScale = useConductorUIStore((s) => s.setLaneScale)

  const { data } = useQuery({
    queryKey: ['conductor', 'workers'],
    queryFn: fetchWorkers,
    refetchInterval: 3000,
  })

  const lanes = data?.lanes ?? []
  const windowMs = SCALE_MS[laneScale]
  const now = Date.now()
  const ticks = buildTicks(windowMs)
  const totalActive = lanes.reduce((s, l) => s + l.activeCount, 0)

  return (
    <div className="lanes-wrap">
      <div className="lanes-head">
        <h3>Worker timeline</h3>
        <span className="ct">
          · {lanes.length} lane{lanes.length !== 1 ? 's' : ''} · {totalActive} active
        </span>
        <div className="right">
          <div className="scale">
            {SCALE_LABELS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={laneScale === id ? 'on' : undefined}
                onClick={() => setLaneScale(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ico-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5 12h14M12 5v14" />
            </svg>
          </span>
        </div>
      </div>

      <div className="lanes">
        <div className="ticks">
          <div />
          <div className="row">
            {ticks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>

        {lanes.length === 0 && (
          <div className="lane">
            <div className="name" style={{ opacity: 0.5 }}>No active workers</div>
            <div className="track" />
          </div>
        )}

        {lanes.map((lane) => (
          <LaneRow
            key={lane.id}
            name={lane.name}
            role={lane.role}
            dotStatus={lane.activeCount > 0 ? 'active' : 'idle'}
            nowLineLeft={`${NOW_LEFT_PCT}%`}
            blocks={lane.runs.map((r) => runToBlock(r, now, windowMs))}
          />
        ))}
      </div>

      <LaneLegend />
    </div>
  )
}
