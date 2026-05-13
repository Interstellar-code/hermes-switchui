interface NowPlayingStripData {
  elapsed: string
  missionId: string
  prompt: string
  routedBy: string
  domains: string
  taskCount: number
  estTime: string
  budgetTok: string
  usedTok: string
}

interface NowPlayingStripProps {
  data?: NowPlayingStripData
}

const DEFAULT_DATA: NowPlayingStripData = {
  elapsed: '04:18',
  missionId: 'T_67fc8810',
  prompt: 'ROUTED BY SWITCH · NEO TRINITY MORPHEUS · 7 TASKS · 18 MIN',
  routedBy: 'switch',
  domains: 'neo · trinity · morpheus',
  taskCount: 7,
  estTime: '18:00',
  budgetTok: '26k tok',
  usedTok: '8.4k',
}

export function NowPlayingStrip({ data = DEFAULT_DATA }: NowPlayingStripProps) {
  return (
    <div className="now">
      <div className="stamp">
        elapsed
        <b>{data.elapsed}</b>
      </div>
      <div className="body">
        <div className="lbl">now playing · {data.missionId}</div>
        <div className="prompt">{data.prompt}</div>
        <div className="meta">
          routed by <b>{data.routedBy}</b> · 3 domains ({data.domains}) ·{' '}
          {data.taskCount} tasks · est. <b>{data.estTime}</b> · budget{' '}
          <b>{data.budgetTok}</b> · used <b>{data.usedTok}</b>
        </div>
      </div>
      <div className="stages">
        <span className="st done">plan</span>
        <span className="st done">route</span>
        <span className="st now">execute</span>
        <span className="st">review</span>
        <span className="st">report</span>
      </div>
      <div className="controls">
        <button type="button" className="ico-btn" title="Pause">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
        <button className="btn-kill">abort</button>
      </div>
    </div>
  )
}
