import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { resolveCrewEffectiveStatus } from './matrix3d-presence-status'
import { buildFleetPresence } from './a2a-fleet-presence'
import type { Matrix3DFleetPeer } from './a2a-fleet-presence'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type {
  OfficeAnimationState,
  OfficeIdleLeisureArea,
} from '@/lib/office/eventTriggers'
import type { StudioGatewayAdapterType } from '@/lib/studio/settings'
import type {
  CrewActivity,
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
  getA2AFleetConversations,
  getA2AFleetPeers,
} from '@/lib/hermes-client'
import { useChatStore } from '@/stores/chat-store'
import { activeScopeKey } from '@/lib/session-scope'

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
 *      for this agent's session (runs SwitchUI itself streams — exact).
 *   2. Otherwise the newest tool call crew-status read from the profile's
 *      state.db (`fallbackToolName`) — covers Telegram/cron/CLI/other runs.
 *   3. Working but no tool signal → desk (default).
 *
 * Rest rooms (gym, jukebox) are NOT auto-routed: they should fire only via
 * explicit intentional signals, not heuristics, otherwise figures wander
 * during normal work.
 */
export function inferActiveRoom(
  streaming: StreamingState | undefined,
  fallbackToolName: string | null = null,
): {
  room: Matrix3DRoom
  signal: string
} {
  if (!streaming || streaming.toolCalls.length === 0) {
    if (fallbackToolName) {
      return {
        room: roomForToolName(fallbackToolName),
        signal: `db-tool:${fallbackToolName}`,
      }
    }
    return { room: 'desk', signal: 'no-tool-calls' }
  }

  // Find the most recent tool call (highest firstSeenAt). Prefer non-error
  // entries — an errored tool that completed 10s ago shouldn't pin the figure.
  const sorted = [...streaming.toolCalls].sort(
    (a, b) => (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0),
  )
  const recent = sorted.find((tc) => tc.phase !== 'error') ?? sorted[0]
  return { room: roomForToolName(recent.name), signal: `tool:${recent.name}` }
}

export function roomForToolName(toolName: string): Matrix3DRoom {
  const name = toolName.toLowerCase()

  // GitHub family (GitHub MCP tools, gh CLI, etc.)
  if (
    name.includes('github') ||
    name.startsWith('gh_') ||
    name.startsWith('mcp_github') ||
    name.includes('pull_request') ||
    name.includes('issue')
  ) {
    return 'github'
  }

  // Shell / terminal / exec → server room (where the racks live)
  if (
    name.includes('terminal') ||
    name === 'bash' ||
    name === 'shell' ||
    name.includes('exec') ||
    name.includes('run_command')
  ) {
    return 'server'
  }

  // Phone-style call tooling
  if (
    name.startsWith('phone_') ||
    name.includes('call_tool') ||
    name.includes('voice_')
  ) {
    return 'phone'
  }

  // SMS / text send
  if (
    name.startsWith('sms_') ||
    name.includes('text_send') ||
    name.includes('twilio')
  ) {
    return 'sms'
  }

  // QA / test runs
  if (
    name.includes('test') ||
    name.includes('vitest') ||
    name.includes('pytest') ||
    name.includes('lint') ||
    name.includes('typecheck')
  ) {
    return 'qa'
  }

  // Everything else (web_search, browser, gmail/mcp_gmail, vision_analyze,
  // load_mcp_server, view_skill / load_skill / skill.loaded, delegate_task,
  // spawn_agent, file edits, read, glob, grep, etc.) → desk.
  return 'desk'
}

const ACTIVE_BUBBLE_MAX_LENGTH = 96

const SESSION_TITLE_MAX_LENGTH = 60

function compactBubbleText(
  value: string,
  maxLength = ACTIVE_BUBBLE_MAX_LENGTH,
): string {
  const normalized = value
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
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

function toolActionPhrase(tool: StreamingState['toolCalls'][number]): string {
  const name = readableToolName(tool.name)
  const detail =
    summarizeUnknown(tool.preview) ??
    summarizeUnknown(tool.args) ??
    summarizeUnknown(tool.result)
  const phase = tool.phase.toLowerCase()

  if (phase.includes('error')) {
    return compactBubbleText(
      `Checking ${name} error${detail ? `: ${detail}` : ''}`,
    )
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

const TOOL_FRESH_MS = 60_000

function isFreshTool(
  tool: NonNullable<CrewActivity['tool']>,
  nowMs: number,
): boolean {
  return tool.at !== null && nowMs - tool.at <= TOOL_FRESH_MS
}

/** Newest db tool name for this agent's session, if it ran in the last minute. */
export function freshToolName(
  presence: Pick<Matrix3DAgentPresence, 'activeSessionKey' | 'activity'>,
  nowMs: number,
): string | null {
  const tool = sessionActivity(presence)?.tool
  return tool && isFreshTool(tool, nowMs) ? tool.name : null
}

/** crew-status activity, only when it describes the session this agent is running. */
function sessionActivity(
  presence: Pick<Matrix3DAgentPresence, 'activeSessionKey' | 'activity'>,
): CrewActivity | null {
  const activity = presence.activity
  if (!activity || activity.sessionKey !== presence.activeSessionKey)
    return null
  return activity
}

export function activeBubbleTextForPresence(
  presence: Pick<
    Matrix3DAgentPresence,
    | 'effectiveStatus'
    | 'activeSessionTitle'
    | 'isDelegating'
    | 'activeSessionKey'
    | 'activity'
  >,
  streaming: StreamingState | undefined,
  nowMs = Date.now(),
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

  // Not streamed by SwitchUI (Telegram, cron, CLI, other clients): what the
  // profile's state.db says the active session is doing right now.
  const activity = sessionActivity(presence)
  // A tool call older than a minute is history, not what it is doing now.
  if (activity?.tool && isFreshTool(activity.tool, nowMs)) {
    const { name, argsPreview } = activity.tool
    return compactBubbleText(argsPreview ? `${name}: ${argsPreview}` : name)
  }
  if (activity?.description) return compactBubbleText(activity.description)

  const title = presence.activeSessionTitle
    ? compactBubbleText(presence.activeSessionTitle, SESSION_TITLE_MAX_LENGTH)
    : ''
  if (presence.isDelegating)
    return title ? `Delegating: ${title}` : 'Delegating'
  return title || 'Active now'
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
  source: 'crew' | 'workspace'
  rosterStatus: 'online' | 'away' | 'offline' | 'unknown'
  effectiveStatus: OfficeAgent['status']
  lastActivity: string | null
  /** Title of the profile's most recent session (shown as "Last task" when not working). */
  lastTaskTitle: string | null
  sessionCount: number
  assignedTaskCount: number
  activeSessionKey: string | null
  /** Title of the session this agent is actually running (never a model / status string). */
  activeSessionTitle: string | null
  /** True only while a fresh delegated child session's parent is this agent's session. */
  isDelegating: boolean
  /** Live sessions (children / same profile) folded into this agent instead of their own card. */
  subSessionKeys: Array<string>
  /**
   * Profile whose state.db holds `activeSessionKey` (for `/chat/$key?profile=`);
   * null = the active gateway profile.
   */
  activeSessionProfile: string | null
  /** state.db activity of the profile's active/most recent session (crew only). */
  activity: CrewActivity | null
  /** Live sub-session counts on this agent, grouped by source. */
  badges: SessionBadges
}

export type SessionBadgeKind = 'sub' | 'a2a' | 'kanban' | 'cron'
export type SessionBadges = Partial<Record<SessionBadgeKind, number>>

const BADGE_KIND_BY_SOURCE: Partial<Record<string, SessionBadgeKind>> = {
  subagent: 'sub',
  delegate: 'sub',
  delegation: 'sub',
  a2a_fleet: 'a2a',
  a2a: 'a2a',
  kanban: 'kanban',
  cron: 'cron',
}

/** Count live sessions by kind; primary chats (telegram, cli, api_server…) are not badges. */
export function groupSessionBadges(
  sessions: Array<{ id: string; source: string | null }>,
): SessionBadges {
  const seen = new Set<string>()
  const badges: SessionBadges = {}
  for (const session of sessions) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    const kind = BADGE_KIND_BY_SOURCE[(session.source ?? '').toLowerCase()]
    if (kind) badges[kind] = (badges[kind] ?? 0) + 1
  }
  return badges
}

export function formatSessionBadges(badges: SessionBadges): string | null {
  const order: Array<SessionBadgeKind> = ['sub', 'a2a', 'kanban', 'cron']
  const parts = order
    .filter((kind) => (badges[kind] ?? 0) > 0)
    .map((kind) => `${kind} ${badges[kind]}`)
  return parts.length > 0 ? parts.join(' · ') : null
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

// Status only: the model ("auto") and guessed progress are not activities.
function buildLiveOfficeSubtitle(agent: Pick<AgentLike, 'status'>): string {
  return agent.status
}

const DELEGATION_FRESH_MS = 5 * 60_000

function hasFreshDelegation(agent: CrewStatusAgent, nowMs: number): boolean {
  if (!agent.activeDelegatedSessionKey) return false
  const lastActiveAt = agent.activeDelegatedLastActiveAt
  // crew-status sends lastActiveAt in ms.
  return lastActiveAt === null || nowMs - lastActiveAt <= DELEGATION_FRESH_MS
}

/**
 * Fold live sessions that matched no agent into the owning agent (by
 * parentSessionId, then profile). Anything unowned is dropped — a session
 * never becomes its own card, and its title is never an agent name.
 */
function attachUnmatchedSessions(
  presences: Array<Matrix3DAgentPresence>,
  unmatched: ReturnType<typeof useAgentView>['activeAgents'],
): Array<Matrix3DAgentPresence> {
  for (const session of unmatched) {
    const parent = session.parentSessionId
      ? presences.find((p) => p.activeSessionKey === session.parentSessionId)
      : undefined
    const owner =
      parent ??
      (session.profile
        ? presences.find(
            (p) => normalizeText(p.id) === normalizeText(session.profile ?? ''),
          )
        : undefined)
    if (!owner) continue
    owner.subSessionKeys.push(session.id)
    // A running child of this agent's session is a real delegation.
    if (parent && session.status === 'running') owner.isDelegating = true
  }
  return presences
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
    // Child sessions and other profiles' sessions are attached to their owner
    // later (attachUnmatchedSessions); they never *are* this agent.
    if (agent.parentSessionId) continue
    if (agent.profile && normalizeText(agent.profile) !== id) continue
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
    badge: formatSessionBadges(presence.badges),
  }
}

// Distinct from the profile identity colours (green/violet/sky/amber).
const FLEET_COLORS = [
  '#f472b6',
  '#2dd4bf',
  '#fb923c',
  '#e879f9',
  '#a3e635',
  '#fda4af',
]

function fleetToOfficeAgent(peer: Matrix3DFleetPeer): OfficeAgent {
  const color = FLEET_COLORS[stableHash(peer.peer) % FLEET_COLORS.length]
  const avatar = createDefaultAgentAvatarProfile(peer.id)
  return {
    id: peer.id,
    name: peer.name,
    subtitle: peer.busy ? 'busy (inferred)' : 'idle (inferred)',
    status: peer.busy ? 'working' : 'idle',
    color,
    item: 'globe',
    // Headset + cap + fleet-coloured top: visibly not a Hermes profile.
    avatarProfile: {
      ...avatar,
      clothing: { ...avatar.clothing, topColor: color },
      accessories: { ...avatar.accessories, headset: true, hatStyle: 'cap' },
    },
  }
}

export function mergePresence(
  crewAgents: Array<CrewStatusAgent>,
  fallbackAgents: Array<WorkspaceAgentDirectory>,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
  nowMs = Date.now(),
): Array<Matrix3DAgentPresence> {
  if (crewAgents.length > 0) {
    const matchedSessionIds = new Set<string>()
    // Parent session keys that currently have a fresh delegated child running.
    const delegatingParentKeys = new Set(
      crewAgents
        .filter((agent) => hasFreshDelegation(agent, nowMs))
        .map((agent) => agent.activeDelegatedParentSessionKey)
        .filter((key): key is string => Boolean(key)),
    )
    const merged = crewAgents.map((agent) => {
      const live = inferLiveMatch(agent, activeAgents)
      if (live) matchedSessionIds.add(live.id)

      const rosterStatus = crewRosterStatus(agent)
      // Working = own db active session, a fresh delegated child, or a live
      // running gateway session. No log-text / counter-delta heuristics.
      const ownLive = agent.isActive
      const delegatedLive = hasFreshDelegation(agent, nowMs)
      const effectiveStatus: OfficeAgent['status'] =
        ownLive || delegatedLive
          ? 'working'
          : resolveCrewEffectiveStatus({
              liveStatus: live?.status ?? null,
              rosterStatus,
            })
      const activeSessionTitle =
        (ownLive ? agent.activeSessionTitle : null) ??
        (delegatedLive ? agent.activeDelegatedTitle : null)
      // The profile's own db is deterministic; the live match is a heuristic.
      const activeSessionKey =
        agent.activeSessionKey ??
        live?.id ??
        (delegatedLive ? agent.activeDelegatedSessionKey : null)
      // Own sessions live in this profile's db; delegated children are read
      // from the hermes-switch db (crew-status readDelegatedChildSessions).
      const activeSessionProfile = agent.activeSessionKey
        ? agent.id
        : live
          ? (live.profile ?? null)
          : activeSessionKey
            ? 'hermes-switch'
            : null

      return {
        id: agent.id,
        name: agent.displayName,
        role: agent.role,
        model: agent.model,
        provider: agent.provider,
        source: 'crew',
        rosterStatus,
        effectiveStatus,
        lastActivity:
          activeSessionTitle ??
          (live
            ? buildLiveOfficeSubtitle(live)
            : agent.lastSessionTitle ||
              buildRosterOfficeSubtitle(agent, rosterStatus)),
        lastTaskTitle: agent.lastSessionTitle,
        sessionCount: agent.sessionCount,
        assignedTaskCount: agent.assignedTaskCount,
        activeSessionKey,
        activeSessionTitle,
        isDelegating: [activeSessionKey, agent.activeSessionKey].some(
          (key) => key !== null && delegatingParentKeys.has(key),
        ),
        subSessionKeys: [],
        activeSessionProfile,
        activity: agent.activity,
        badges: {},
      } satisfies Matrix3DAgentPresence
    })

    attachUnmatchedSessions(
      merged,
      activeAgents.filter((agent) => !matchedSessionIds.has(agent.id)),
    )
    return withSessionBadges(merged, activeAgents, crewAgents)
  }

  const matchedSessionIds = new Set<string>()
  const rosterPresence = fallbackAgents.map((agent) => {
    const live = inferWorkspaceLiveMatch(agent, activeAgents)
    if (live) matchedSessionIds.add(live.id)
    const effectiveStatus = live
      ? toLiveOfficeStatus(live.status)
      : agent.status === 'offline'
        ? 'error'
        : 'idle'
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      model: agent.model ?? 'unknown',
      provider: agent.provider,
      source: 'workspace',
      rosterStatus: live ? 'online' : agent.status,
      effectiveStatus,
      lastActivity: live
        ? buildLiveOfficeSubtitle(live)
        : buildRosterOfficeSubtitle(agent, agent.status),
      lastTaskTitle: null,
      sessionCount: live ? 1 : 0,
      assignedTaskCount: 0,
      activeSessionKey: live?.id ?? null,
      activeSessionTitle: null,
      isDelegating: false,
      subSessionKeys: [],
      activeSessionProfile: live?.profile ?? null,
      activity: null,
      badges: {},
    } satisfies Matrix3DAgentPresence
  })

  attachUnmatchedSessions(
    rosterPresence,
    activeAgents.filter((agent) => !matchedSessionIds.has(agent.id)),
  )
  return withSessionBadges(rosterPresence, activeAgents, [])
}

/**
 * Badge counts per agent: its gateway sub-sessions (subSessionKeys) plus the
 * profile's own live db sessions, grouped by source. Children without a
 * source are delegations.
 */
function withSessionBadges(
  presences: Array<Matrix3DAgentPresence>,
  activeAgents: ReturnType<typeof useAgentView>['activeAgents'],
  crewAgents: Array<CrewStatusAgent>,
): Array<Matrix3DAgentPresence> {
  const byId = new Map(activeAgents.map((agent) => [agent.id, agent]))
  for (const presence of presences) {
    const sessions = presence.subSessionKeys.map((id) => {
      const session = byId.get(id)
      return {
        id,
        source:
          session?.source ?? (session?.parentSessionId ? 'subagent' : null),
      }
    })
    const crew = crewAgents.find((agent) => agent.id === presence.id)
    presence.badges = groupSessionBadges([
      ...sessions,
      ...(crew?.liveSessions ?? []),
    ])
  }
  return presences
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
  /** A2A fleet peers (inferred busy/idle); never counted as profiles. */
  fleet: Array<Matrix3DFleetPeer>
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
    | 'fleetSeatAgentIds'
  >
  /** #82 — live streaming text bubbles per agent (truncated) */
  streamingTextByAgentId: Record<string, string | null>
  /** #83 — desk monitor content per agent */
  monitorByAgentId: Record<string, Matrix3DMonitorEntry>
  /** #84 — activity feed events */
  feedEvents: Array<Matrix3DFeedEvent>
  /** #87 — run counts per agent */
  runCountByAgentId: Record<string, number>
  /** #87 — last-seen timestamps per agent (ms) */
  lastSeenByAgentId: Record<string, number>
  /** #88 — progress 0-100 per working agent */
  progressByAgentId: Record<string, number>
}

function shouldShowMatrix3DAgent(presence: Matrix3DAgentPresence): boolean {
  return presence.id !== 'workspace'
}

export function useMatrix3DOfficeData(): Matrix3DOfficeData {
  const agentView = useAgentView()

  const crewStatusQuery = useQuery({
    queryKey: ['matrix3d', 'crew-status'],
    queryFn: listCrewStatusAgents,
    // Near-live: poll every 3s while the tab is visible. There is no upstream
    // stream to fan in instead — gateway run SSE (/v1/runs/{id}/events) only
    // covers runs this API caller created, and Telegram/cron/CLI runs never
    // appear there — so state.db via crew-status is the cross-source signal.
    // Runs SwitchUI starts itself still win via the chat store streamingState.
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
    retry: false,
  })

  // Shared keys with the A2A Fleet tab so both views reuse one poll.
  const fleetPeersQuery = useQuery({
    queryKey: ['matrix3d', 'a2a-fleet', 'peers'],
    queryFn: getA2AFleetPeers,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })

  const fleetConversationsQuery = useQuery({
    queryKey: ['matrix3d', 'a2a-fleet', 'conversations'],
    queryFn: getA2AFleetConversations,
    staleTime: 2_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
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
    () =>
      mergePresence(crewAgents, rosterAgents, agentView.activeAgents).filter(
        shouldShowMatrix3DAgent,
      ),
    [agentView.activeAgents, crewAgents, rosterAgents],
  )

  // Pull streaming state up here so animationState can derive holds from real
  // tool-call signals rather than keyword-matching the status subtitle.
  const streamingState = useChatStore((s) => s.streamingState)
  const [idleLeisureRotationBucket, setIdleLeisureRotationBucket] = useState(
    () => Math.floor(Date.now() / 120_000),
  )
  // 30s clock: time-windowed signals (fleet busy, tool freshness) must expire
  // even when polls return structurally identical data (same refs, no rerun).
  const [clockMs, setClockMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIdleLeisureRotationBucket(Math.floor(Date.now() / 120_000))
      setClockMs(Date.now())
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Recomputed per conversations poll and per clock tick (busy has a 10 min window).
  const fleet = useMemo(
    () =>
      buildFleetPresence(
        fleetPeersQuery.data?.peers ?? [],
        fleetConversationsQuery.data?.conversations ?? [],
        Math.max(clockMs, fleetConversationsQuery.dataUpdatedAt),
      ),
    [
      clockMs,
      fleetConversationsQuery.data,
      fleetConversationsQuery.dataUpdatedAt,
      fleetPeersQuery.data,
    ],
  )
  const fleetIdsKey = fleet.map((peer) => peer.id).join('\n')
  const fleetSeatAgentIds = useMemo(
    () => (fleetIdsKey ? fleetIdsKey.split('\n') : []),
    [fleetIdsKey],
  )

  const agents = useMemo(
    () => [...presence.map(toOfficeAgent), ...fleet.map(fleetToOfficeAgent)],
    [fleet, presence],
  )

  const selectedAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents, rosterAgents),
    [hasLiveAgents, rosterAgents],
  )

  const activeAdapterType = useMemo<StudioGatewayAdapterType>(
    () => pickAdapterType(hasLiveAgents, rosterAgents),
    [hasLiveAgents, rosterAgents],
  )

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

      // Local streaming (runs SwitchUI started) wins; otherwise the newest
      // tool call from the profile's state.db routes any agent the same way.
      const sessionKey = p.activeSessionKey ?? p.id
      const streaming = streamingState.get(activeScopeKey(sessionKey))
      const { room } = inferActiveRoom(
        streaming,
        freshToolName(p, Math.max(clockMs, crewStatusQuery.dataUpdatedAt)),
      )

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
      // A2A peers keep fixed seats in the meeting room, busy or idle.
      fleetSeatAgentIds,
    }
  }, [
    clockMs,
    crewStatusQuery.dataUpdatedAt,
    fleetSeatAgentIds,
    idleLeisureRotationBucket,
    presence,
    streamingState,
  ])

  // #82 — streaming speech bubbles: current streaming text per active session (≤80 chars)
  const streamingTextByAgentId = useMemo(() => {
    const result: Record<string, string | null> = {}
    for (const p of presence) {
      const sessionKey = p.activeSessionKey ?? p.id
      const state = streamingState.get(activeScopeKey(sessionKey))
      result[p.id] = activeBubbleTextForPresence(
        p,
        state,
        Math.max(clockMs, crewStatusQuery.dataUpdatedAt),
      )
    }
    for (const peer of fleet) result[peer.id] = peer.bubble
    return result
  }, [clockMs, crewStatusQuery.dataUpdatedAt, fleet, presence, streamingState])

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
      } else if (p.activity?.at && now - p.activity.at <= 5 * 60_000) {
        // Real db activity only; older idle agents stay unset (no couch "away").
        result[p.id] = p.activity.at
      }
    }
    return result
  }, [presence])

  // #84 — feed events: one event per presence entry with recent activity
  const feedEvents = useMemo((): Array<Matrix3DFeedEvent> => {
    return presence
      .filter((p) => p.lastActivity && p.effectiveStatus === 'working')
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        name: p.name,
        text: p.lastActivity ?? '',
        ts: lastSeenByAgentId[p.id] ?? Date.now() - 5 * 60_000,
        kind: 'status' as const,
      }))
  }, [presence, lastSeenByAgentId])

  // #88 — progress per agent: only real gateway-reported progress, never guessed
  const progressByAgentId = useMemo(() => {
    const result: Record<string, number> = {}
    for (const p of presence) {
      const liveAgent = agentView.activeAgents.find(
        (a) => a.id === (p.activeSessionKey ?? p.id),
      )
      if (
        liveAgent &&
        typeof liveAgent.progress === 'number' &&
        liveAgent.progress > 0
      ) {
        result[p.id] = Math.min(100, Math.max(0, liveAgent.progress))
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
    agentSource:
      presence.length === 0 ? 'none' : hasLiveAgents ? 'live' : 'roster',
    presence,
    fleet,
    animationState,
    streamingTextByAgentId,
    monitorByAgentId,
    feedEvents,
    runCountByAgentId,
    lastSeenByAgentId,
    progressByAgentId,
  }
}
