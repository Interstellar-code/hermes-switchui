import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type { StudioGatewayAdapterType } from '@/lib/studio/settings'
import { useAgentView } from '@/hooks/use-agent-view'
import { createDefaultAgentAvatarProfile } from '@/lib/avatars/profile'
import { gatewayStatus as fetchGatewayStatus } from '@/lib/hermes-client'

const DEMO_AGENTS: Array<OfficeAgent> = [
  {
    id: 'main',
    name: 'Claude',
    subtitle: 'Claw3D Demo',
    status: 'working',
    color: '#34d399',
    item: 'laptop',
    avatarProfile: createDefaultAgentAvatarProfile('main'),
  },
  {
    id: 'research',
    name: 'Luna',
    subtitle: 'Research Analyst',
    status: 'idle',
    color: '#38bdf8',
    item: 'globe',
    avatarProfile: createDefaultAgentAvatarProfile('research'),
  },
  {
    id: 'builder',
    name: 'Roger',
    subtitle: 'Frontend Developer',
    status: 'working',
    color: '#a78bfa',
    item: 'palette',
    avatarProfile: createDefaultAgentAvatarProfile('builder'),
  },
  {
    id: 'qa',
    name: 'Ada',
    subtitle: 'QA Engineer',
    status: 'idle',
    color: '#fbbf24',
    item: 'shield',
    avatarProfile: createDefaultAgentAvatarProfile('qa'),
  },
]

function toOfficeStatus(status: string): OfficeAgent['status'] {
  if (status === 'running' || status === 'thinking' || status === 'online') return 'working'
  if (status === 'paused' || status === 'idle' || status === 'away') return 'idle'
  return 'error'
}

function toOfficeColor(agent: { status: string; model: string; task: string; name: string }): string {
  const text = `${agent.name} ${agent.task} ${agent.model}`.toLowerCase()
  if (text.includes('qa') || text.includes('test')) return '#fbbf24'
  if (text.includes('research') || text.includes('analyst')) return '#38bdf8'
  if (agent.status === 'failed' || agent.status === 'offline') return '#f87171'
  if (text.includes('build') || text.includes('code') || text.includes('dev')) return '#a78bfa'
  return '#34d399'
}

function toOfficeItem(agent: { status: string; model: string; task: string; name: string }): OfficeAgent['item'] {
  const text = `${agent.name} ${agent.task} ${agent.model}`.toLowerCase()
  if (text.includes('qa') || text.includes('test')) return 'shield'
  if (text.includes('research') || text.includes('analyst')) return 'globe'
  if (text.includes('build') || text.includes('code') || text.includes('dev')) return 'palette'
  return 'laptop'
}

function toOfficeAgent(agent: { id: string; name: string; task: string; model: string; status: string }): OfficeAgent {
  return {
    id: agent.id,
    name: agent.name,
    subtitle: [agent.task, agent.model].filter(Boolean).join(' • '),
    status: toOfficeStatus(agent.status),
    color: toOfficeColor(agent),
    item: toOfficeItem(agent),
    avatarProfile: createDefaultAgentAvatarProfile(agent.id),
  }
}

function formatGatewayStatus(status: { status?: string; gateway_running?: boolean } | undefined, hasLiveAgents: boolean): string {
  if (status?.gateway_running === true) return 'connected'
  if (status?.gateway_running === false) return 'disconnected'
  if (typeof status?.status === 'string' && status.status.trim()) return status.status.trim().toLowerCase()
  return hasLiveAgents ? 'connected' : 'demo'
}

function pickAdapterType(hasLiveAgents: boolean): StudioGatewayAdapterType {
  return hasLiveAgents ? 'openclaw' : 'demo'
}

export type Matrix3DOfficeData = {
  agents: Array<OfficeAgent>
  readOnly: true
  storageNamespace: string
  layoutPreset: 'office'
  officeTitle: string
  officeTitleLoaded: true
  gatewayStatus: string
  selectedAdapterType: StudioGatewayAdapterType
  activeAdapterType: StudioGatewayAdapterType
}

export function useMatrix3DOfficeData(): Matrix3DOfficeData {
  const agentView = useAgentView()

  const gatewayStatusQuery = useQuery({
    queryKey: ['matrix3d', 'gateway-status'],
    queryFn: fetchGatewayStatus,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  })

  const hasLiveAgents = agentView.activeAgents.length > 0

  const agents = useMemo(
    () =>
      hasLiveAgents
        ? agentView.activeAgents.map((agent) =>
            toOfficeAgent({
              id: agent.id,
              name: agent.name,
              task: agent.task,
              model: agent.model,
              status: agent.status,
            }),
          )
        : DEMO_AGENTS,
    [agentView.activeAgents, hasLiveAgents],
  )

  const selectedAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents),
    [hasLiveAgents],
  )

  const activeAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents),
    [hasLiveAgents],
  )

  return {
    agents,
    readOnly: true,
    storageNamespace: hasLiveAgents ? 'matrix3d-live' : 'matrix3d-demo',
    layoutPreset: 'office',
    officeTitle: 'Matrix3D Office',
    officeTitleLoaded: true,
    gatewayStatus: formatGatewayStatus(gatewayStatusQuery.data, hasLiveAgents),
    selectedAdapterType,
    activeAdapterType,
  }
}
