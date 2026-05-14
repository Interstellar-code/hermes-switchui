import { useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type { StudioGatewayAdapterType } from '@/lib/studio/settings'
import type { CrewStatusAgent, WorkspaceAgentDirectory } from '@/lib/workspace-agents'
import { listCrewStatusAgents, listWorkspaceAgents } from '@/lib/workspace-agents'
import { useAgentView } from '@/hooks/use-agent-view'
import { createDefaultAgentAvatarProfile } from '@/lib/avatars/profile'
import { gatewayStatus as fetchGatewayStatus } from '@/lib/hermes-client'

type AgentLike = {
  id: string
  name: string
  task: string
  model: string
  status: string
}

export type Matrix3DAgentPresence = {
  id: string
  name: string
  role: string
  model: string
  provider: string
  source: 'crew' | 'live-unmatched' | 'workspace'
  rosterStatus: 'online' | 'away' | 'offline' | 'unknown'
  effectiveStatus: OfficeAgent['status']
  lastActivity: string | null
  sessionCount: number
  assignedTaskCount: number
  activeSessionKey: string | null
}

function normalizeText(value: string): string {
  return value.toLowerCase()
}

function toLiveOfficeStatus(status: string): OfficeAgent['status'] {
  if (status === 'running' || status === 'thinking' || status === 'online')
    return 'working'
  if (status === 'paused' || status === 'idle' || status === 'away')
    return 'idle'
  return 'error'
}

function toOfficeColor(agent: AgentLike): string {
  const text = normalizeText(`${agent.name} ${agent.task} ${agent.model}`)
  if (text.includes('qa') || text.includes('test')) return '#fbbf24'
  if (text.includes('research') || text.includes('analyst')) return '#38bdf8'
  if (agent.status === 'failed' || agent.status === 'offline') return '#f87171'
  if (text.includes('build') || text.includes('code') || text.includes('dev'))
    return '#a78bfa'
  return '#34d399'
}

function toOfficeItem(agent: AgentLike): OfficeAgent['item'] {
  const text = normalizeText(`${agent.name} ${agent.task} ${agent.model}`)
  if (text.includes('qa') || text.includes('test')) return 'shield'
  if (text.includes('research') || text.includes('analyst')) return 'globe'
  if (text.includes('build') || text.includes('code') || text.includes('dev'))
    return 'palette'
  return 'laptop'
}

function formatProgress(progress: number | undefined): string | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return null
  return `${Math.round(progress)}%`
}

function buildLiveOfficeSubtitle(
  agent: AgentLike & { progress?: number },
): string {
  const parts = [agent.model, agent.status, formatProgress(agent.progress)]

  return parts.filter(Boolean).join(' • ')
}

function buildRosterOfficeSubtitle(
  agent: CrewStatusAgent | WorkspaceAgentDirectory,
  rosterStatus: string,
): string {
  const lead = 'role' in agent ? agent.role : agent.provider
  const parts = [lead || agent.provider, rosterStatus]

  return parts.filter(Boolean).join(' • ')
}

function crewRosterStatus(agent: CrewStatusAgent): Matrix3DAgentPresence['rosterStatus'] {
  if (!agent.profileFound) return 'offline'
  if (agent.processAlive || agent.gatewayState === 'running') return 'online'
  if (agent.assignedTaskCount > 0 || agent.sessionCount > 0) return 'away'
  return 'away'
}

function inferLiveMatch(
  rosterAgent: CrewStatusAgent,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
): (ReturnType<typeof useAgentView>['activeAgents'][number]) | null {
  const id = normalizeText(rosterAgent.id)
  const display = normalizeText(rosterAgent.displayName)

  for (const agent of activeAgents) {
    const key = normalizeText(agent.id)
    const name = normalizeText(agent.name)
    const task = normalizeText(agent.task)

    if (key === id || key.includes(id)) return agent
    if (display && (name.includes(display) || task.includes(display))) return agent
  }

  return null
}

function toOfficeAgent(
  presence: Matrix3DAgentPresence,
): OfficeAgent {
  const mapped: AgentLike = {
    id: presence.id,
    name: presence.name,
    task: presence.role,
    model: presence.model,
    status: presence.effectiveStatus,
  }

  return {
    id: presence.id,
    name: presence.name,
    subtitle: presence.lastActivity || `${presence.role} • ${presence.rosterStatus}`,
    status: presence.effectiveStatus,
    color: toOfficeColor(mapped),
    item: toOfficeItem(mapped),
    avatarProfile: createDefaultAgentAvatarProfile(presence.id),
  }
}

function toLivePresence(
  agent: ReturnType<typeof useAgentView>['activeAgents'][number],
): Matrix3DAgentPresence {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.task,
    model: agent.model,
    provider: 'Hermes',
    source: 'live-unmatched',
    rosterStatus: 'unknown',
    effectiveStatus: toLiveOfficeStatus(agent.status),
    lastActivity: buildLiveOfficeSubtitle({
      id: agent.id,
      name: agent.name,
      task: agent.task,
      model: agent.model,
      status: agent.status,
      progress: agent.progress,
    }),
    sessionCount: 0,
    assignedTaskCount: 0,
    activeSessionKey: agent.id,
  }
}

function mergePresence(
  crewAgents: Array<CrewStatusAgent>,
  fallbackAgents: Array<WorkspaceAgentDirectory>,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
): Array<Matrix3DAgentPresence> {
  if (crewAgents.length > 0) {
    const matchedSessionIds = new Set<string>()
    const merged = crewAgents.map((agent) => {
      const live = inferLiveMatch(agent, activeAgents)
      if (live) matchedSessionIds.add(live.id)

      const rosterStatus = crewRosterStatus(agent)
      const effectiveStatus = live
        ? toLiveOfficeStatus(live.status)
        : rosterStatus === 'offline'
          ? 'error'
          : 'idle'

      return {
        id: agent.id,
        name: agent.displayName,
        role: agent.role,
        model: agent.model,
        provider: agent.provider,
        source: 'crew',
        rosterStatus,
        effectiveStatus,
        lastActivity: live
          ? buildLiveOfficeSubtitle({
              id: live.id,
              name: live.name,
              task: live.task,
              model: live.model,
              status: live.status,
              progress: live.progress,
            })
          : agent.lastSessionTitle ||
            buildRosterOfficeSubtitle(agent, rosterStatus),
        sessionCount: agent.sessionCount,
        assignedTaskCount: agent.assignedTaskCount,
        activeSessionKey: live?.id ?? null,
      } satisfies Matrix3DAgentPresence
    })

    const unmatched = activeAgents
      .filter((agent) => !matchedSessionIds.has(agent.id))
      .map(toLivePresence)

    return [...merged, ...unmatched]
  }

  return fallbackAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    model: agent.model ?? 'unknown',
    provider: agent.provider,
    source: 'workspace',
    rosterStatus: agent.status,
    effectiveStatus: agent.status === 'offline' ? 'error' : 'idle',
    lastActivity: buildRosterOfficeSubtitle(agent, agent.status),
    sessionCount: 0,
    assignedTaskCount: 0,
    activeSessionKey: null,
  }))
}

function formatGatewayStatus(
  status: { status?: string; gateway_running?: boolean } | undefined,
  hasHermesData: boolean,
): string {
  if (status?.gateway_running === true) return 'connected'
  if (status?.gateway_running === false) return 'disconnected'
  if (typeof status?.status === 'string' && status.status.trim())
    return status.status.trim().toLowerCase()
  return hasHermesData ? 'connected' : 'local'
}

function pickAdapterType(
  hasLiveAgents: boolean,
  rosterAgents: Array<WorkspaceAgentDirectory>,
): StudioGatewayAdapterType {
  if (hasLiveAgents) return 'openclaw'
  return rosterAgents[0]?.adapter_type ?? 'local'
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
  agentSource: 'live' | 'roster' | 'none'
  presence: Array<Matrix3DAgentPresence>
  onAgentChatSelect: (agentId: string) => void
}

export function useMatrix3DOfficeData(): Matrix3DOfficeData {
  const navigate = useNavigate()
  const agentView = useAgentView()

  const crewStatusQuery = useQuery({
    queryKey: ['matrix3d', 'crew-status'],
    queryFn: listCrewStatusAgents,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })

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

  const crewAgents = crewStatusQuery.data ?? []
  const rosterAgents = workspaceAgentsQuery.data ?? []
  const hasLiveAgents = agentView.activeAgents.length > 0
  const hasRosterAgents = crewAgents.length > 0 || rosterAgents.length > 0
  const hasHermesData = hasLiveAgents || hasRosterAgents

  const presence = useMemo(
    () => mergePresence(crewAgents, rosterAgents, agentView.activeAgents),
    [agentView.activeAgents, crewAgents, rosterAgents],
  )

  const agents = useMemo(
    () => presence.map(toOfficeAgent),
    [presence],
  )

  const selectedAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents, rosterAgents),
    [hasLiveAgents, rosterAgents],
  )

  const activeAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents, rosterAgents),
    [hasLiveAgents, rosterAgents],
  )

  const liveSessionIds = useMemo(
    () => new Set(agentView.activeAgents.map((agent) => agent.id)),
    [agentView.activeAgents],
  )

  const handleAgentChatSelect = useCallback(
    (agentId: string) => {
      if (!liveSessionIds.has(agentId)) return

      void navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: agentId },
      })
    },
    [liveSessionIds, navigate],
  )

  return {
    agents,
    readOnly: true,
    storageNamespace: 'matrix3d-hermes',
    layoutPreset: 'office',
    officeTitle: 'Matrix3D Office',
    officeTitleLoaded: true,
    gatewayStatus: formatGatewayStatus(gatewayStatusQuery.data, hasHermesData),
    selectedAdapterType,
    activeAdapterType,
    agentSource: hasLiveAgents ? 'live' : hasRosterAgents ? 'roster' : 'none',
    presence,
    onAgentChatSelect: handleAgentChatSelect,
  }
}
