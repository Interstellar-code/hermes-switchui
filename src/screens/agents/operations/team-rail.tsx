import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { useOperationsAgents } from './use-operations-queries'
import { TeamHeader } from './team-header'
import { TeamFilters } from './team-filters'
import { AgentCard } from './agent-card'
import { NewAgentModal } from './new-agent-modal'

export function TeamRail() {
  const teamFilter = useOperationsUIStore((s) => s.teamFilter)
  const focusedAgentId = useOperationsUIStore((s) => s.focusedAgentId)
  const setFocusedAgentId = useOperationsUIStore((s) => s.setFocusedAgentId)
  const newAgentModalOpen = useOperationsUIStore((s) => s.newAgentModalOpen)

  const { data: agents = [] } = useOperationsAgents()

  const filtered = agents.filter((a) => {
    if (teamFilter === 'all') return true
    if (teamFilter === 'live') return a.status === 'live'
    if (teamFilter === 'idle') return a.status === 'idle'
    return a.status === 'blocked' || a.status === 'error'
  })

  return (
    <div className="ops-team-rail">
      <TeamHeader count={agents.length} />
      <TeamFilters agents={agents} />
      <div className="team-list">
        {filtered.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            active={agent.id === focusedAgentId}
            onClick={() => setFocusedAgentId(agent.id)}
          />
        ))}
      </div>
      <NewAgentModal isOpen={newAgentModalOpen} />
    </div>
  )
}
