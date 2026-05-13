import { useOperationsUIStore } from '../../../stores/operations-ui-store'

interface TeamHeaderProps {
  count: number
}

export function TeamHeader({ count }: TeamHeaderProps) {
  const setNewAgentModalOpen = useOperationsUIStore((s) => s.setNewAgentModalOpen)

  return (
    <div className="team-head">
      <h3>Team</h3>
      <span className="team-ct">· {count}</span>
      <div className="team-actions">
        <button
          type="button"
          className="ico-btn"
          title="Add agent"
          onClick={() => setNewAgentModalOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  )
}
