import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type { StudioGatewayAdapterType } from '@/lib/studio/settings'
import type { WorkspaceAgentDirectory } from '@/lib/workspace-agents'
import { useAgentView } from '@/hooks/use-agent-view'
import { createDefaultAgentAvatarProfile } from '@/lib/avatars/profile'
import { gatewayStatus as fetchGatewayStatus } from '@/lib/hermes-client'
import { listWorkspaceAgents } from '@/lib/workspace-agents'

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

type AgentLike = {
  id: string
  name: string
  task: string
  model: string
  status: string
}

function normalizeText(value: string): string {
  return value.toLowerCase()
}

function toLiveOfficeStatus(status: string): OfficeAgent['status'] {
  if (status === 'running' || status === 'thinking' || status === 'online') return 'working'
  if (status === 'paused' || status === 'idle' || status === 'away') return 'idle'
  return 'error'
}

function toRosterOfficeStatus(status: WorkspaceAgentDirectory['status']): OfficeAgent['status'] {
  if (status === 'offline') return 'error'
  return 'idle'
}

function toOfficeColor(agent: AgentLike): string {
  const text = normalizeText(`${agent.name} ${agent.task} ${agent.model}`)
  if (text.includes('qa') || text.includes('test')) return '#fbbf24'
  if (text.includes('research') || text.includes('analyst')) return '#38bdf8'
  if (agent.status === 'failed' || agent.status === 'offline') return '#f87171'
  if (text.includes('build') || text.includes('code') || text.includes('dev')) return '#a78bfa'
  return '#34d399'
}

function toOfficeItem(agent: AgentLike): OfficeAgent['item'] {
  const text = normalizeText(`${agent.name} ${agent.task} ${agent.model}`)
  if (text.includes('qa') || text.includes('test')) return 'shield'
  if (text.includes('research') || text.includes('analyst')) return 'globe'
  if (text.includes('build') || text.includes('code') || text.includes('dev')) return 'palette'
  return 'laptop'
}

function toLiveOfficeAgent(agent: AgentLike): OfficeAgent {
  return {
    id: agent.id,
    name: agent.name,
    subtitle: [agent.task, agent.model].filter(Boolean).join(' • '),
    status: toLiveOfficeStatus(agent.status),
    color: toOfficeColor(agent),
    item: toOfficeItem(agent),
    avatarProfile: createDefaultAgentAvatarProfile(agent.id),
  }
}

function toRosterOfficeAgent(agent: WorkspaceAgentDirectory): OfficeAgent {
  const mapped: AgentLike = {
    id: agent.id,
    name: agent.name,
    task: agent.role || agent.description,
    model: agent.model ?? agent.provider,
    status: agent.status,
  }

  return {
    id: agent.id,
    name: agent.name,
    subtitle: [agent.role, agent.model ?? agent.provider, agent.status]
      .filter(Boolean)
      .join(' • '),
    status: toRosterOfficeStatus(agent.status),
    color: toOfficeColor(mapped),
    item: toOfficeItem(mapped),
    avatarProfile: createDefaultAgentAvatarProfile(agent.id),
  }
}

function formatGatewayStatus(status: { status?: string; gateway_running?: boolean } | undefined, hasHermesData: boolean): string {
  if (status?.gateway_running === true) return 'connected'
  if (status?.gateway_running === false) return 'disconnected'
  if (typeof status?.status === 'string' && status.status.trim()) return status.status.trim().toLowerCase()
  return hasHermesData ? 'connected' : 'demo'
}

function pickAdapterType(
  hasLiveAgents: boolean,
  rosterAgents: Array<WorkspaceAgentDirectory>,
): StudioGatewayAdapterType {
  if (hasLiveAgents) return 'openclaw'
  return rosterAgents[0]?.adapter_type ?? 'demo'
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

  const workspaceAgentsQuery = useQuery({
    queryKey: ['matrix3d', 'workspace-agents'],
    queryFn: listWorkspaceAgents,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })

  const gatewayStatusQuery = useQuery({
    queryKey: ['matrix3d', 'gateway-status'],
    queryFn: fetchGatewayStatus,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: false,
  })

  const rosterAgents = workspaceAgentsQuery.data ?? []
  const hasLiveAgents = agentView.activeAgents.length > 0
  const hasRosterAgents = rosterAgents.length > 0
  const hasHermesData = hasLiveAgents || hasRosterAgents

  const agents = useMemo(() => {
    if (hasLiveAgents) {
      return agentView.activeAgents.map((agent) =>
        toLiveOfficeAgent({
          id: agent.id,
          name: agent.name,
          task: agent.task,
          model: agent.model,
          status: agent.status,
        }),
      )
    }

    if (hasRosterAgents) return rosterAgents.map(toRosterOfficeAgent)

    return DEMO_AGENTS
  }, [agentView.activeAgents, hasLiveAgents, hasRosterAgents, rosterAgents])

  const selectedAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents, rosterAgents),
    [hasLiveAgents, rosterAgents],
  )

  const activeAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents, rosterAgents),
    [hasLiveAgents, rosterAgents],
  )

  return {
    agents,
    readOnly: true,
    storageNamespace: hasHermesData ? 'matrix3d-hermes' : 'matrix3d-demo',
    layoutPreset: 'office',
    officeTitle: 'Matrix3D Office',
    officeTitleLoaded: true,
    gatewayStatus: formatGatewayStatus(gatewayStatusQuery.data, hasHermesData),
    selectedAdapterType,
    activeAdapterType,
  }
}
