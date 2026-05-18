import { useEffect } from 'react'
import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { useOperationsAgent, useOperationsAgents } from './use-operations-queries'
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

  const { data: focusData, isLoading } = useOperationsAgent(focusedAgentId)

  if (!focusData) {
    return (
      <section className="ops-focus">
        <div className="ops-focus-empty">
          {isLoading
            ? 'Loading agent…'
            : agents && agents.length === 0
              ? 'Gateway offline · no live agents'
              : 'Select an agent to view detail'}
        </div>
      </section>
    )
  }

  return (
    <section className="ops-focus">
      <FocusHero data={focusData} />
      <div className="focus-grid">
        <FocusMission mission={focusData.mission} />
        <FocusActivity items={focusData.activity} />
        <FocusTools tools={focusData.tools} />
        <FocusRecentOutputs outputs={focusData.outputs} />
      </div>
    </section>
  )
}
