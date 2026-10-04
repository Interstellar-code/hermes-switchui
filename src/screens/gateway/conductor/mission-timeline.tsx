import { useEffect, useMemo, useState } from 'react'
import {
  axisTicks,
  buildRows,
  formatDuration,
  pct,
  rowDuration,
  rowEnd,
  windowFor,
} from './timeline-model'
import type { TimelineScale } from './timeline-model'
import { useWorkflowRun } from '@/screens/workflows/use-workflows'
import '@/styles/matrix-conductor-timeline.css'

const SCALES: Array<{ id: TimelineScale; name: string }> = [
  { id: '1M', name: '1 minute' },
  { id: '5M', name: '5 minutes' },
  { id: '15M', name: '15 minutes' },
  { id: 'FIT', name: 'Fit all' },
]

export function MissionTimeline({ runId }: { runId: string | null }) {
  const { data } = useWorkflowRun(runId)
  const [scale, setScale] = useState<TimelineScale>('FIT')
  const [now, setNow] = useState(() => Date.now())

  const nodeRuns = data?.nodeRuns
  const rows = useMemo(() => buildRows(nodeRuns ?? []), [nodeRuns])
  // Tick while any row is open (running, paused, waiting).
  const anyOpen = rows.some((r) => r.startedAt != null && r.completedAt == null)

  useEffect(() => {
    if (!anyOpen) {
      setNow(Date.now())
      return
    }
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyOpen])

  if (!runId) {
    return (
      <section className="mtl mtl-empty" aria-label="Node timeline">
        Select a run to see its timeline.
      </section>
    )
  }

  const win = windowFor(rows, scale, now)
  const nowPct = pct(now, win)

  return (
    <section className="mtl" aria-label="Node timeline">
      <header className="mtl-head">
        <span className="mtl-title">TIMELINE</span>
        <div className="mtl-scales" role="group" aria-label="Timeline scale">
          {SCALES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="mtl-scale"
              aria-label={s.name}
              aria-pressed={scale === s.id}
              onClick={() => setScale(s.id)}
            >
              {s.id}
            </button>
          ))}
        </div>
      </header>
      <div className="mtl-plot">
        <div className="mtl-axis" aria-hidden="true">
          {axisTicks(win, scale !== 'FIT').map((t) => (
            <span
              key={t.pct}
              className="mtl-tick"
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="mtl-empty">No node runs yet.</div>
        ) : (
          <ul className="mtl-rows" role="list">
            {rows.map((r) => {
              const label =
                r.iteration != null
                  ? `${r.label} · iteration ${r.iteration}`
                  : r.label
              const dur = rowDuration(r, now)
              const durText = dur != null ? formatDuration(dur) : 'not started'
              const end = rowEnd(r, now)
              const showBar =
                r.startedAt != null && end != null && end >= win.start
              const left = r.startedAt != null ? pct(r.startedAt, win) : nowPct
              const right = end != null ? pct(end, win) : nowPct
              return (
                <li
                  key={r.id}
                  className={`mtl-row${r.iteration != null ? ' mtl-row-iter' : ''}`}
                >
                  <span className="mtl-label">{label}</span>
                  <div className="mtl-track">
                    {showBar && (
                      <div
                        className="mtl-bar"
                        role="img"
                        data-status={r.status}
                        style={{
                          left: `${left}%`,
                          width: `max(${Math.max(right - left, 0)}%, 4px)`,
                        }}
                        title={`${label}: ${r.status}, ${durText}`}
                        aria-label={`${label}: ${r.status}, ${durText}`}
                      />
                    )}
                  </div>
                  <span className="mtl-dur">{dur != null ? durText : '—'}</span>
                </li>
              )
            })}
          </ul>
        )}
        {now <= win.end && (
          <div
            className="mtl-now"
            style={{
              left: `calc(var(--mtl-label-w) + (100% - var(--mtl-label-w) - var(--mtl-dur-w)) * ${nowPct / 100})`,
            }}
            aria-hidden="true"
          >
            <span>NOW</span>
          </div>
        )}
      </div>
    </section>
  )
}
