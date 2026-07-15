import { extractToolEntries } from './components/v2/chat-tab-views-v2'
import type { Delegation } from '../../server/delegations'
import type { StreamingDelegation } from '../../stores/chat-store'
import type { ChatMessage } from './types'

export type ChatDelegationStatus = 'spawned' | 'running' | 'completed' | 'failed'

/** Merged card shape for the chat-delegations strip: one half from the
 * session-backed `Delegation` (#331), one half derived instantly from a
 * streaming `delegate_task` tool call, before the child session exists. */
export type ChatDelegationEntry = {
  id: string
  /** Empty until the backend child session shows up; enables the drill-in modal. */
  childSessionKey: string
  agentName: string
  label: string | null
  task: string | null
  status: ChatDelegationStatus
  startedAt: number
  endedAt: number | null
  elapsedMs: number
  tokenCount: number
  error: string | null
  parentId?: string
  depth?: number
  latestActivity?: string
  toolCount?: number
}

export function streamingDelegationToEntry(event: StreamingDelegation): ChatDelegationEntry {
  const completed = event.kind === 'complete' || event.status === 'completed'
  const failed = event.status === 'failed' || event.status === 'error'
  return {
    id: event.subagentId,
    childSessionKey: event.childSessionId ?? '',
    agentName: event.subagentId,
    label: event.model ?? null,
    task: event.goal ? truncate(event.goal, 140) : null,
    status: failed ? 'failed' : completed ? 'completed' : event.kind === 'start' ? 'spawned' : 'running',
    startedAt: event.firstSeenAt,
    endedAt: completed || failed ? event.lastSeenAt : null,
    elapsedMs: event.durationMs ?? Math.max(0, event.lastSeenAt - event.firstSeenAt),
    tokenCount: event.tokenCount ?? 0,
    error: failed ? event.summary ?? 'Delegation failed' : null,
    parentId: event.parentId,
    depth: event.depth,
    latestActivity: event.text ?? event.summary,
    toolCount: event.toolCount,
  }
}

function stripInternalContext(text: string): string {
  return text
    .replace(
      /<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>[\s\S]*?<<<END_OPENCLAW_INTERNAL_CONTEXT>>>/g,
      '',
    )
    .replace(
      /Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi,
      '',
    )
    .trim()
}

function truncate(value: string, max: number): string {
  const text = stripInternalContext(value)
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Session half: adapt a #331 `Delegation` (from `useDelegations`) into a card entry. */
export function delegationToEntry(
  delegation: Delegation,
  now: number = Date.now(),
): ChatDelegationEntry {
  const startedAt = delegation.startedAt ?? now
  const endedAt = delegation.status === 'running' ? null : (delegation.endedAt ?? startedAt)

  return {
    id: delegation.childSessionId,
    childSessionKey: delegation.childSessionId,
    agentName: 'sub-agent',
    label: delegation.model && delegation.model !== 'unknown' ? delegation.model : null,
    task: delegation.goal ? truncate(delegation.goal, 140) : null,
    status: delegation.status,
    startedAt,
    endedAt,
    elapsedMs: Math.max(0, (endedAt ?? now) - startedAt),
    tokenCount: delegation.inputTokens + delegation.outputTokens,
    error: delegation.status === 'failed' ? 'Delegation failed' : null,
  }
}

export type ChatDelegationToolCall = {
  id: string
  name: string
  phase: string
  args?: unknown
  preview?: string
  result?: string
}

/**
 * Derive delegate_task tool-call cards from the persisted transcript
 * (realtimeMessages), falling back to in-flight activeToolCalls for any
 * call not yet represented in the transcript. The transcript persists
 * through the delegation's visibility window; activeToolCalls is transient
 * and only present mid-stream — so a fast delegation that finishes before
 * the next poll no longer flashes and vanishes.
 */
export function extractDelegateTaskToolCalls(
  messages: Array<ChatMessage>,
  activeToolCalls: Array<ChatDelegationToolCall>,
): Array<ChatDelegationToolCall> {
  const persisted = extractToolEntries(messages)
    .filter((entry) => entry.name === 'delegate_task')
    .map((entry): ChatDelegationToolCall => ({
      id: entry.callId,
      name: 'delegate_task',
      phase:
        entry.output !== undefined
          ? entry.isError
            ? 'failed'
            : 'completed'
          : 'running',
      args: entry.input,
      result: entry.output,
    }))

  const seenIds = new Set(persisted.map((entry) => entry.id))
  const liveOnly = activeToolCalls.filter(
    (tc) => tc.name === 'delegate_task' && !seenIds.has(tc.id),
  )

  return [...persisted, ...liveOnly]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function firstString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return ''
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  const record = asRecord(args)
  if (record) return record
  if (typeof args === 'string' && args.trim().length > 0) {
    try {
      const parsed = JSON.parse(args) as unknown
      return asRecord(parsed) ?? {}
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeToolPhase(phase: string): ChatDelegationStatus {
  const normalized = phase.trim().toLowerCase()
  if (['calling', 'queued', 'pending', 'start', 'started'].includes(normalized)) {
    return 'spawned'
  }
  if (['done', 'complete', 'completed', 'result', 'success', 'succeeded'].includes(normalized)) {
    return 'completed'
  }
  if (['failed', 'failure', 'error'].includes(normalized)) return 'failed'
  return 'running'
}

function inferAgentFromToolArgs(args: Record<string, unknown>, preview: string): string {
  const explicit = firstString(
    args.agent,
    args.agentName,
    args.agent_name,
    args.assignee,
    args.profile,
    args.worker,
    args.role,
  )
  if (explicit) return explicit.toLowerCase()

  const context = firstString(args.context, args.prompt, args.goal, args.task, preview)
  const match = context.match(
    /\b(?:you\s+are|agent|profile|ask|delegate(?:\s+to)?)\s+([A-Za-z0-9_-]{2,32})\b/i,
  )
  return match?.[1]?.toLowerCase() || 'sub-agent'
}

/**
 * Tool-call half: derive spawned/running cards the instant a `delegate_task`
 * tool call appears in the streaming activity, before the backend session
 * shows up in `delegations`. Deduped against the session half by comparing
 * the leading task text — the child session's title is usually derived from
 * the same delegate_task goal.
 * ponytail: text-prefix dedupe, not an id join (no shared identity exists yet).
 */
export function buildToolCallChatDelegations(input: {
  toolCalls: Array<ChatDelegationToolCall>
  existingDelegations: Array<ChatDelegationEntry>
  now?: number
}): Array<ChatDelegationEntry> {
  const now = input.now ?? Date.now()
  return input.toolCalls
    .filter((toolCall) => toolCall.name === 'delegate_task')
    .map((toolCall) => {
      const args = parseToolArgs(toolCall.args)
      const preview = readText(toolCall.preview)
      const firstTask = asRecord(
        Array.isArray(args.tasks) ? args.tasks[0] : undefined,
      )
      const goal = firstString(
        args.goal,
        args.task,
        args.description,
        args.prompt,
        firstTask?.goal,
        firstTask?.task,
        firstTask?.description,
        preview,
      )
      const task = truncate(goal || preview || 'Delegate task', 140)
      const agentName = inferAgentFromToolArgs(args, `${preview}\n${task}`)
      const status = normalizeToolPhase(toolCall.phase)
      const isEnded = status === 'completed' || status === 'failed'
      const result = readText(toolCall.result)

      return {
        id: `tool-${toolCall.id}`,
        childSessionKey: '',
        agentName,
        label: firstString(args.label, args.name, args.title) || null,
        task,
        status,
        startedAt: now,
        endedAt: isEnded ? now : null,
        elapsedMs: 0,
        tokenCount: 0,
        error: status === 'failed' ? result || 'delegate_task failed' : null,
      } satisfies ChatDelegationEntry
    })
    .filter((entry) => !hasBackendEntryForTool(input.existingDelegations, entry))
}

function hasBackendEntryForTool(
  entries: Array<ChatDelegationEntry>,
  toolEntry: ChatDelegationEntry,
): boolean {
  if (entries.length === 0) return false
  const toolTask = (toolEntry.task || '').slice(0, 40).toLowerCase()
  if (!toolTask) return false
  return entries.some((entry) => {
    if (entry.status !== 'running' && entry.status !== 'spawned') return false
    return (entry.task || '').slice(0, 40).toLowerCase() === toolTask
  })
}

/** Merge both halves into one sorted list for the strip / tab. */
export function mergeChatDelegations(input: {
  delegations: Array<Delegation>
  toolCalls: Array<ChatDelegationToolCall>
  streamingDelegations?: Array<StreamingDelegation>
  now?: number
}): Array<ChatDelegationEntry> {
  const now = input.now ?? Date.now()
  const sessionEntries = input.delegations.map((d) => delegationToEntry(d, now))
  const eventEntries = (input.streamingDelegations ?? []).map(streamingDelegationToEntry)
  const toolEntries = buildToolCallChatDelegations({
    toolCalls: input.toolCalls,
    existingDelegations: [...eventEntries, ...sessionEntries],
    now,
  })
  const eventSessionIds = new Set(eventEntries.map((e) => e.childSessionKey).filter(Boolean))
  const unmatchedSessions = sessionEntries.filter((e) => !eventSessionIds.has(e.childSessionKey))
  return [...eventEntries, ...toolEntries, ...unmatchedSessions].sort((a, b) => b.startedAt - a.startedAt)
}

export function getVisibleChatDelegations(
  delegations: Array<ChatDelegationEntry>,
  _now: number = Date.now(),
): Array<ChatDelegationEntry> {
  return delegations.filter(
    (entry) => entry.status === 'running' || entry.status === 'spawned',
  )
}

export function formatDelegationElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.floor(ms))}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`
}
