import {
  useConductorScheduled,
  useConductorState,
} from './use-conductor-queries'

export function ConductorTopBar() {
  const { data } = useConductorState()
  const { data: sched } = useConductorScheduled()
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
          <span className="v">{data?.oldestLiveElapsed ?? '—'}</span>
          <span className="l">oldest live</span>
        </div>
        <div className="stat">
          <span className="v">{data?.tokens ?? '—'}</span>
          <span className="l">tok used</span>
        </div>
        <div className="right-actions">
          <button type="button" className="ico-btn" title="Refresh">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
          </button>
          <button type="button" className="ico-btn" title="Theme">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
