import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useConductorScheduled,
  useConductorState,
} from './use-conductor-queries'

/** mm:ss, h/m past an hour. */
export function formatTick(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  if (h >= 1) return `${h}h ${Math.floor((s % 3600) / 60)}m`
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function ConductorTopBar() {
  const { data } = useConductorState()
  const { data: sched } = useConductorScheduled()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const oldestStart = data?.oldestLiveStartedAt ?? null
  useEffect(() => {
    if (oldestStart == null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [oldestStart])

  const oldestLive = !data
    ? '—'
    : oldestStart == null
      ? 'none'
      : formatTick(now - oldestStart)
  // Runs exist but none report usage: show 0; no runs at all keeps '—'.
  const tokens =
    data && data.tokens === '—' && data.totalTokens === 0 && data.runsToday > 0
      ? '0'
      : (data?.tokens ?? '—')

  function refresh() {
    setRefreshing(true)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conductor'] }),
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] }),
    ]).finally(() => setRefreshing(false))
  }
  return (
    <header className="cnd-top">
      <div className="crumbs">
        <span>Switch UI</span>
        <span className="sep">›</span>
        <span className="cur">Conductor</span>
        <span className="sep">·</span>
        <span>mission flow · live</span>
        {sched?.profile ? (
          <span
            className="chip"
            title={
              sched.schedulerAlive ? 'Scheduler alive' : 'Scheduler offline'
            }
          >
            {sched.profile}
            <span className={`dot${sched.schedulerAlive ? ' on' : ''}`} />
            <span>
              {sched.schedulerAlive ? 'scheduler' : 'scheduler offline'}
            </span>
          </span>
        ) : null}
      </div>
      <div className="health">
        <div className="stat">
          <span className="v ok">{data?.live ?? '—'}</span>
          <span className="l">live</span>
        </div>
        <div className="stat">
          <span className="v">{data?.needsYou ?? '—'}</span>
          <span className="l">needs you</span>
        </div>
        <div className="stat">
          <span className="v">{data?.nodesRunning ?? '—'}</span>
          <span className="l">nodes running</span>
        </div>
        <div className="stat">
          <span className="v">{oldestLive}</span>
          <span className="l">oldest live</span>
        </div>
        <div className="stat">
          <span className="v">{tokens}</span>
          <span className="l">tok used</span>
        </div>
        <div className="right-actions">
          <button
            type="button"
            className={`ico-btn${refreshing ? ' spin' : ''}`}
            title="Refresh"
            aria-label="Refresh"
            disabled={refreshing}
            onClick={refresh}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
