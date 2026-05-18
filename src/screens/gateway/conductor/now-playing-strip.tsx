import { useConductorMissions } from './use-conductor-queries'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

type Phase = 'plan' | 'route' | 'execute' | 'review' | 'report'

const PHASES: Array<Phase> = ['plan', 'route', 'execute', 'review', 'report']

interface MissionPhase {
  current_phase?: string
}

function phaseState(
  phase: Phase,
  current: string | undefined,
): 'done' | 'now' | 'pending' {
  if (!current) return 'pending'
  const currentIdx = PHASES.indexOf(current as Phase)
  const phaseIdx = PHASES.indexOf(phase)
  if (currentIdx < 0) return 'pending'
  if (phaseIdx < currentIdx) return 'done'
  if (phaseIdx === currentIdx) return 'now'
  return 'pending'
}

export function NowPlayingStrip() {
  const { data: missions = [] } = useConductorMissions()
  const focusedMissionId = useConductorUIStore((s) => s.focusedMissionId)

  // Prefer focused mission; fall back to first 'live'; else first overall.
  const mission =
    missions.find((m) => m.id === focusedMissionId) ??
    missions.find((m) => m.status === 'live') ??
    missions[0]

  // current_phase isn't on the Mission projection; parse from subtitle
  // (format: '<workflow_id> · <current_phase>')
  const currentPhase =
    mission?.subtitle?.split('·').map((s) => s.trim()).pop() ?? undefined

  if (!mission) {
    return (
      <div className="now">
        <div className="stamp">
          elapsed
          <b>—</b>
        </div>
        <div className="body">
          <div className="lbl">no live mission</div>
          <div className="prompt" style={{ opacity: 0.5 }}>
            Run a workflow from the Workflows page to see it here.
          </div>
        </div>
        <div className="stages">
          {PHASES.map((p) => (
            <span key={p} className="st">
              {p}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="now">
      <div className="stamp">
        elapsed
        <b>{mission.elapsed}</b>
      </div>
      <div className="body">
        <div className="lbl">
          {mission.status === 'live' ? 'now playing' : mission.status} · {mission.id}
        </div>
        <div className="prompt">{mission.title}</div>
        <div className="meta">
          {mission.subtitle} · used <b>{mission.tokens}</b>
        </div>
      </div>
      <div className="stages">
        {PHASES.map((p) => {
          const state = phaseState(p, currentPhase)
          return (
            <span key={p} className={`st ${state === 'pending' ? '' : state}`}>
              {p}
            </span>
          )
        })}
      </div>
      <div className="controls">
        <button
          type="button"
          className="ico-btn"
          title="Pause (not yet supported)"
          disabled
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        >
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
        <button
          className="btn-kill"
          title="Abort not yet supported"
          disabled
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
        >
          abort
        </button>
      </div>
    </div>
  )
}

// Kept for backward compat with any external imports
export type { MissionPhase }
