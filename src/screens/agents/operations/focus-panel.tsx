import { useEffect } from 'react'
import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { useOperationsAgent, useOperationsAgents } from './use-operations-queries'
import { FOCUS_DATA } from './mock-data'
import { FocusHero } from './focus-hero'
import { FocusMission } from './focus-mission'
import { FocusActivity } from './focus-activity'
import { FocusTools } from './focus-tools'
import { FocusRecentOutputs } from './focus-recent-outputs'

export function FocusPanel() {
  const focusedAgentId = useOperationsUIStore((s) => s.focusedAgentId)
  const setFocusedAgentId = useOperationsUIStore((s) => s.setFocusedAgentId)

  const { data: agents } = useOperationsAgents()

  // Fall back to first agent when no agent is focused
  useEffect(() => {
    if (!focusedAgentId && agents && agents.length > 0) {
      setFocusedAgentId(agents[0].id)
    }
  }, [focusedAgentId, agents, setFocusedAgentId])

  const { data: focusData } = useOperationsAgent(focusedAgentId)

  // Use queried data if available, else fall back to static mock for initial render
  const data = focusData ?? FOCUS_DATA

  return (
    <section className="ops-focus">
      <FocusHero data={data} />
      <div className="focus-grid">
        <FocusMission mission={data.mission} />
        <FocusActivity items={data.activity} />
        <FocusTools tools={data.tools} />
        <FocusRecentOutputs outputs={data.outputs} />
      </div>
    </section>
  )
}
