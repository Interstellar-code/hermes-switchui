import { useConductorMissions } from './use-conductor-queries'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

/** Shown while any run is waiting on approval; Review opens its drawer. */
export function ApprovalBanner() {
  const { data: missions = [] } = useConductorMissions()
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)
  const waiting = missions
    .filter((m) => m.status === 'waiting')
    .sort((a, b) => a.createdAt - b.createdAt)
  if (waiting.length === 0) return null
  const first = waiting[0]
  return (
    <div className="cnd-banner">
      <span className="bt" role="status">
        {first.title} is paused — waiting on you
        {waiting.length > 1 ? ` (+${waiting.length - 1} more)` : ''}
      </span>
      <span className="meta" aria-hidden="true">waiting {first.elapsed}</span>
      <button type="button" onClick={() => setDrawerRunId(first.id)}>
        Review
      </button>
    </div>
  )
}
