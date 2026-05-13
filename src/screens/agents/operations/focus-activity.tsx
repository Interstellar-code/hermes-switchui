import type { ActivityItem } from './mock-data'

interface FocusActivityProps {
  items: ActivityItem[]
}

export function FocusActivity({ items }: FocusActivityProps) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h4>Activity</h4>
        <span className="ct">· last 10 min</span>
        <span className="more">stream →</span>
      </div>
      <div className="panel-body">
        <div className="timeline">
          {items.map((item, i) => (
            <div key={i} className={`tl-item${item.done ? ' done' : ''}`}>
              <span className="t">{item.time}</span>
              {item.tag && (
                <span
                  className={`tag${item.tag === 'tool' ? ' tool' : item.tag === 'handoff' ? ' handoff' : ''}`}
                >
                  {item.tag}
                </span>
              )}
              {item.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
