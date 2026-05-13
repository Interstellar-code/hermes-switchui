import { useConductorMission } from './use-conductor-queries'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

function formatDate(ts: number | undefined): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export function MissionDetailDrawer() {
  const focusedMissionId = useConductorUIStore((s) => s.focusedMissionId)
  const setFocusedMissionId = useConductorUIStore((s) => s.setFocusedMissionId)
  const { data: mission, isLoading } = useConductorMission(focusedMissionId)

  if (!focusedMissionId) return null

  return (
    <div className="mdd-backdrop" onClick={() => setFocusedMissionId(null)}>
      <aside className="mdd" onClick={(e) => e.stopPropagation()}>
        <div className="mdd-head">
          <span className="mdd-title">Mission Detail</span>
          <button
            className="ico-btn mdd-close"
            onClick={() => setFocusedMissionId(null)}
            aria-label="Close drawer"
          >
            <CloseIcon />
          </button>
        </div>

        {isLoading || !mission ? (
          <div className="mdd-loading">loading…</div>
        ) : (
          <div className="mdd-body">
            <div className="mdd-row">
              <span className="mdd-lbl">ID</span>
              <span className="mdd-val mdd-id">{mission.id}</span>
            </div>
            <div className="mdd-row">
              <span className="mdd-lbl">Title</span>
              <span className="mdd-val">{mission.title}</span>
            </div>
            {mission.subtitle && (
              <div className="mdd-row">
                <span className="mdd-lbl">Subtitle</span>
                <span className="mdd-val mdd-sub">{mission.subtitle}</span>
              </div>
            )}
            <div className="mdd-row">
              <span className="mdd-lbl">Status</span>
              <span className={`mdd-badge ${mission.status}`}>{mission.status}</span>
            </div>
            <div className="mdd-row">
              <span className="mdd-lbl">Elapsed</span>
              <span className="mdd-val">{mission.elapsed ?? '—'}</span>
            </div>
            <div className="mdd-row">
              <span className="mdd-lbl">Tokens</span>
              <span className="mdd-val">{mission.tokens ?? '—'}</span>
            </div>
            <div className="mdd-row">
              <span className="mdd-lbl">Created</span>
              <span className="mdd-val">{formatDate(mission.createdAt)}</span>
            </div>

            <div className="mdd-transcript-head">Transcript</div>
            <div className="mdd-transcript">
              <div className="mdd-t-line">{'// transcript not yet wired — coming soon'}</div>
              <div className="mdd-t-line">{'// real transcript data is a future feature'}</div>
              <div className="mdd-t-line">{'// beyond M7 scope'}</div>
              <div className="mdd-t-line mdd-t-cursor">{'_'}</div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
