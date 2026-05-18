import type { CSSProperties } from 'react'

export interface LaneBlock {
  className: string
  style: CSSProperties
  label: string
}

interface LaneRowProps {
  name: string
  role: string
  dotStatus?: 'active' | 'idle' | 'blocked' | 'error'
  blocks: Array<LaneBlock>
  nowLineLeft: string
}

export function LaneRow({ name, role, dotStatus = 'active', blocks, nowLineLeft }: LaneRowProps) {
  const dotClass = ['dot', dotStatus !== 'active' ? dotStatus : ''].filter(Boolean).join(' ')
  return (
    <div className="lane">
      <div className="name">
        <span className={dotClass} />
        {name}
        <span className="role">{role}</span>
      </div>
      <div className="track">
        {blocks.map((blk, i) => (
          <div
            key={i}
            className={`blk ${blk.className}`}
            style={blk.style}
          >
            {blk.label}
          </div>
        ))}
        <div className="now-line" style={{ left: nowLineLeft }} />
      </div>
    </div>
  )
}
