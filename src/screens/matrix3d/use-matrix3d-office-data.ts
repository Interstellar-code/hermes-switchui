import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { resolveCrewEffectiveStatus } from './matrix3d-presence-status'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type { StudioGatewayAdapterType } from '@/lib/studio/settings'
import type { CrewStatusAgent, WorkspaceAgentDirectory } from '@/lib/workspace-agents'
import { listCrewStatusAgents, listWorkspaceAgents } from '@/lib/workspace-agents'
import { useAgentView } from '@/hooks/use-agent-view'
import { createDefaultAgentAvatarProfile } from '@/lib/avatars/profile'
import { gatewayStatus as fetchGatewayStatus, getLogs } from '@/lib/hermes-client'

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
  activityScore: number
}

function normalizeText(value: string): string {
  return value.toLowerCase()
}

function tokenizeText(value: string): Array<string> {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function scoreTextOverlap(haystack: string, needles: Array<string>): number {
  if (!haystack || needles.length === 0) return 0
  let score = 0
  for (const needle of needles) {
    if (!needle) continue
    if (haystack.includes(needle)) score += 2
  }
  return score
}

export function scoreLiveMatch(
  rosterAgent: { id: string; displayName?: string; role?: string; name?: string },
  agent: ReturnType<typeof useAgentView>['activeAgents'][number],
): number {
  const id = normalizeText(rosterAgent.id)
  const display = normalizeText(rosterAgent.displayName ?? rosterAgent.name ?? '')
  const role = normalizeText(rosterAgent.role ?? '')
  const key = normalizeText(agent.id)
  const name = normalizeText(agent.name)
  const task = normalizeText(agent.task)
  const model = normalizeText(agent.model)

  let score = 0
  if (id && key === id) score += 100
  if (id && key.includes(id)) score += 40
  if (display && name.includes(display)) score += 18
  if (display && task.includes(display)) score += 24
  if (role && name.includes(role)) score += 10
  if (role && task.includes(role)) score += 30

  const roleTokens = tokenizeText(role)
  const displayTokens = tokenizeText(display)
  const allRosterTokens = [...roleTokens, ...displayTokens]
  score += scoreTextOverlap(task, allRosterTokens) * 3
  score += scoreTextOverlap(name, displayTokens)

  if (model && task.includes(model)) score += 2
  if (model && name.includes(model)) score += 1

  return score
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
  const lead = agent.role || agent.provider
  const parts = [lead || agent.provider, rosterStatus]

  return parts.filter(Boolean).join(' • ')
}

function crewRosterStatus(agent: CrewStatusAgent): Matrix3DAgentPresence['rosterStatus'] {
  if (!agent.profileFound) return 'offline'
  if (agent.processAlive || agent.gatewayState === 'running') return 'online'
  if (agent.assignedTaskCount > 0 || agent.sessionCount > 0) return 'away'
  return 'away'
}

export function inferLiveMatch(
  rosterAgent: CrewStatusAgent,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
): (ReturnType<typeof useAgentView>['activeAgents'][number]) | null {
  const id = normalizeText(rosterAgent.id)
  const display = normalizeText(rosterAgent.displayName)
  const role = normalizeText(rosterAgent.role)
  const shouldMapWorkspaceChatToHermesSwitch = id === 'hermes-switch'
  let bestMatch: (ReturnType<typeof useAgentView>['activeAgents'][number]) | null =
    null
  let bestScore = 0

  for (const agent of activeAgents) {
    const key = normalizeText(agent.id)
    const name = normalizeText(agent.name)
    const task = normalizeText(agent.task)
    const looksLikeWorkspaceChat =
      key === 'main' ||
      key === 'default' ||
      key.startsWith('api-') ||
      name.includes('hermes workspace') ||
      task.includes('hermes workspace') ||
      name.includes('hermes switch ui') ||
      task.includes('hermes switch ui')

    if (shouldMapWorkspaceChatToHermesSwitch) {
      if (looksLikeWorkspaceChat) return agent
    }

    // The active workspace conversation can mention "Neo", "Trinity", or
    // "Morpheus" in the prompt/preview. That is not proof that those crew
    // profiles are running. Only map workspace chat to the Hermes card.
    if (looksLikeWorkspaceChat) continue

    const score = scoreLiveMatch(rosterAgent, agent)
    if (score > bestScore) {
      bestScore = score
      bestMatch = agent
    }
  }

  if (bestScore > 0) return bestMatch
  return null
}

export function inferWorkspaceLiveMatch(
  fallbackAgent: WorkspaceAgentDirectory,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
): (ReturnType<typeof useAgentView>['activeAgents'][number]) | null {
  let bestMatch: (ReturnType<typeof useAgentView>['activeAgents'][number]) | null =
    null
  let bestScore = 0
  for (const agent of activeAgents) {
    const key = normalizeText(agent.id)
    if (key === 'main' || key.includes('main') || key.includes('default')) return agent
    const score = scoreLiveMatch(
      { id: fallbackAgent.id, displayName: fallbackAgent.name, role: fallbackAgent.role },
      agent,
    )
    if (score > bestScore) {
      bestScore = score
      bestMatch = agent
    }
  }
  if (bestScore > 0) return bestMatch
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
    activityScore: 5,
  }
}

function mergePresence(
  crewAgents: Array<CrewStatusAgent>,
  fallbackAgents: Array<WorkspaceAgentDirectory>,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
  activityBoosts: Record<string, number>,
): Array<Matrix3DAgentPresence> {
  if (crewAgents.length > 0) {
    const matchedSessionIds = new Set<string>()
    const merged = crewAgents.map((agent) => {
      const live = inferLiveMatch(agent, activeAgents)
      if (live) matchedSessionIds.add(live.id)

      const rosterStatus = crewRosterStatus(agent)
      const boost = activityBoosts[agent.id] ?? 0
      const effectiveStatus = resolveCrewEffectiveStatus({
        liveStatus: live?.status ?? null,
        rosterStatus,
        activityBoost: boost,
        processAlive: agent.processAlive,
        gatewayState: agent.gatewayState,
        assignedTaskCount: agent.assignedTaskCount,
      })

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
        activityScore: boost,
      } satisfies Matrix3DAgentPresence
    })

    const unmatched = activeAgents
      .filter((agent) => !matchedSessionIds.has(agent.id))
      .map(toLivePresence)

    return [...merged, ...unmatched]
  }

  // When roster/crew are empty but live active agents exist (the common case
  // for a single Hermes chat session without a crew roster), inject each
  // unmatched active agent directly as a live-unmatched presence entry.
  if (fallbackAgents.length === 0 && activeAgents.length > 0) {
    return activeAgents.map(toLivePresence)
  }

  const matchedSessionIds = new Set<string>()
  const rosterPresence = fallbackAgents.map((agent) => {
    const live = inferWorkspaceLiveMatch(agent, activeAgents)
    if (live) matchedSessionIds.add(live.id)
    const isDefaultWorkspace = agent.id === 'default' || agent.id === 'workspace'
    const effectiveStatus = live
      ? toLiveOfficeStatus(live.status)
      : agent.status === 'offline'
        ? 'error'
        : 'idle'
    return {
      id: agent.id,
    name: agent.name,
    role: agent.role,
    model: agent.model ?? (isDefaultWorkspace ? 'auto' : 'unknown'),
    provider: agent.provider,
    source: 'workspace',
    rosterStatus: live ? 'online' : agent.status,
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
        : buildRosterOfficeSubtitle(agent, agent.status),
      sessionCount: live ? 1 : 0,
      assignedTaskCount: 0,
      activeSessionKey: live?.id ?? null,
      activityScore: live ? 5 : 0,
    }
  })

  // Add unmatched live agents that didn't correspond to any roster entry
  const unmatched = activeAgents
    .filter((agent) => !matchedSessionIds.has(agent.id))
    .map(toLivePresence)

  return [...rosterPresence, ...unmatched]
}


type CrewActivitySnapshot = {
  totalTokens: number
  toolCallCount: number
  messageCount: number
  sessionCount: number
  lastSessionAt: number | null
  assignedTaskCount: number
}

function snapshotCrewActivity(agent: CrewStatusAgent): CrewActivitySnapshot {
  return {
    totalTokens: agent.totalTokens,
    toolCallCount: agent.toolCallCount,
    messageCount: agent.messageCount,
    sessionCount: agent.sessionCount,
    lastSessionAt: agent.lastSessionAt,
    assignedTaskCount: agent.assignedTaskCount,
  }
}

function parseLogText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const rec = raw as Record<string, unknown>
  const lines = Array.isArray(rec.lines)
    ? rec.lines.filter((x): x is string => typeof x === 'string')
    : []
  return lines.join('\n').toLowerCase()
}

function computeActivityScore(
  agent: CrewStatusAgent,
  previous: CrewActivitySnapshot | undefined,
  logText: string,
  nowMs: number,
): number {
  let score = 0
  const current = snapshotCrewActivity(agent)
  if (previous) {
    if (current.totalTokens > previous.totalTokens) score += 3
    if (current.toolCallCount > previous.toolCallCount) score += 3
    if (current.messageCount > previous.messageCount) score += 2
    if (current.sessionCount > previous.sessionCount) score += 2
    if ((current.lastSessionAt ?? 0) > (previous.lastSessionAt ?? 0)) score += 2
    if (current.assignedTaskCount > previous.assignedTaskCount) score += 1
  }

  const recentSessionAge = current.lastSessionAt ? nowMs - current.lastSessionAt * 1000 : Number.POSITIVE_INFINITY
  if (recentSessionAge < 120_000) score += 2
  if (current.assignedTaskCount > 0) score += 1

  const id = agent.id.toLowerCase()
  const display = agent.displayName.toLowerCase()
  if (logText.includes(`[${id}]`) || logText.includes(` ${id} `) || logText.includes(display)) score += 1
  if (logText.includes(`delegate to ${display}`) || logText.includes(`delegated to ${display}`)) score += 3
  if (logText.includes(`handover to ${display}`) || logText.includes(`assign ${display}`)) score += 2

  return score
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

function shouldShowMatrix3DAgent(presence: Matrix3DAgentPresence): boolean {
  return presence.id !== 'workspace'
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

  const logsQuery = useQuery({
    queryKey: ['matrix3d', 'presence-logs'],
    queryFn: () => getLogs({ lines: 200, file: 'agent' }),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  })

  const gatewayLogsQuery = useQuery({
    queryKey: ['matrix3d', 'presence-gateway-logs'],
    queryFn: () => getLogs({ lines: 200, file: 'gateway' }),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  })

  const previousCrewRef = useRef<Record<string, CrewActivitySnapshot>>({})
  const [activityBoosts, setActivityBoosts] = useState<Record<string, number>>({})

  const crewAgents = crewStatusQuery.data ?? []
  const rosterAgents = workspaceAgentsQuery.data ?? []
  const hasLiveAgents = agentView.activeAgents.length > 0
  const hasRosterAgents = crewAgents.length > 0 || rosterAgents.length > 0
  const hasHermesData = hasLiveAgents || hasRosterAgents

  useEffect(() => {
    if (crewAgents.length === 0) return
    const logText = `${parseLogText(logsQuery.data)}
${parseLogText(gatewayLogsQuery.data)}`
    const nowMs = Date.now()
    const nextSnapshots: Record<string, CrewActivitySnapshot> = {}
    const nextBoosts: Record<string, number> = {}

    for (const agent of crewAgents) {
      const previous = previousCrewRef.current[agent.id]
      const snapshot = snapshotCrewActivity(agent)
      nextSnapshots[agent.id] = snapshot
      const score = computeActivityScore(agent, previous, logText, nowMs)
      if (score > 0) nextBoosts[agent.id] = score
    }

    previousCrewRef.current = nextSnapshots
    setActivityBoosts(nextBoosts)
  }, [crewAgents, gatewayLogsQuery.data, logsQuery.data])

  const presence = useMemo(
    () =>
      mergePresence(crewAgents, rosterAgents, agentView.activeAgents, activityBoosts).filter(
        shouldShowMatrix3DAgent,
      ),
    [activityBoosts, agentView.activeAgents, crewAgents, rosterAgents],
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
