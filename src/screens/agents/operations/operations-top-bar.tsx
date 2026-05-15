import { useOperationsState } from './use-operations-queries'

export function OperationsTopBar() {
  const { data: state } = useOperationsState()

  const liveLabel = state ? `${state.live}/${state.total}` : '…'
  const tokenRate = state?.tokenRate ?? '…'
  const queue = state?.queue ?? '…'
  const errors24h = state?.errors24h ?? '…'
  const spark = state?.spark ?? [22, 18, 20, 14, 16, 9, 12, 6, 10, 4, 8, 3, 7]

  // Build SVG polyline points from spark array (scaled to 28px height, 96px wide)
  const pts = spark
    .map((v, i) => {
      const max = Math.max(...spark, 1)
      const x = (i / (spark.length - 1)) * 96
      const y = 28 - (v / max) * 24
      return `${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' L')

  const sparkPath = `M${pts}`
  const fillPath = `${sparkPath} L96 28 L0 28 Z`

  return (
    <header className="ops-top">
      <div className="crumbs">
        <span>Switch UI</span>
        <span className="sep">›</span>
        <span className="cur">Operations</span>
        <span className="sep">·</span>
        <span>persistent agent team</span>
      </div>
      <div className="health">
        <div className="stat">
          <span className="v ok">{liveLabel}</span>
          <span className="l">live</span>
        </div>
        <div className="stat">
          <span className="v">{tokenRate}</span>
          <span className="l">tok/min</span>
        </div>
        <div className="stat">
          <span className="v">{queue}</span>
          <span className="l">queue</span>
        </div>
        <div className="stat">
          <span className={`v${errors24h && Number(errors24h) > 0 ? ' warn' : ''}`}>{errors24h}</span>
          <span className="l">errors · 24h</span>
        </div>
        <svg className="spark" viewBox="0 0 96 28" fill="none" stroke="currentColor">
          <path d={sparkPath} strokeWidth="1.4" />
          <path d={fillPath} fill="rgba(0,255,65,.08)" stroke="none" />
        </svg>
        <div className="actions">
          <button type="button" className="ico-btn" title="Pause team">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </button>
          <button type="button" className="ico-btn" title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
