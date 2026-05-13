import type { Agent } from './mock-data'

interface AgentCardProps {
  agent: Agent
  active?: boolean
  onClick?: () => void
}

export function AgentCard({ agent, active = false, onClick }: AgentCardProps) {
  const metaValue = agent.tokens ? (
    <span className="tok">{agent.tokens}</span>
  ) : (
    <span>
      {agent.status === 'blocked' ? 'blocked' : agent.status === 'error' ? 'err' : '—'}
    </span>
  )

  return (
    <div className={`agent${active ? ' active' : ''}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <div className="av">
        {agent.initials}
        <span className={`pulse ${agent.status}`} />
      </div>
      <div className="body">
        <div className="name">
          {agent.name}
          <span className={`role${agent.role === 'worker' ? ' worker' : ''}`}>
            {agent.role}
          </span>
        </div>
        <div className="task">{agent.task}</div>
        <div className={`cap${agent.capacityVariant ? ` ${agent.capacityVariant}` : ''}`}>
          <span style={{ width: `${agent.capacityPct}%` }} />
        </div>
      </div>
      <div className="meta">
        {metaValue}
        <br />
        {agent.lastSeen}
      </div>
    </div>
  )
}
