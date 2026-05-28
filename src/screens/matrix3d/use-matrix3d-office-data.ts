import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { resolveCrewEffectiveStatus } from './matrix3d-presence-status'
import { useMatrix3DStore } from './matrix3d-store'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type {
  OfficeAnimationState,
  OfficeIdleLeisureArea,
} from '@/lib/office/eventTriggers'
import type { StudioGatewayAdapterType } from '@/lib/studio/settings'
import type {
  CrewStatusAgent,
  WorkspaceAgentDirectory,
} from '@/lib/workspace-agents'
import type { StreamingState } from '@/stores/chat-store'
import {
  listCrewStatusAgents,
  listWorkspaceAgents,
} from '@/lib/workspace-agents'
import { useAgentView } from '@/hooks/use-agent-view'
import { createDefaultAgentAvatarProfile } from '@/lib/avatars/profile'
import {
  gatewayStatus as fetchGatewayStatus,
  getLogs,
} from '@/lib/hermes-client'
import { useChatStore } from '@/stores/chat-store'

/**
 * Per-profile live activity, sourced deterministically from the gateway
 * dashboard's `/api/sessions?profile=<name>` endpoint (added upstream in
 * hermes-agent: each session now carries a `profile` field and the endpoint
 * can be scoped to a specific profile's state.db). A configured Tier1/Tier2
 * profile is "working" when ANY of its sessions reports `is_active` (the
 * dashboard computes this as ended_at IS NULL && last_active < 300s).
 *
 * This replaces the fragile log-keyword + token-delta heuristic for crew
 * agents: the join is now profile-id ↔ crew-id, not name fuzzing.
 */
export type Matrix3DProfileActivity = {
  active: boolean
  title: string | null
  sessionKey: string | null
  lastActiveMs: number | null
}

// crew-status ids vs profile dir names differ only for the default profile:
// crew calls it "workspace", the gateway profile dir is "default".
const CREW_ID_TO_PROFILE_NAME: Record<string, string> = { workspace: 'default' }
const IDLE_LEISURE_AREAS: Array<OfficeIdleLeisureArea> = [
  'pingpong',
  'sofa',
  'gym',
  'recreation',
]
const AGENT_IDENTITY_COLORS = ['#00ff41', '#a78bfa', '#38bdf8', '#f59e0b']
const NAMED_AGENT_IDENTITY_COLORS: Record<string, string> = {
  'hermes-switch': '#00ff41',
  hermes: '#00ff41',
  morpheus: '#a78bfa',
  neo: '#38bdf8',
  trinity: '#f59e0b',
}

export function profileNameForCrewId(crewId: string): string {
  return CREW_ID_TO_PROFILE_NAME[crewId] ?? crewId
}

function stableHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function idleLeisureAreaForAgent(
  agentId: string,
  rotationBucket: number,
  agentIndex = stableHash(agentId),
): OfficeIdleLeisureArea {
  return IDLE_LEISURE_AREAS[
    (agentIndex + rotationBucket) % IDLE_LEISURE_AREAS.length
  ]
}

async function fetchSessionsForProfile(
  profileName: string,
): Promise<Matrix3DProfileActivity> {
  const empty: Matrix3DProfileActivity = {
    active: false,
    title: null,
    sessionKey: null,
    lastActiveMs: null,
  }
  try {
    const res = await fetch(
      `/api/dashboard-proxy/api/sessions?profile=${encodeURIComponent(
        profileName,
      )}&limit=25`,
    )
    if (!res.ok) return empty
    const data = (await res.json()) as {
      sessions?: Array<Record<string, unknown>>
    }
    const sessions = Array.isArray(data.sessions) ? data.sessions : []
    const live = sessions.find((s) => s.is_active === true)
    if (!live) return empty
    const lastActive =
      typeof live.last_active === 'number' ? live.last_active * 1000 : null
    return {
      active: true,
      title:
        (typeof live.title === 'string' && live.title) ||
        (typeof live.preview === 'string' && live.preview) ||
        null,
      sessionKey: typeof live.id === 'string' ? live.id : null,
      lastActiveMs: lastActive,
    }
  } catch {
    return empty
  }
}

export async function fetchProfileActivity(
  crewIds: Array<string>,
): Promise<Record<string, Matrix3DProfileActivity>> {
  const out: Record<string, Matrix3DProfileActivity> = {}
  await Promise.all(
    crewIds.map(async (crewId) => {
      out[crewId] = await fetchSessionsForProfile(profileNameForCrewId(crewId))
    }),
  )
  return out
}

/**
 * Rooms an agent figure can be routed to in the 3D office. `desk` is the
 * default fallback for "working but no specific signal".
 */
type Matrix3DRoom = 'desk' | 'github' | 'qa' | 'phone' | 'sms' | 'server'

/**
 * Infer which room an agent should be animated in based on its most recent
 * tool / skill activity. This intentionally ignores the agent's `lastActivity`
 * subtitle string — that field is a status summary ("auto • running • 35%"),
 * NOT a description of what the agent is doing, so keyword-matching against it
 * was forcing users to phrase prompts with literal room names ("go to the
 * gym") which is absurd UX.
 *
 * Signals (priority order):
 *   1. Most recent in-flight or recently-completed tool call in StreamingState
 *      for this agent's session — name pattern routes to a specific room.
 *   2. `skill.loaded` events (StreamingState toolCalls with phase 'skill.loaded')
 *      → desk (research / context loading).
 *   3. Working but no tool signal → desk (default).
 *
 * Rest rooms (gym, jukebox) are NOT auto-routed: they should fire only via
 * explicit intentional signals, not heuristics, otherwise figures wander
 * during normal work.
 */
function inferActiveRoom(streaming: StreamingState | undefined): {
  room: Matrix3DRoom
  signal: string
} {
  if (!streaming || streaming.toolCalls.length === 0) {
    return { room: 'desk', signal: 'no-tool-calls' }
  }

  // Find the most recent tool call (highest firstSeenAt). Prefer non-error
  // entries — an errored tool that completed 10s ago shouldn't pin the figure.
  const sorted = [...streaming.toolCalls].sort(
    (a, b) => (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0),
  )
  const recent = sorted.find((tc) => tc.phase !== 'error') ?? sorted[0]
  const name = recent.name.toLowerCase()

  // GitHub family (GitHub MCP tools, gh CLI, etc.)
  if (
    name.includes('github') ||
    name.startsWith('gh_') ||
    name.startsWith('mcp_github') ||
    name.includes('pull_request') ||
    name.includes('issue')
  ) {
    return { room: 'github', signal: `tool:${recent.name}` }
  }

  // Shell / terminal / exec → server room (where the racks live)
  if (
    name.includes('terminal') ||
    name === 'bash' ||
    name === 'shell' ||
    name.includes('exec') ||
    name.includes('run_command')
  ) {
    return { room: 'server', signal: `tool:${recent.name}` }
  }

  // Phone-style call tooling
  if (
    name.startsWith('phone_') ||
    name.includes('call_tool') ||
    name.includes('voice_')
  ) {
    return { room: 'phone', signal: `tool:${recent.name}` }
  }

  // SMS / text send
  if (
    name.startsWith('sms_') ||
    name.includes('text_send') ||
    name.includes('twilio')
  ) {
    return { room: 'sms', signal: `tool:${recent.name}` }
  }

  // QA / test runs
  if (
    name.includes('test') ||
    name.includes('vitest') ||
    name.includes('pytest') ||
    name.includes('lint') ||
    name.includes('typecheck')
  ) {
    return { room: 'qa', signal: `tool:${recent.name}` }
  }

  // Everything else (web_search, browser, gmail/mcp_gmail, vision_analyze,
  // load_mcp_server, view_skill / load_skill / skill.loaded, delegate_task,
  // spawn_agent, file edits, read, glob, grep, etc.) → desk.
  return { room: 'desk', signal: `tool:${recent.name}` }
}

const ACTIVE_BUBBLE_MAX_LENGTH = 96

function compactBubbleText(value: string): string {
  const normalized = value
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= ACTIVE_BUBBLE_MAX_LENGTH) return normalized
  return `${normalized.slice(0, ACTIVE_BUBBLE_MAX_LENGTH - 1).trimEnd()}…`
}

function readableToolName(name: string): string {
  return name
    .replace(/^mcp[_:-]/i, '')
    .replace(/[_:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizeUnknown(value: unknown): string | null {
  if (typeof value === 'string') return compactBubbleText(value)
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  for (const key of ['command', 'cmd', 'query', 'q', 'path', 'file', 'url']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return compactBubbleText(candidate)
    }
  }
  return null
}

function latestStreamingTool(
  streaming: StreamingState | undefined,
): StreamingState['toolCalls'][number] | null {
  if (!streaming || streaming.toolCalls.length === 0) return null
  return [...streaming.toolCalls].sort(
    (a, b) => (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0),
  )[0]
}

function toolActionPhrase(
  tool: StreamingState['toolCalls'][number],
): string {
  const name = readableToolName(tool.name)
  const detail =
    summarizeUnknown(tool.preview) ??
    summarizeUnknown(tool.args) ??
    summarizeUnknown(tool.result)
  const phase = tool.phase.toLowerCase()

  if (phase.includes('error')) {
    return compactBubbleText(`Checking ${name} error${detail ? `: ${detail}` : ''}`)
  }
  if (phase.includes('complete') || phase.includes('done')) {
    return compactBubbleText(`Finished ${name}${detail ? `: ${detail}` : ''}`)
  }
  if (phase.includes('start') || phase.includes('running')) {
    return compactBubbleText(`Running ${name}${detail ? `: ${detail}` : ''}`)
  }
  if (phase.includes('skill')) {
    return compactBubbleText(`Loading skill: ${name}`)
  }
  return compactBubbleText(`Using ${name}${detail ? `: ${detail}` : ''}`)
}

export function activeBubbleTextForPresence(
  presence: Pick<
    Matrix3DAgentPresence,
    'id' | 'effectiveStatus' | 'lastActivity' | 'activeSessionKey'
  >,
  streaming: StreamingState | undefined,
): string | null {
  if (presence.effectiveStatus !== 'working') return null

  const latestLifecycle = streaming?.lifecycleEvents.at(-1)
  if (latestLifecycle?.text) {
    return compactBubbleText(latestLifecycle.text)
  }

  const tool = latestStreamingTool(streaming)
  if (tool) return toolActionPhrase(tool)

  if (streaming?.thinking) {
    return compactBubbleText(`Thinking: ${streaming.thinking}`)
  }

  if (streaming?.text) {
    return compactBubbleText(`Writing: ${streaming.text}`)
  }

  if (presence.lastActivity) {
    const prefix = shouldRouteWorkingAgentToConsole(presence)
      ? 'Delegating'
      : presence.activeSessionKey
        ? 'Handling'
        : 'Active'
    return compactBubbleText(`${prefix}: ${presence.lastActivity}`)
  }

  return 'Active now'
}

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
  rosterAgent: {
    id: string
    displayName?: string
    role?: string
    name?: string
  },
  agent: ReturnType<typeof useAgentView>['activeAgents'][number],
): number {
  const id = normalizeText(rosterAgent.id)
  const display = normalizeText(
    rosterAgent.displayName ?? rosterAgent.name ?? '',
  )
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

export function shouldRouteWorkingAgentToConsole(
  presence: Pick<Matrix3DAgentPresence, 'id'>,
): boolean {
  return presence.id === 'hermes-switch'
}

function toOfficeColor(agent: AgentLike): string {
  const text = normalizeText(`${agent.name} ${agent.task} ${agent.model}`)
  for (const [token, color] of Object.entries(NAMED_AGENT_IDENTITY_COLORS)) {
    if (text.includes(token)) return color
  }
  if (text.includes('qa') || text.includes('test')) return '#fbbf24'
  if (text.includes('research') || text.includes('analyst')) return '#38bdf8'
  if (agent.status === 'failed' || agent.status === 'offline') return '#f87171'
  if (text.includes('build') || text.includes('code') || text.includes('dev'))
    return '#a78bfa'
  return AGENT_IDENTITY_COLORS[stableHash(text) % AGENT_IDENTITY_COLORS.length]
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

function crewRosterStatus(
  agent: CrewStatusAgent,
): Matrix3DAgentPresence['rosterStatus'] {
  if (!agent.profileFound) return 'offline'
  if (agent.processAlive || agent.gatewayState === 'running') return 'online'
  if (agent.assignedTaskCount > 0 || agent.sessionCount > 0) return 'away'
  return 'away'
}

export function inferLiveMatch(
  rosterAgent: CrewStatusAgent,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
): ReturnType<typeof useAgentView>['activeAgents'][number] | null {
  const id = normalizeText(rosterAgent.id)
  const shouldMapWorkspaceChatToHermesSwitch = id === 'hermes-switch'
  let bestMatch:
    | ReturnType<typeof useAgentView>['activeAgents'][number]
    | null = null
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
      // Broader fallback: any active agent whose id/name suggests it is the
      // Hermes workspace chat counts — real-world sessions often have opaque
      // keys (UUIDs, timestamps) that don't satisfy the strict heuristic.
      // Store the first such agent as a last-resort so we can return it after
      // the loop if nothing better matched.
      if (!bestMatch) bestMatch = agent
      continue
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

  // hermes-switch: return kind-matched fallback even when bestScore is 0
  if (shouldMapWorkspaceChatToHermesSwitch) return bestMatch

  if (bestScore > 0) return bestMatch
  return null
}

export function inferWorkspaceLiveMatch(
  fallbackAgent: WorkspaceAgentDirectory,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
): ReturnType<typeof useAgentView>['activeAgents'][number] | null {
  let bestMatch:
    | ReturnType<typeof useAgentView>['activeAgents'][number]
    | null = null
  let bestScore = 0
  for (const agent of activeAgents) {
    const key = normalizeText(agent.id)
    if (key === 'main' || key.includes('main') || key.includes('default'))
      return agent
    const score = scoreLiveMatch(
      {
        id: fallbackAgent.id,
        displayName: fallbackAgent.name,
        role: fallbackAgent.role,
      },
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

function toOfficeAgent(presence: Matrix3DAgentPresence): OfficeAgent {
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
    subtitle:
      presence.lastActivity || `${presence.role} • ${presence.rosterStatus}`,
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

export function mergePresence(
  crewAgents: Array<CrewStatusAgent>,
  fallbackAgents: Array<WorkspaceAgentDirectory>,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
  activityBoosts: Record<string, number>,
  profileActivity: Partial<Record<string, Matrix3DProfileActivity>>,
): Array<Matrix3DAgentPresence> {
  if (crewAgents.length > 0) {
    const matchedSessionIds = new Set<string>()
    const merged = crewAgents.map((agent) => {
      const live = inferLiveMatch(agent, activeAgents)
      if (live) matchedSessionIds.add(live.id)

      const rosterStatus = crewRosterStatus(agent)
      const boost = activityBoosts[agent.id] ?? 0
      // Deterministic per-profile live signal takes precedence over the
      // heuristic. A profile with an is_active session is unambiguously
      // working, regardless of whether a live session matched by name.
      const profileLive = profileActivity[agent.id]
      const delegatedLive = Boolean(agent.activeDelegatedSessionKey)
      const effectiveStatus: OfficeAgent['status'] =
        profileLive?.active || delegatedLive
          ? 'working'
          : resolveCrewEffectiveStatus({
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
          : profileLive?.active && profileLive.title
            ? profileLive.title
            : delegatedLive && agent.activeDelegatedTitle
              ? agent.activeDelegatedTitle
              : agent.lastSessionTitle ||
                buildRosterOfficeSubtitle(agent, rosterStatus),
        sessionCount: agent.sessionCount,
        assignedTaskCount: agent.assignedTaskCount,
        activeSessionKey:
          live?.id ??
          profileLive?.sessionKey ??
          agent.activeDelegatedSessionKey ??
          null,
        activityScore:
          profileLive?.active || delegatedLive ? Math.max(boost, 5) : boost,
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
    const isDefaultWorkspace =
      agent.id === 'default' || agent.id === 'workspace'
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
    } satisfies Matrix3DAgentPresence
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

  const recentSessionAge = current.lastSessionAt
    ? nowMs - current.lastSessionAt * 1000
    : Number.POSITIVE_INFINITY
  if (recentSessionAge < 120_000) score += 2
  if (current.assignedTaskCount > 0) score += 1

  const id = agent.id.toLowerCase()
  const display = agent.displayName.toLowerCase()
  if (
    logText.includes(`[${id}]`) ||
    logText.includes(` ${id} `) ||
    logText.includes(display)
  )
    score += 1
  if (
    logText.includes(`delegate to ${display}`) ||
    logText.includes(`delegated to ${display}`)
  )
    score += 3
  if (
    logText.includes(`handover to ${display}`) ||
    logText.includes(`assign ${display}`)
  )
    score += 2

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

/** Feed event shape matches RetroOffice3D internal FeedEvent */
type Matrix3DFeedEvent = {
  id: string
  name: string
  text: string
  ts: number
  kind?: 'status' | 'reply'
}

/** Monitor content per-agent for desk screens */
type Matrix3DMonitorEntry = {
  title?: string
  body?: string
  lines?: Array<string>
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
  /** #81/#85 — drives sit-at-desk + room-routing animations */
  animationState: Pick<
    OfficeAnimationState,
    | 'cleaningCues'
    | 'danceUntilByAgentId'
    | 'deskHoldByAgentId'
    | 'githubHoldByAgentId'
    | 'gymHoldByAgentId'
    | 'idleLeisureByAgentId'
    | 'phoneBoothHoldByAgentId'
    | 'smsBoothHoldByAgentId'
    | 'qaHoldByAgentId'
    | 'jukeboxHoldByAgentId'
  >
  /** #82 — live streaming text bubbles per agent (truncated) */
  streamingTextByAgentId: Record<string, string | null>
  /** #83 — desk monitor content per agent */
  monitorByAgentId: Record<string, Matrix3DMonitorEntry>
  /** #84 — activity feed events */
  feedEvents: Array<Matrix3DFeedEvent>
  /** #86 — deterministic desk→agent assignment */
  deskAssignmentByDeskUid: Record<string, string>
  /** #87 — run counts per agent */
  runCountByAgentId: Record<string, number>
  /** #87 — last-seen timestamps per agent (ms) */
  lastSeenByAgentId: Record<string, number>
  /** #88 — progress 0-100 per working agent */
  progressByAgentId: Record<string, number>
  /** #89 — selected agent id from store → spotlight / follow-cam */
  selectedAgentId: string | null
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
    // Matrix3D uses crew-status for live delegated child sessions. Poll near
    // the dashboard active-session window so short sub-agent runs animate.
    staleTime: 4_000,
    refetchInterval: 4_000,
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

  const crewAgentIds = (crewStatusQuery.data ?? []).map((a) => a.id)
  const profileActivityQuery = useQuery({
    queryKey: [
      'matrix3d',
      'profile-activity',
      [...crewAgentIds].sort().join(','),
    ],
    queryFn: () => fetchProfileActivity(crewAgentIds),
    enabled: crewAgentIds.length > 0,
    staleTime: 4_000,
    refetchInterval: 4_000,
    retry: false,
  })

  const previousCrewRef = useRef<Record<string, CrewActivitySnapshot>>({})
  const [activityBoosts, setActivityBoosts] = useState<Record<string, number>>(
    {},
  )

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

  const profileActivity = profileActivityQuery.data ?? {}

  const presence = useMemo(
    () =>
      mergePresence(
        crewAgents,
        rosterAgents,
        agentView.activeAgents,
        activityBoosts,
        profileActivity,
      ).filter(shouldShowMatrix3DAgent),
    [
      activityBoosts,
      agentView.activeAgents,
      crewAgents,
      rosterAgents,
      profileActivity,
    ],
  )

  const agents = useMemo(() => presence.map(toOfficeAgent), [presence])

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

  // #89 — store-selected agent for spotlight / follow-cam
  const selectedAgentId = useMatrix3DStore((s) => s.selectedAgentId)

  // Pull streaming state up here so animationState can derive holds from real
  // tool-call signals rather than keyword-matching the status subtitle.
  const streamingState = useChatStore((s) => s.streamingState)
  const [idleLeisureRotationBucket, setIdleLeisureRotationBucket] = useState(
    () => Math.floor(Date.now() / 120_000),
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIdleLeisureRotationBucket(Math.floor(Date.now() / 120_000))
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // #81/#85 — animationState: derive room holds from each agent's most recent
  // tool call. See `inferActiveRoom` above for the routing table and rationale.
  // The previous implementation keyword-matched against `lastActivity` (a
  // status string like "auto • running • 35%"), which forced users to type
  // room names in prompts to trigger animations — a broken UX.
  const animationState = useMemo(() => {
    const deskHoldByAgentId: Record<string, boolean> = {}
    const smsBoothHoldByAgentId: Record<string, boolean> = {}
    const phoneBoothHoldByAgentId: Record<string, boolean> = {}
    const qaHoldByAgentId: Record<string, boolean> = {}
    const githubHoldByAgentId: Record<string, boolean> = {}
    const idleLeisureByAgentId: Record<string, OfficeIdleLeisureArea> = {}
    // Working agents use task/tool holds. Idle agents use a separate
    // leisure-area map so their status stays idle while the scene routes them
    // to social/rest areas instead of random roaming.
    const gymHoldByAgentId: Record<string, boolean> = {}
    const jukeboxHoldByAgentId: Record<string, boolean> = {}
    let idleAgentIndex = 0
    for (const p of presence) {
      if (p.effectiveStatus === 'idle') {
        idleLeisureByAgentId[p.id] = idleLeisureAreaForAgent(
          p.id,
          idleLeisureRotationBucket,
          idleAgentIndex,
        )
        idleAgentIndex += 1
        continue
      }

      if (p.effectiveStatus !== 'working') continue

      // The Hermes/Switch orchestrator should visibly operate from the
      // console computer whenever active. The RetroOffice server-room route is
      // currently driven by githubHoldByAgentId, so use that hold map for this
      // dedicated Matrix3D console placement. Other profiles keep normal
      // room/tool routing and default to desks.
      if (shouldRouteWorkingAgentToConsole(p)) {
        githubHoldByAgentId[p.id] = true
        continue
      }

      const sessionKey = p.activeSessionKey ?? p.id
      const streaming = streamingState.get(sessionKey)
      const { room } = inferActiveRoom(streaming)

      switch (room) {
        case 'github':
          githubHoldByAgentId[p.id] = true
          break
        case 'qa':
          qaHoldByAgentId[p.id] = true
          break
        case 'phone':
          phoneBoothHoldByAgentId[p.id] = true
          break
        case 'sms':
          smsBoothHoldByAgentId[p.id] = true
          break
        case 'server':
          // No dedicated server-room hold map in OfficeAnimationState yet —
          // route to github room which currently houses the server racks
          // visually. Update this branch once a dedicated map is added.
          githubHoldByAgentId[p.id] = true
          break
        case 'desk':
        default:
          deskHoldByAgentId[p.id] = true
          break
      }
    }

    return {
      cleaningCues: [],
      danceUntilByAgentId: {},
      deskHoldByAgentId,
      gymHoldByAgentId,
      idleLeisureByAgentId,
      smsBoothHoldByAgentId,
      phoneBoothHoldByAgentId,
      qaHoldByAgentId,
      githubHoldByAgentId,
      jukeboxHoldByAgentId,
    }
  }, [idleLeisureRotationBucket, presence, streamingState])

  // #82 — streaming speech bubbles: current streaming text per active session (≤80 chars)
  const streamingTextByAgentId = useMemo(() => {
    const result: Record<string, string | null> = {}
    for (const p of presence) {
      const sessionKey = p.activeSessionKey ?? p.id
      const state = streamingState.get(sessionKey)
      result[p.id] = activeBubbleTextForPresence(p, state)
    }
    return result
  }, [presence, streamingState])

  // #83 — monitor screens: last activity as monitor content
  const monitorByAgentId = useMemo(() => {
    const result: Record<string, Matrix3DMonitorEntry> = {}
    for (const p of presence) {
      if (p.lastActivity) {
        result[p.id] = {
          title: p.name,
          body: p.lastActivity,
        }
      }
    }
    return result
  }, [presence])

  // #86 — deterministic desk assignment: hash agentId to a desk slot
  const deskAssignmentByDeskUid = useMemo(() => {
    const result: Record<string, string> = {}
    for (let i = 0; i < presence.length; i++) {
      const p = presence[i]
      // Use a simple hash of the agent id to pick a consistent desk index
      let hash = 0
      for (let j = 0; j < p.id.length; j++) {
        hash = (hash * 31 + p.id.charCodeAt(j)) >>> 0
      }
      const deskUid = `desk-${(hash % 20) + 1}`
      // Avoid collision: if taken, use positional fallback
      const key = result[deskUid] ? `desk-pos-${i + 1}` : deskUid
      result[key] = p.id
    }
    return result
  }, [presence])

  // #87 — run counts and last-seen
  const runCountByAgentId = useMemo(() => {
    const result: Record<string, number> = {}
    for (const p of presence) {
      result[p.id] = p.sessionCount + p.assignedTaskCount
    }
    return result
  }, [presence])

  const lastSeenByAgentId = useMemo(() => {
    const result: Record<string, number> = {}
    const now = Date.now()
    for (const p of presence) {
      if (p.effectiveStatus === 'working') {
        result[p.id] = now
      } else if (p.activityScore > 0) {
        // Approximate: activity score implies recent activity within last 5min
        result[p.id] = now - (5 - Math.min(p.activityScore, 5)) * 60_000
      }
    }
    return result
  }, [presence])

  // #84 — feed events: one event per presence entry with recent activity
  const feedEvents = useMemo((): Array<Matrix3DFeedEvent> => {
    return presence
      .filter((p) => p.lastActivity && p.activityScore > 0)
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        name: p.name,
        text: p.lastActivity ?? '',
        // Use lastSeenByAgentId (derived from activityScore) so the timestamp
        // doesn't freeze at memo-creation time.
        ts: lastSeenByAgentId[p.id] ?? Date.now() - 5 * 60_000,
        kind: 'status' as const,
      }))
  }, [presence, lastSeenByAgentId])

  // #88 — progress per agent: from activeAgents.progress or lastActivity parse
  const progressByAgentId = useMemo(() => {
    const result: Record<string, number> = {}
    for (const p of presence) {
      // Try live agent progress first
      const liveAgent = agentView.activeAgents.find(
        (a) => a.id === (p.activeSessionKey ?? p.id),
      )
      if (
        liveAgent &&
        typeof liveAgent.progress === 'number' &&
        liveAgent.progress > 0
      ) {
        result[p.id] = Math.min(100, Math.max(0, liveAgent.progress))
        continue
      }
      // Fall back to parsing "NN%" from lastActivity text
      if (p.lastActivity) {
        const match = /(\d{1,3})%/.exec(p.lastActivity)
        if (match) {
          result[p.id] = Math.min(100, Math.max(0, Number(match[1])))
        }
      }
    }
    return result
  }, [presence, agentView.activeAgents])

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
    animationState,
    streamingTextByAgentId,
    monitorByAgentId,
    feedEvents,
    deskAssignmentByDeskUid,
    runCountByAgentId,
    lastSeenByAgentId,
    progressByAgentId,
    selectedAgentId,
  }
}
