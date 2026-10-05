import type { EventItem } from '@/screens/workflows/run-inspector/events-model'
import { fmtTime } from '@/screens/workflows/run-inspector/inspector-model'

export function NodeEvents({ items }: { items: Array<EventItem> }) {
  if (items.length === 0)
    return <div className="cnp-empty">No events recorded for this node.</div>
  return (
    <ol className="cnp-ev" aria-label="Node events">
      {items.map((e) => (
        <li key={e.key}>
          <span className="cnp-ev-t">{fmtTime(e.ts)}</span>
          <span className="cnp-ev-k">{e.type}</span>
          <span className="cnp-ev-s">{e.summary}</span>
        </li>
      ))}
    </ol>
  )
}
