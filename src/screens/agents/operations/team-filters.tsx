import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import type { Agent } from './use-operations-queries'
import type { TeamFilter } from '../../../stores/operations-ui-store'

const TABS: Array<{ key: TeamFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'idle', label: 'Idle' },
  { key: 'issues', label: 'Issues' },
]

function countFor(key: TeamFilter, agents: Array<Agent>): number {
  if (key === 'all') return agents.length
  if (key === 'live') return agents.filter((a) => a.status === 'live').length
  if (key === 'idle') return agents.filter((a) => a.status === 'idle').length
  return agents.filter((a) => a.status === 'blocked' || a.status === 'error').length
}

interface TeamFiltersProps {
  agents: Array<Agent>
}

export function TeamFilters({ agents }: TeamFiltersProps) {
  const teamFilter = useOperationsUIStore((s) => s.teamFilter)
  const setTeamFilter = useOperationsUIStore((s) => s.setTeamFilter)

  return (
    <div className="team-filters">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={teamFilter === key ? 'on' : ''}
          onClick={() => setTeamFilter(key)}
        >
          {label} · {countFor(key, agents)}
        </button>
      ))}
    </div>
  )
}
