import { useConductorUIStore } from '@/stores/conductor-ui-store'

export type MissionStatus = 'live' | 'done' | 'err'

export interface MissionCardData {
  id: string
  title: string
  subtitle: string
  status: MissionStatus
  elapsed: string
  tokens: string
}

interface MissionCardProps {
  mission: MissionCardData
}

const FocusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="12" r="9" />
    <polygon points="10 8 16 12 10 16" />
  </svg>
)

const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 12a9 9 0 1 0 9-9" />
    <polyline points="3 4 3 12 11 12" />
  </svg>
)

export function MissionCard({ mission }: MissionCardProps) {
  const { id, title, subtitle, status, elapsed, tokens } = mission

  const focusedMissionId = useConductorUIStore((s) => s.focusedMissionId)
  const setFocusedMissionId = useConductorUIStore((s) => s.setFocusedMissionId)

  const isFocused = focusedMissionId === id
  const actionLabel = status === 'live' ? 'abort' : status === 'err' ? 'retry' : 'replay'
  const actionTitle =
    status === 'live'
      ? 'Abort not yet supported'
      : status === 'err'
        ? 'Retry not yet supported'
        : 'Replay not yet supported'
  const ActionIcon = status === 'live' ? FocusIcon : ReplayIcon

  function handleAction(e: React.MouseEvent) {
    // All actions (abort/retry/replay) wired to engine in a follow-up PR.
    e.stopPropagation()
  }

  return (
    <div
      className={`miss ${status}${isFocused ? ' focus' : ''}`}
      onClick={() => setFocusedMissionId(id)}
    >
      <div className="rail" />
      <div className="body">
        <div className="ttl">{title}</div>
        <div className="sub">{subtitle}</div>
        <div className="badges">
          <span className={`b ${status}`}>{status}</span>
          <span className="b">{elapsed}</span>
        </div>
      </div>
      <div className="meta">
        <span className="tok">{tokens}</span>
        <br />
        <button
          className="replay"
          onClick={handleAction}
          title={actionTitle}
          disabled
          style={{
            cursor: 'not-allowed',
            opacity: 0.5,
            background: 'none',
            border: 'none',
            padding: 0,
          }}
        >
          <ActionIcon />
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
