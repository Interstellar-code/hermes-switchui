import { useConductorState } from './use-conductor-queries'

interface ConductorTopBarData {
  liveMissions: number
  elapsed: string
  workersActive: number
  tokensUsed: string
}

const DEFAULT_DATA: ConductorTopBarData = {
  liveMissions: 0,
  elapsed: '00:00',
  workersActive: 0,
  tokensUsed: '0',
}

export function ConductorTopBar() {
  const { data: serverData } = useConductorState()
  const data = serverData ?? DEFAULT_DATA
  return (
    <header className="cnd-top">
      <div className="crumbs">
        <span>Switch UI</span>
        <span className="sep">›</span>
        <span className="cur">Conductor</span>
        <span className="sep">·</span>
        <span>mission flow · live</span>
      </div>
      <div className="health">
        <div className="stat">
          <span className="v ok">{data.liveMissions}</span>
          <span className="l">live mission</span>
        </div>
        <div className="stat">
          <span className="v">{data.elapsed}</span>
          <span className="l">elapsed</span>
        </div>
        <div className="stat">
          <span className="v">{data.workersActive}</span>
          <span className="l">workers active</span>
        </div>
        <div className="stat">
          <span className="v">{data.tokensUsed}</span>
          <span className="l">tok used</span>
        </div>
        <div className="right-actions">
          <button type="button" className="ico-btn" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
          </button>
          <button type="button" className="ico-btn" title="Theme">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
