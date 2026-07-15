import { create } from 'zustand'
import { isInternalSystemMessage } from '../screens/chat/internal-message-filter'
import {
  
  
  isRunPhaseBusy,
  reduceRunPhase
} from './run-phase'
import {
  clearQueuedMessages,
  clearRecoveryMessage as clearRecoveryMessageAdapter,
  persistRecoveryMessage as persistRecoveryMessageAdapter,
  persistStreamingState as persistStreamingStateAdapter,
  persistWaitingState,
  readQueuedMessages,
  removeStreamingState,
  removeWaitingState,
  restoreAllWaitingSessions,
  restoreRecoveryMessage,
  restoreStreamingState as restoreStreamingStateAdapter,
  writeQueuedMessages,
} from './run-persistence'
import type {RunPhase, RunPhaseTrigger} from './run-phase';
import type {
  ChatMessage,
  MessageContent,
  StreamingToolCall,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from '../screens/chat/types'
import type { ChatComposerAttachment } from '../screens/chat/components/chat-composer-types'

const MESSAGE_QUEUE_PREFIX = 'switchui:message-queue:'

/**
 * Per-session trailing-debounce timers for streaming-state persistence.
 * Streaming chunks arrive per-token; persisting (JSON.stringify +
 * sessionStorage.setItem) on every one is wasteful. We coalesce writes per
 * session and flush immediately at critical transitions (done / clearSession)
 * so recovery state is never stale. Keyed by sessionKey.
 */
export const STREAMING_PERSIST_DEBOUNCE_MS = 150
const _streamingPersistTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>()
const _streamingPersistPending = new Map<string, StreamingState>()

/** Schedule a trailing-debounced persist for a session's streaming state. */
function schedulePersistStreamingState(
  sessionKey: string,
  state: StreamingState,
): void {
  _streamingPersistPending.set(sessionKey, state)
  const existing = _streamingPersistTimers.get(sessionKey)
  if (existing) clearTimeout(existing)
  _streamingPersistTimers.set(
    sessionKey,
    setTimeout(() => {
      _streamingPersistTimers.delete(sessionKey)
      const pending = _streamingPersistPending.get(sessionKey)
      _streamingPersistPending.delete(sessionKey)
      if (pending) persistStreamingStateAdapter(sessionKey, pending)
    }, STREAMING_PERSIST_DEBOUNCE_MS),
  )
}

/** Cancel a pending debounced persist without flushing (state is being removed). */
function cancelPersistStreamingState(sessionKey: string): void {
  const existing = _streamingPersistTimers.get(sessionKey)
  if (existing) clearTimeout(existing)
  _streamingPersistTimers.delete(sessionKey)
  _streamingPersistPending.delete(sessionKey)
}

export type ChatStreamEvent =
  | {
      type: 'delegation'
      kind: string
      subagentId: string
      parentId?: string
      childSessionId?: string
      depth?: number
      goal?: string
      model?: string
      status?: string
      toolName?: string
      text?: string
      summary?: string
      toolCount?: number
      tokenCount?: number
      durationMs?: number
      runId?: string
      sessionKey: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'message'
      message: ChatMessage
      sessionKey: string
      runId?: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'chunk'
      text: string
      runId?: string
      sessionKey: string
      fullReplace?: boolean
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'thinking'
      text: string
      runId?: string
      sessionKey: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'tool'
      phase: string
      name: string
      toolCallId?: string
      args?: unknown
      preview?: string
      result?: string
      runId?: string
      sessionKey: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'done'
      state: string
      errorMessage?: string
      runId?: string
      sessionKey: string
      message?: ChatMessage
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'user_message'
      message: ChatMessage
      sessionKey: string
      source?: string
      runId?: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      type: 'status' | 'lifecycle'
      text: string
      sessionKey: string
      runId?: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      // Interactive clarify/interaction request (P3). The agent's turn is
      // BLOCKED waiting for the user's answer. Mirrors gateway
      // `clarify.request` and future `interaction.request` SSE events.
      type: 'clarify' | 'interaction'
      clarifyId: string
      interactionId?: string
      messageId?: string
      kind?: 'choice' | 'text' | 'approval' | string
      toolName?: string
      question: string
      /** Multiple-choice options, or null/empty for a free-text question. */
      choices?: Array<string> | null
      sessionKey: string
      runId?: string
      transport?: 'chat-events' | 'send-stream'
    }
  | {
      // Clarify/interaction resolved — marks the pending interaction answered.
      // Emitted from gateway `clarify.responded` and `interaction.responded`
      // SSE events, and used internally to optimistically mark after submit.
      type: 'clarify_resolved' | 'interaction_resolved'
      clarifyId: string
      interactionId?: string
      kind?: 'choice' | 'text' | 'approval' | string
      toolName?: string
      question?: string
      choices?: Array<string> | null
      answer?: string
      sessionKey: string
      runId?: string
      transport?: 'chat-events' | 'send-stream'
    }

export type StreamingState = {
  runId: string | null
  text: string
  thinking: string
  lifecycleEvents: Array<{
    text: string
    emoji: string
    timestamp: number
    isError: boolean
  }>
  toolCalls: Array<StreamingToolCall>
  delegations: Array<StreamingDelegation>
}

export type StreamingDelegation = Extract<ChatStreamEvent, { type: 'delegation' }> & {
  firstSeenAt: number
  lastSeenAt: number
}

export type QueuedChatMessage = {
  id: string
  text: string
  attachments: Array<ChatComposerAttachment>
}

/**
 * A pending interactive clarify request (P3). While present for a session, the
 * agent's turn is blocked waiting for the user's answer; the composer is
 * blocked and an inline clarify card is rendered. Cleared on `clarify_resolved`,
 * `done`/run completion, or `clearSession`.
 */
export type PendingClarify = {
  clarifyId: string
  interactionId?: string
  messageId?: string
  kind?: 'choice' | 'text' | 'approval' | string
  toolName?: string
  question: string
  choices: Array<string> | null
  runId: string | null
  requestedAt: number
  /**
   * Set once the user answers. The card stays mounted in a read-only
   * "answered" state showing the selected option (composer unblocks), and is
   * only removed when the next turn starts or the session is cleared.
   */
  resolved?: boolean
  /** The answer the user submitted (choice label or free text). */
  answer?: string
}

export type MessageQueueActivity = {
  phase: 'queued' | 'sending'
  item: QueuedChatMessage
  occurredAt: number
}

type ChatState = {
  /** Messages received via real-time stream, keyed by sessionKey */
  realtimeMessages: Map<string, Array<ChatMessage>>
  /** Current streaming state per session */
  streamingState: Map<string, StreamingState>
  /** Timestamp of last received event */
  lastEventAt: number
  /**
   * RunIds currently being handled by send-stream (the active send SSE).
   * Server-side dedup is the primary defense. This client-side set remains as
   * a fallback in case a stale event slips through after transport issues.
   */
  sendStreamRunIds: Set<string>
  /** Forward-send queue, keyed by sessionKey */
  messageQueue: Record<string, Array<QueuedChatMessage>>
  /** Recent queue activity, keyed by sessionKey, for visible queue feedback */
  messageQueueActivity: Record<string, MessageQueueActivity>

  /**
   * Pending interactive clarify request per session (P3). When set, the agent's
   * turn is blocked waiting for the user's answer; the composer is blocked and
   * the inline clarify card is rendered. Keyed by sessionKey.
   */
  pendingClarify: Record<string, PendingClarify | undefined>

  // Actions
  processEvent: (event: ChatStreamEvent) => void
  getRealtimeMessages: (sessionKey: string) => Array<ChatMessage>
  getStreamingState: (sessionKey: string) => StreamingState | null
  clearSession: (sessionKey: string) => void
  clearRealtimeBuffer: (sessionKey: string) => void
  clearStreamingSession: (sessionKey: string) => void
  clearAllStreaming: () => void
  mergeHistoryMessages: (
    sessionKey: string,
    historyMessages: Array<ChatMessage>,
  ) => Array<ChatMessage>
  /** Register a runId as being handled by send-stream — chat-events will skip it */
  registerSendStreamRun: (runId: string) => void
  /** Unregister a runId when send-stream completes */
  unregisterSendStreamRun: (runId: string) => void
  /** Check if a runId is being handled by send-stream */
  isSendStreamRun: (runId: string | undefined) => boolean
  /** Add a normal send payload to a session queue */
  enqueue: (sessionKey: string, item: QueuedChatMessage) => void
  /** Remove and return the oldest queued send for a session */
  dequeue: (sessionKey: string) => QueuedChatMessage | null
  /** Remove one queued send by id */
  removeQueued: (sessionKey: string, id: string) => void
  /** Clear all queued sends for a session */
  clearQueue: (sessionKey: string) => void

  /** Sessions currently waiting for a response — survives component unmount */
  waitingSessionKeys: Set<string>
  waitingSessionMeta: Record<
    string,
    { since: number; runId: string | null } | undefined
  >
  /** Mark a session as waiting for a response */
  setSessionWaiting: (sessionKey: string, runId?: string | null) => void
  /** Clear waiting state for a session */
  clearSessionWaiting: (sessionKey: string) => void
  /** Check if a session is waiting for a response */
  isSessionWaiting: (sessionKey: string) => boolean
  /** Read the pending interactive clarify for a session (or null). */
  getPendingClarify: (sessionKey: string) => PendingClarify | null
  /** Clear the pending clarify for a session (after answer/resolve/timeout). */
  clearPendingClarify: (sessionKey: string) => void
  /**
   * Optimistically mark a pending clarify as answered (keeps the card mounted
   * in its read-only "answered" state with the selected option). Called by the
   * card on submit; the gateway's `clarify.responded` SSE then confirms.
   */
  markClarifyResolved: (
    sessionKey: string,
    clarifyId: string,
    answer: string,
  ) => void
  /**
   * Remove a pending clarify ONLY if it has not been answered. Used on turn
   * end (`done`/`complete`/`error`) so a stale unanswered card is cleared but
   * an answered card persists for the visual record until the next turn.
   */
  dismissUnresolvedClarify: (sessionKey: string) => void
  /**
   * Sessions where the liveness snapshot is absent but the history predicate
   * (`hasUnansweredLatestUserTurn` + F1 guard) indicates a turn was likely
   * interrupted — shows the "Run lost — resend?" affordance. Distinct from
   * `waitingSessionKeys` (live run) and from idle (answered).
   */
  interruptedSessionKeys: Set<string>
  /** Mark a session as interrupted (recovery predicate fired, no live run) */
  setSessionInterrupted: (sessionKey: string) => void
  /** Clear interrupted state for a session */
  clearSessionInterrupted: (sessionKey: string) => void
  /** Check if a session is in the interrupted state */
  isSessionInterrupted: (sessionKey: string) => boolean

  /**
   * Layer 3 run-phase state machine (Track 2 / Phase 2.1). One phase per
   * session, driven by SSE events + liveness snapshot + active-send ref
   * ONLY — never by history shape (F2 fence).
   *
   * Drives `selectIsComposerBusy`, the sole composer busy signal in
   * `chat-screen.tsx` (Phase 2.2 cutover complete). The legacy 6-signal
   * `isChatRuntimeBusy` composition is no longer wired into the screen;
   * the function remains only for its parity test coverage.
   */
  runPhase: Map<string, RunPhase>
  /** Transition a session's run phase via the reducer (fence-enforced). */
  setRunPhase: (sessionKey: string, next: RunPhase, trigger: RunPhaseTrigger) => void
  /** Read the current run phase for a session (defaults to 'idle'). */
  getRunPhase: (sessionKey: string) => RunPhase
  /** True when the run phase is busy (sending or streaming). */
  isRunPhaseBusy: (sessionKey: string) => boolean
  /**
   * Phase 2.2 cutover selector (now the sole composer busy signal,
   * read reactively in `chat-screen.tsx`). Composes:
   *  - runPhase state machine (sending/streaming)
   *  - ref-based active-send (refSignal)
   *  - derived streaming signals (passed in from caller)
   *  - pending-send store (sending/pending generation)
   *
   * Returns true when the composer should be disabled.
   */
  selectIsComposerBusy: (
    sessionKey: string,
    refSignal: { hasActiveSend: boolean },
    derived: { activeIsRealtimeStreaming: boolean; derivedIsStreaming: boolean },
    pending: { hasPendingSend: boolean; hasPendingGeneration: boolean },
  ) => boolean
}

function isStreamingToolCall(value: unknown): value is StreamingToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.phase === 'string'
  )
}

function readStreamingToolCalls(value: unknown): Array<StreamingToolCall> {
  return Array.isArray(value) ? value.filter(isStreamingToolCall) : []
}

function getMessageAttachments(
  msg: ChatMessage | null | undefined,
): Array<Record<string, unknown>> {
  return Array.isArray(msg?.attachments)
    ? msg.attachments.map((attachment) => ({ ...attachment }))
    : []
}

function hasMessageAttachments(msg: ChatMessage | null | undefined): boolean {
  return Array.isArray(msg?.attachments) && msg.attachments.length > 0
}

const createEmptyStreamingState = (): StreamingState => ({
  runId: null,
  text: '',
  thinking: '',
  lifecycleEvents: [],
  toolCalls: [],
  delegations: [],
})

export function restoreStreamingState(
  sessionKey: string,
): StreamingState | null {
  return restoreStreamingStateAdapter(sessionKey) as StreamingState | null
}

export function persistRecoveryMessage(
  sessionKey: string,
  message: ChatMessage,
): void {
  persistRecoveryMessageAdapter(sessionKey, message)
}

export function readRecoveryMessage(sessionKey: string): ChatMessage | null {
  return restoreRecoveryMessage(sessionKey) as ChatMessage | null
}

export function clearRecoveryMessage(sessionKey: string): void {
  clearRecoveryMessageAdapter(sessionKey)
}

export function normalizeMessageQueueSessionKey(sessionKey: string): string {
  return normalizeString(sessionKey) || 'main'
}

function readQueuedMessagesAdapter(
  sessionKey: string,
): Array<QueuedChatMessage> {
  return readQueuedMessages<QueuedChatMessage>(sessionKey).filter(
    isQueuedChatMessage,
  )
}

function persistQueuedMessages(
  sessionKey: string,
  queue: Array<QueuedChatMessage>,
): void {
  if (queue.length === 0) {
    clearQueuedMessages(sessionKey)
    return
  }
  writeQueuedMessages(sessionKey, queue)
}

function restoreMessageQueues(): Record<string, Array<QueuedChatMessage>> {
  const restored: Record<string, Array<QueuedChatMessage>> = {}
  if (typeof sessionStorage === 'undefined') return restored

  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const storageKey = sessionStorage.key(i)
    if (!storageKey?.startsWith(MESSAGE_QUEUE_PREFIX)) continue

    const sessionKey = storageKey.slice(MESSAGE_QUEUE_PREFIX.length)
    const queue = readQueuedMessages<QueuedChatMessage>(sessionKey).filter(
      isQueuedChatMessage,
    )
    if (queue.length > 0) {
      restored[sessionKey] = queue
    } else {
      clearQueuedMessages(sessionKey)
    }
  }
  return restored
}

function isQueuedChatMessage(value: unknown): value is QueuedChatMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.trim().length > 0 &&
    typeof record.text === 'string' &&
    Array.isArray(record.attachments)
  )
}

function setQueueForSession(
  queues: Record<string, Array<QueuedChatMessage>>,
  sessionKey: string,
  queue: Array<QueuedChatMessage>,
): Record<string, Array<QueuedChatMessage>> {
  const next = { ...queues }
  if (queue.length === 0) {
    delete next[sessionKey]
  } else {
    next[sessionKey] = queue
  }
  return next
}

function setQueueActivityForSession(
  activity: Record<string, MessageQueueActivity>,
  sessionKey: string,
  nextActivity: MessageQueueActivity | null,
): Record<string, MessageQueueActivity> {
  const next = { ...activity }
  if (nextActivity) {
    next[sessionKey] = nextActivity
  } else {
    delete next[sessionKey]
  }
  return next
}

let realtimeMessageSequence = 0

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Strip <final>...</final> wrapper tags that the server emits as a
 * streaming-completion sentinel in agent chunk events.
 *
 * The server sometimes wraps the last streaming chunk (or a standalone
 * assistant-message event that fires before the formal `state: 'final'` chat
 * event) in <final>…</final> tags.  When the subsequent clean `done` event
 * arrives, the dedup logic compares its text against the already-stored tagged
 * version — they don't match — so BOTH messages end up in realtimeMessages and
 * appear side-by-side in the UI.
 *
 * Stripping these tags at the store boundary (before storing or comparing)
 * ensures the two copies are treated as the same message regardless of whether
 * the server included the sentinel tags or not.
 */
function stripFinalTags(text: string): string {
  // <final>…</final>  — strip outer wrapper (case-insensitive, allows whitespace)
  let result = text
    .replace(/^\s*<final>\s*([\s\S]*?)\s*<\/final>\s*$/i, '$1')
    .trim()
  // P7: strip internal model tags that should never appear in rendered output.
  // Matches chat UI's rg/ig/ag stripping functions.
  // Respects code blocks — only strip tags outside of ``` fences.
  result = stripInternalTags(result)
  return result
}

/**
 * Strip internal model tags (<thinking>, <antThinking>, <thought>,
 * <parameter name="newText">, <relevant_memories>) that can leak into
 * displayed text. Only strips outside code blocks to avoid breaking code samples.
 * Mirrors the chat control UI's tag-stripping pipeline.
 */
function stripInternalTags(text: string): string {
  // Split on code blocks to avoid stripping inside them
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part // inside code block — leave untouched
      return part
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<antThinking>[\s\S]*?<\/antThinking>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<parameter name="newText">[\s\S]*?<\/antml:parameter>/gi, '')
        .replace(/<relevant_memories>[\s\S]*?<\/relevant_memories>/gi, '')
        .trim()
    })
    .join('')
}

const LIFECYCLE_PREFIX_EMOJIS = ['⏳', '⚠️', '🔄', '🗜️', '❌'] as const

function parseLifecycleEvent(
  text: string,
  timestamp: number,
): {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
} {
  const trimmed = text.trim()
  const matchedEmoji =
    LIFECYCLE_PREFIX_EMOJIS.find((emoji) => trimmed.startsWith(emoji)) ?? ''
  const normalizedText = matchedEmoji
    ? trimmed.slice(matchedEmoji.length).trimStart()
    : trimmed
  const lowerText = normalizedText.toLowerCase()
  const isError =
    matchedEmoji === '❌' ||
    matchedEmoji === '⚠️' ||
    lowerText.includes('error') ||
    lowerText.includes('failed')

  return {
    text: normalizedText || trimmed,
    emoji: matchedEmoji,
    timestamp,
    isError,
  }
}

/**
 * Return a copy of `msg` with <final>...</final> tags stripped from all text
 * content blocks.  Other content types (thinking, toolCall, etc.) are left
 * untouched.  If the message has no text content the original object is
 * returned as-is so we don't allocate unnecessarily.
 */
function stripFinalTagsFromMessage(msg: ChatMessage): ChatMessage {
  let modified = false
  const rawMessage = msg as Record<string, unknown>
  const nextMessage: ChatMessage & Record<string, unknown> = { ...msg }

  if (Array.isArray(msg.content)) {
    const nextContent = msg.content.map((part) => {
      if (part.type !== 'text') return part
      const raw = part.text ?? ''
      const stripped = stripFinalTags(
        typeof raw === 'string' ? raw : String(raw),
      )
      if (stripped === raw) return part
      modified = true
      return { ...part, text: stripped }
    })
    nextMessage.content = nextContent
  }

  for (const key of ['text', 'body', 'message'] as const) {
    const value = rawMessage[key]
    if (typeof value !== 'string') continue
    const stripped = stripFinalTags(value)
    if (stripped === value) continue
    nextMessage[key] = stripped
    modified = true
  }

  if (!modified) return msg
  return nextMessage
}

function getMessageId(msg: ChatMessage | null | undefined): string | undefined {
  if (!msg) return undefined
  const id = msg.id
  if (typeof id === 'string' && id.trim().length > 0) return id
  const messageId = msg.messageId
  if (typeof messageId === 'string' && messageId.trim().length > 0)
    return messageId
  return undefined
}

function getClientNonce(msg: ChatMessage | null | undefined): string {
  if (!msg) return ''
  const raw = msg as Record<string, unknown>
  return (
    normalizeString(msg.clientId) ||
    normalizeString(msg.client_id) ||
    normalizeString(msg.nonce) ||
    normalizeString(msg.idempotencyKey)
  )
}

/**
 * Cache of derived event time per message object. The comparator
 * (`compareMessagesByTime`) calls `getMessageEventTime` O(n log n) times during
 * a sort, and the string branch runs `Date.parse` on every call. Message time
 * fields are immutable after creation, so memoizing by object identity is safe
 * and removes the repeated parse from the sort hot path. `null` is the cached
 * sentinel for "no derivable time".
 */
const _eventTimeCache = new WeakMap<object, number | null>()

function getMessageEventTime(
  msg: ChatMessage | null | undefined,
): number | undefined {
  if (!msg) return undefined
  const cached = _eventTimeCache.get(msg)
  if (cached !== undefined) return cached ?? undefined
  let resolved: number | null = null
  for (const key of ['createdAt', 'timestamp'] as const) {
    const value = msg[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      resolved = value
      break
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) {
        resolved = parsed
        break
      }
    }
  }
  _eventTimeCache.set(msg, resolved)
  return resolved ?? undefined
}

function getMessageReceiveTime(
  msg: ChatMessage | null | undefined,
): number | undefined {
  if (!msg) return undefined
  const value = msg.__receiveTime
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getMessageHistoryIndex(
  msg: ChatMessage | null | undefined,
): number | undefined {
  if (!msg) return undefined
  const value = msg.__historyIndex ?? msg.historyIndex
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getMessageRealtimeSequence(
  msg: ChatMessage | null | undefined,
): number | undefined {
  if (!msg) return undefined
  const value = msg.__realtimeSequence
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function hasToolCalls(msg: ChatMessage | null | undefined): boolean {
  if (!msg) return false
  if (Array.isArray(msg.content)) {
    const contentHasToolCalls = msg.content.some(
      (part) => part.type === 'toolCall',
    )
    if (contentHasToolCalls) return true
  }

  return (
    readStreamingToolCalls(msg.streamToolCalls).length > 0 ||
    readStreamingToolCalls(msg.__streamToolCalls).length > 0
  )
}

function getMessageChronologyRank(msg: ChatMessage): number {
  const role = normalizeString(msg.role).toLowerCase()
  if (role === 'user') return 0
  if (role === 'assistant' && hasToolCalls(msg)) return 1
  if (role === 'tool' || role === 'toolresult' || role === 'tool_result')
    return 2
  if (role === 'assistant') return 3
  return 4
}

function compareMessagesByTime(left: ChatMessage, right: ChatMessage): number {
  const leftTime = getMessageEventTime(left) ?? getMessageReceiveTime(left) ?? 0
  const rightTime =
    getMessageEventTime(right) ?? getMessageReceiveTime(right) ?? 0
  if (leftTime !== rightTime) return leftTime - rightTime

  const leftHistoryIndex = getMessageHistoryIndex(left)
  const rightHistoryIndex = getMessageHistoryIndex(right)
  if (
    leftHistoryIndex !== undefined &&
    rightHistoryIndex !== undefined &&
    leftHistoryIndex !== rightHistoryIndex
  ) {
    return leftHistoryIndex - rightHistoryIndex
  }

  const leftRank = getMessageChronologyRank(left)
  const rightRank = getMessageChronologyRank(right)
  if (leftRank !== rightRank) return leftRank - rightRank

  const leftRealtimeSequence = getMessageRealtimeSequence(left)
  const rightRealtimeSequence = getMessageRealtimeSequence(right)
  if (
    leftRealtimeSequence !== undefined &&
    rightRealtimeSequence !== undefined &&
    leftRealtimeSequence !== rightRealtimeSequence
  ) {
    return leftRealtimeSequence - rightRealtimeSequence
  }

  const leftId = getMessageId(left) ?? ''
  const rightId = getMessageId(right) ?? ''
  return leftId.localeCompare(rightId)
}

function sortMessagesChronologically(
  messages: Array<ChatMessage>,
): Array<ChatMessage> {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const byTime = compareMessagesByTime(left.message, right.message)
      if (byTime !== 0) return byTime
      return left.index - right.index
    })
    .map(({ message }) => message)
}

/**
 * Append `incoming` to `sessionMessages`, re-sorting ONLY when the new message
 * lands out-of-order relative to the current last element. Messages arrive
 * nearly in-order over SSE, so the common path is a pure push (no map→sort→map
 * over the whole array with its multi-fallback comparator).
 *
 * Ordering semantics are identical to calling `sortMessagesChronologically`
 * on the appended array: when the incoming message sorts at-or-after the
 * current tail (`compareMessagesByTime(last, incoming) <= 0`), a stable sort
 * would leave it at the end anyway, so we skip the sort. Otherwise we fall back
 * to the full chronological sort.
 *
 * `sessionMessages` is mutated in place (it is already a fresh copy at every
 * call site) and the resulting array is returned.
 */
function appendMessageOrdered(
  sessionMessages: Array<ChatMessage>,
  incoming: ChatMessage,
): Array<ChatMessage> {
  const last =
    sessionMessages.length > 0
      ? sessionMessages[sessionMessages.length - 1]
      : undefined
  sessionMessages.push(incoming)
  if (last && compareMessagesByTime(last, incoming) > 0) {
    return sortMessagesChronologically(sessionMessages)
  }
  return sessionMessages
}

function isExternalInboundUserSource(source: unknown): boolean {
  const normalized = normalizeString(source).toLowerCase()
  return (
    normalized === 'webchat' ||
    normalized === 'signal' ||
    normalized === 'telegram'
  )
}

function getAttachmentSignature(msg: ChatMessage | null | undefined): string {
  const attachments = getMessageAttachments(msg)
  if (attachments.length === 0) return ''
  return attachments
    .map((attachment) => {
      return `${normalizeString(attachment.name)}:${String(attachment.size ?? '')}`
    })
    .sort()
    .join('|')
}

function isOptimisticUserCandidate(
  msg: ChatMessage | null | undefined,
): boolean {
  if (!msg || msg.role !== 'user') return false
  return (
    normalizeString(msg.__optimisticId).length > 0 ||
    ['sending', 'queued', 'sent', 'done'].includes(normalizeString(msg.status))
  )
}

function messageMultipartSignature(
  msg: ChatMessage | null | undefined,
): string {
  if (!msg) return ''
  let content = Array.isArray(msg.content)
    ? msg.content
        .map((part) => {
          if (part.type === 'text') return `t:${String(part.text ?? '').trim()}`
          if (part.type === 'thinking')
            return `h:${String(part.thinking ?? '').trim()}`
          if (part.type === 'toolCall')
            return `tc:${String(part.id ?? '')}:${String(part.name ?? '')}`
          return `p:${String(part.type)}`
        })
        .join('|')
    : ''
  // Fallback: if content array is empty/missing, check top-level text fields
  // so that legacy-format messages still produce a meaningful signature.
  if (!content) {
    const raw = msg as Record<string, unknown>
    for (const key of ['text', 'body', 'message']) {
      const val = raw[key]
      if (typeof val === 'string' && val.trim().length > 0) {
        content = `t:${stripFinalTags(val.trim())}`
        break
      }
    }
  }
  const attachments = getMessageAttachments(msg)
    .map(
      (attachment) =>
        `${String(attachment.name ?? '')}:${String(attachment.size ?? '')}:${String(attachment.contentType ?? '')}`,
    )
    .join('|')
  return `${msg.role ?? 'unknown'}:${content}:${attachments}`
}

const _restoredWaiting = restoreAllWaitingSessions()
const _restoredQueues = restoreMessageQueues()

export const useChatStore = create<ChatState>((set, get) => ({
  realtimeMessages: new Map(),
  streamingState: new Map(),
  lastEventAt: 0,
  sendStreamRunIds: new Set(),
  messageQueue: _restoredQueues,
  messageQueueActivity: {},
  pendingClarify: {},
  waitingSessionKeys: _restoredWaiting.keys,
  waitingSessionMeta: _restoredWaiting.meta,
  interruptedSessionKeys: new Set(),
  runPhase: new Map(),

  registerSendStreamRun: (runId) => {
    const next = new Set(get().sendStreamRunIds)
    next.add(runId)
    set({ sendStreamRunIds: next })
  },

  unregisterSendStreamRun: (runId) => {
    const next = new Set(get().sendStreamRunIds)
    next.delete(runId)
    set({ sendStreamRunIds: next })
  },

  isSendStreamRun: (runId) => {
    if (!runId) return false
    return get().sendStreamRunIds.has(runId)
  },

  enqueue: (sessionKey, item) => {
    const key = normalizeMessageQueueSessionKey(sessionKey)
    const current = get().messageQueue[key] ?? readQueuedMessages(key)
    const nextQueue = [...current, item]
    persistQueuedMessages(key, nextQueue)
    set((state) => ({
      messageQueue: setQueueForSession(state.messageQueue, key, nextQueue),
      messageQueueActivity: setQueueActivityForSession(
        state.messageQueueActivity,
        key,
        {
          phase: 'queued',
          item,
          occurredAt: Date.now(),
        },
      ),
    }))
  },

  dequeue: (sessionKey) => {
    const key = normalizeMessageQueueSessionKey(sessionKey)
    const current = get().messageQueue[key] ?? readQueuedMessages(key)
    if (current.length === 0) return null
    const [nextItem, ...remaining] = current
    persistQueuedMessages(key, remaining)
    set((state) => ({
      messageQueue: setQueueForSession(state.messageQueue, key, remaining),
      messageQueueActivity: setQueueActivityForSession(
        state.messageQueueActivity,
        key,
        {
          phase: 'sending',
          item: nextItem,
          occurredAt: Date.now(),
        },
      ),
    }))
    return nextItem
  },

  removeQueued: (sessionKey, id) => {
    const key = normalizeMessageQueueSessionKey(sessionKey)
    const current = get().messageQueue[key] ?? readQueuedMessages(key)
    const nextQueue = current.filter((item) => item.id !== id)
    persistQueuedMessages(key, nextQueue)
    set((state) => ({
      messageQueue: setQueueForSession(state.messageQueue, key, nextQueue),
      messageQueueActivity:
        nextQueue.length === 0
          ? setQueueActivityForSession(state.messageQueueActivity, key, null)
          : state.messageQueueActivity,
    }))
  },

  clearQueue: (sessionKey) => {
    const key = normalizeMessageQueueSessionKey(sessionKey)
    persistQueuedMessages(key, [])
    set((state) => ({
      messageQueue: setQueueForSession(state.messageQueue, key, []),
      messageQueueActivity: setQueueActivityForSession(
        state.messageQueueActivity,
        key,
        null,
      ),
    }))
  },

  setSessionWaiting: (sessionKey, runId) => {
    const meta = {
      since: get().waitingSessionMeta[sessionKey]?.since ?? Date.now(),
      runId: runId ?? null,
    }
    const nextKeys = new Set(get().waitingSessionKeys)
    nextKeys.add(sessionKey)
    const nextMeta = { ...get().waitingSessionMeta, [sessionKey]: meta }
    persistWaitingState(sessionKey, meta)
    set({ waitingSessionKeys: nextKeys, waitingSessionMeta: nextMeta })
    get().setRunPhase(sessionKey, 'streaming', 'liveness-snapshot')
  },

  clearSessionWaiting: (sessionKey) => {
    const nextKeys = new Set(get().waitingSessionKeys)
    nextKeys.delete(sessionKey)
    const { [sessionKey]: _, ...nextMeta } = get().waitingSessionMeta
    removeWaitingState(sessionKey)
    set({ waitingSessionKeys: nextKeys, waitingSessionMeta: nextMeta })
    get().setRunPhase(sessionKey, 'idle', 'liveness-clear')
  },

  isSessionWaiting: (sessionKey) => {
    return get().waitingSessionKeys.has(sessionKey)
  },

  getPendingClarify: (sessionKey) => {
    return get().pendingClarify[sessionKey] ?? null
  },

  clearPendingClarify: (sessionKey) => {
    const current = get().pendingClarify
    if (!current[sessionKey]) return
    const next = { ...current }
    delete next[sessionKey]
    set({ pendingClarify: next })
  },

  markClarifyResolved: (sessionKey, clarifyId, answer) => {
    const current = get().pendingClarify[sessionKey]
    if (!current) return
    if (clarifyId && current.clarifyId !== clarifyId) return
    set({
      pendingClarify: {
        ...get().pendingClarify,
        [sessionKey]: {
          ...current,
          resolved: true,
          answer: answer.trim() || current.answer,
        },
      },
    })
  },

  dismissUnresolvedClarify: (sessionKey) => {
    const current = get().pendingClarify
    const entry = current[sessionKey]
    // Keep answered cards (visual record); only drop stale unanswered ones.
    if (!entry || entry.resolved) return
    const next = { ...current }
    delete next[sessionKey]
    set({ pendingClarify: next })
  },

  setSessionInterrupted: (sessionKey) => {
    const nextKeys = new Set(get().interruptedSessionKeys)
    nextKeys.add(sessionKey)
    set({ interruptedSessionKeys: nextKeys })
    get().setRunPhase(sessionKey, 'interrupted', 'predicate-clear')
  },

  clearSessionInterrupted: (sessionKey) => {
    const nextKeys = new Set(get().interruptedSessionKeys)
    nextKeys.delete(sessionKey)
    set({ interruptedSessionKeys: nextKeys })
    get().setRunPhase(sessionKey, 'idle', 'predicate-clear')
  },

  isSessionInterrupted: (sessionKey) => {
    return get().interruptedSessionKeys.has(sessionKey)
  },

  setRunPhase: (sessionKey, next, trigger) => {
    const current = get().runPhase.get(sessionKey) ?? 'idle'
    const resolved = reduceRunPhase(current, next, trigger)
    if (resolved === null) {
      // Fence guard: a caller tried an illegal transition (e.g. predicate
      // → streaming). Log for observability and drop. See run-phase.ts.
      return
    }
    if (resolved === current) return
    const nextMap = new Map(get().runPhase)
    nextMap.set(sessionKey, resolved)
    set({ runPhase: nextMap })
  },

  getRunPhase: (sessionKey) => {
    return get().runPhase.get(sessionKey) ?? 'idle'
  },

  isRunPhaseBusy: (sessionKey) => {
    return isRunPhaseBusy(get().runPhase.get(sessionKey) ?? 'idle')
  },

  selectIsComposerBusy: (sessionKey, refSignal, derived, pending) => {
    const phaseBusy = isRunPhaseBusy(get().runPhase.get(sessionKey) ?? 'idle')
    return (
      phaseBusy ||
      refSignal.hasActiveSend ||
      derived.activeIsRealtimeStreaming ||
      derived.derivedIsStreaming ||
      pending.hasPendingSend ||
      pending.hasPendingGeneration
    )
  },

  processEvent: (event) => {
    const state = get()
    const sessionKey = event.sessionKey
    const now = Date.now()

    // Skip ALL events for runs being handled by send-stream.
    // send-stream is the authoritative handler for active sends — chat-events
    // fires the same events in parallel, causing duplicate messages.
    // Previously only covered chunk/thinking/tool/done — missing 'message'
    // was the root cause of the persistent duplication bug.
    if (
      event.transport !== 'send-stream' &&
      event.runId &&
      get().sendStreamRunIds.has(event.runId)
    ) {
      return
    }

    switch (event.type) {
      case 'clarify':
      case 'interaction': {
        // Interactive clarify request (P3). Store the pending clarify so the
        // inline card renders and the composer blocks. The agent's turn is
        // blocked until the user answers (or the run ends).
        const question = event.question.trim()
        if (!question) break
        const choices =
          Array.isArray(event.choices) && event.choices.length > 0
            ? event.choices.filter(
                (c): c is string => typeof c === 'string' && c.length > 0,
              )
            : null
        const current = state.pendingClarify[sessionKey]
        const eventId = event.clarifyId || event.interactionId || ''
        const sameInteraction = Boolean(
          current &&
          eventId &&
          (current.clarifyId === eventId || current.interactionId === eventId),
        )
        set({
          pendingClarify: {
            ...state.pendingClarify,
            [sessionKey]: {
              clarifyId: event.clarifyId || event.interactionId || current?.clarifyId || '',
              interactionId: event.interactionId || event.clarifyId || current?.interactionId,
              messageId: event.messageId || (sameInteraction ? current?.messageId : undefined),
              kind: event.kind || (sameInteraction ? current?.kind : undefined),
              toolName: event.toolName || (sameInteraction ? current?.toolName : undefined) || 'clarify',
              question: question || (sameInteraction ? current?.question : ''),
              choices: choices ?? (sameInteraction ? current?.choices ?? null : null),
              runId: event.runId ?? null,
              requestedAt: now,
            },
          },
        })
        break
      }
      case 'clarify_resolved':
      case 'interaction_resolved': {
        // Answer accepted — mark the pending clarify as resolved (rather than
        // deleting it) so the card stays mounted in a read-only "answered"
        // state showing the selected option. The composer un-blocks on
        // `resolved`, and the entry is removed when the next turn starts
        // (`started`) or the session is cleared. The agent's turn resumes.
        const current = state.pendingClarify[sessionKey]
        if (!current) break
        // If a clarifyId is provided, only act on the matching one (guards
        // against a stale resolve for a superseded clarify).
        const eventId = event.clarifyId || event.interactionId || ''
        if (
          eventId &&
          current.clarifyId !== eventId &&
          current.interactionId !== eventId
        ) {
          break
        }
        set({
          pendingClarify: {
            ...state.pendingClarify,
            [sessionKey]: {
              ...current,
              clarifyId: current.clarifyId || event.clarifyId,
              interactionId: current.interactionId || event.interactionId,
              kind: current.kind || event.kind,
              toolName: current.toolName || event.toolName,
              question: event.question?.trim() || current.question,
              choices: event.choices ?? current.choices,
              resolved: true,
              answer: event.answer?.trim() || current.answer,
            },
          },
        })
        break
      }
      case 'message':
      case 'user_message': {
        // Filter internal system event messages that should never appear in chat.
        // These are pre-compaction flushes, heartbeat prompts, and similar
        // server-injected control messages — mirror the filter in use-chat-history.ts.
        if (event.message.role === 'user') {
          const rawText = extractMessageText(event.message)
          if (isInternalSystemMessage(rawText)) {
            break
          }
        }

        const messages = new Map(state.realtimeMessages)
        const sessionMessages = [...(messages.get(sessionKey) ?? [])]
        const incomingReceiveTime = now

        // Strip <final>…</final> sentinel tags from assistant messages before
        // storing or comparing.  The server can emit a bare assistant-message
        // event (state=undefined) whose text is still wrapped in these tags,
        // and the subsequent clean `done` event then fails the dedup check
        // because the stored text differs from the final text.
        const normalizedMessage =
          event.message.role === 'assistant'
            ? stripFinalTagsFromMessage(event.message)
            : event.message

        const newId = getMessageId(normalizedMessage)
        const newClientNonce = getClientNonce(normalizedMessage)
        const newMultipartSignature =
          messageMultipartSignature(normalizedMessage)

        const optimisticIndexByNonce =
          newClientNonce.length > 0
            ? sessionMessages.findIndex((existing) => {
                if (existing.role !== normalizedMessage.role) return false
                const existingNonce = getClientNonce(existing)
                if (
                  existingNonce.length === 0 ||
                  existingNonce !== newClientNonce
                ) {
                  return false
                }
                return (
                  normalizeString(existing.status) === 'sending' ||
                  Boolean(existing.__optimisticId)
                )
              })
            : -1

        const optimisticIndex =
          optimisticIndexByNonce >= 0
            ? optimisticIndexByNonce
            : normalizedMessage.role === 'user'
              ? sessionMessages.findIndex((existing) => {
                  if (existing.role !== 'user') return false
                  if (!isOptimisticUserCandidate(existing)) return false
                  const existingText = extractMessageText(existing)
                  const incomingText = extractMessageText(normalizedMessage)
                  if (
                    existingText &&
                    incomingText &&
                    existingText === incomingText
                  ) {
                    return true
                  }
                  const existingAttachments = getAttachmentSignature(existing)
                  const incomingAttachments =
                    getAttachmentSignature(normalizedMessage)
                  return (
                    existingText.length === 0 &&
                    incomingText.length === 0 &&
                    existingAttachments.length > 0 &&
                    existingAttachments === incomingAttachments
                  )
                })
              : -1

        // Plain-text extraction for content-based dedup (catches identical
        // replies that arrive with different IDs from different channels).
        const newPlainText = extractMessageText(normalizedMessage)
        const isExternalInboundUser =
          normalizedMessage.role === 'user' &&
          isExternalInboundUserSource(
            event.type === 'user_message' ? event.source : undefined,
          )
        const incomingEventTime =
          getMessageEventTime(normalizedMessage) ?? incomingReceiveTime

        const duplicateIndex = sessionMessages.findIndex((existing) => {
          if (existing.role !== normalizedMessage.role) return false
          const existingId = getMessageId(existing)
          if (newId && existingId && newId === existingId) return true

          const existingNonce = getClientNonce(existing)
          if (
            newClientNonce &&
            existingNonce &&
            newClientNonce === existingNonce
          ) {
            return true
          }

          if (
            newMultipartSignature.length > 0 &&
            newMultipartSignature === messageMultipartSignature(existing)
          ) {
            return true
          }

          // Content-text dedup: identical assistant text within the same
          // session should never appear twice, even if message IDs differ
          // (e.g. same reply routed from Telegram + Hermes Switch UI).
          if (
            normalizedMessage.role === 'assistant' &&
            newPlainText.length > 20 &&
            newPlainText === extractMessageText(existing)
          ) {
            return true
          }

          return false
        })

        // Mark user messages from external sources
        const incomingMessage: ChatMessage = {
          ...normalizedMessage,
          __realtimeSource:
            event.type === 'user_message' ? event.source : undefined,
          __receiveTime: incomingReceiveTime,
          __realtimeSequence: realtimeMessageSequence++,
          status: undefined,
        }

        if (optimisticIndex >= 0) {
          const optimisticMessage = sessionMessages[optimisticIndex]
          const incomingText = extractMessageText(incomingMessage)
          const optimisticText = extractMessageText(optimisticMessage)
          const incomingHasAttachments = hasMessageAttachments(incomingMessage)
          const optimisticHasAttachments =
            hasMessageAttachments(optimisticMessage)

          sessionMessages[optimisticIndex] = {
            ...optimisticMessage,
            ...incomingMessage,
            content:
              incomingText.length > 0 || !optimisticText.length
                ? incomingMessage.content
                : optimisticMessage.content,
            attachments:
              incomingHasAttachments || !optimisticHasAttachments
                ? incomingMessage.attachments
                : optimisticMessage.attachments,
            __optimisticId: undefined,
            status: undefined,
          }
          messages.set(sessionKey, sortMessagesChronologically(sessionMessages))
          set({ realtimeMessages: messages, lastEventAt: now })
          break
        }

        const hasRecentExternalDuplicate =
          isExternalInboundUser &&
          newPlainText.length > 0 &&
          sessionMessages.some((existing) => {
            if (existing.role !== 'user') return false
            if (extractMessageText(existing) !== newPlainText) return false
            const existingEventTime =
              getMessageEventTime(existing) ?? getMessageReceiveTime(existing)
            if (existingEventTime === undefined) return false
            return Math.abs(incomingEventTime - existingEventTime) <= 10_000
          })

        if (hasRecentExternalDuplicate) {
          break
        }

        if (duplicateIndex === -1) {
          messages.set(
            sessionKey,
            appendMessageOrdered(sessionMessages, incomingMessage),
          )
          set({ realtimeMessages: messages, lastEventAt: now })
        }
        break
      }

      case 'chunk': {
        const streamingMap = new Map(state.streamingState)
        const prev = streamingMap.get(sessionKey) ?? createEmptyStreamingState()

        // Server sends full accumulated text with fullReplace=true
        // Replace entire text (default), or append if fullReplace is explicitly false
        const next: StreamingState = {
          ...prev,
          text: stripFinalTags(
            event.fullReplace === false ? prev.text + event.text : event.text,
          ),
          runId: event.runId ?? prev.runId,
        }

        streamingMap.set(sessionKey, next)
        set({ streamingState: streamingMap, lastEventAt: now })
        schedulePersistStreamingState(sessionKey, next)

        break
      }

      case 'thinking': {
        const streamingMap = new Map(state.streamingState)
        const prev = streamingMap.get(sessionKey) ?? createEmptyStreamingState()
        const next: StreamingState = {
          ...prev,
          thinking: event.text,
          runId: event.runId ?? prev.runId,
        }

        streamingMap.set(sessionKey, next)
        set({ streamingState: streamingMap, lastEventAt: now })
        schedulePersistStreamingState(sessionKey, next)
        break
      }

      case 'status':
      case 'lifecycle': {
        const streamingMap = new Map(state.streamingState)
        const prev = streamingMap.get(sessionKey) ?? createEmptyStreamingState()
        const next: StreamingState = {
          ...prev,
          runId: event.runId ?? prev.runId,
          lifecycleEvents: [
            ...prev.lifecycleEvents,
            parseLifecycleEvent(event.text, now),
          ],
        }

        streamingMap.set(sessionKey, next)
        set({ streamingState: streamingMap, lastEventAt: now })
        schedulePersistStreamingState(sessionKey, next)
        break
      }

      case 'tool': {
        const streamingMap = new Map(state.streamingState)
        const prev = streamingMap.get(sessionKey) ?? createEmptyStreamingState()

        const toolCallId =
          event.toolCallId ??
          `${event.name || 'tool'}-${event.runId || sessionKey}-${prev.toolCalls.length}`
        const existingToolIndex = prev.toolCalls.findIndex(
          (tc) => tc.id === toolCallId,
        )

        const nextToolCalls = [...prev.toolCalls]

        if (existingToolIndex >= 0) {
          nextToolCalls[existingToolIndex] = {
            ...nextToolCalls[existingToolIndex],
            phase: event.phase,
            args: event.args ?? nextToolCalls[existingToolIndex].args,
            preview: event.preview ?? nextToolCalls[existingToolIndex].preview,
            result: event.result ?? nextToolCalls[existingToolIndex].result,
          }
        } else {
          // Create entry for ANY phase (complete, error, skill.loaded, artifact.created, etc.)
          // Events like skill.loaded arrive with phase 'complete' and no prior 'start' — create them too
          nextToolCalls.push({
            id: toolCallId,
            name: event.name,
            phase: event.phase,
            args: event.args,
            preview: event.preview,
            result: event.result,
            firstSeenAt: now,
          })
        }

        const next: StreamingState = {
          ...prev,
          runId: event.runId ?? prev.runId,
          toolCalls: nextToolCalls,
        }

        streamingMap.set(sessionKey, next)
        set({ streamingState: streamingMap, lastEventAt: now })
        schedulePersistStreamingState(sessionKey, next)
        break
      }

      case 'delegation': {
        const streamingMap = new Map(state.streamingState)
        const prev = streamingMap.get(sessionKey) ?? createEmptyStreamingState()
        const index = prev.delegations.findIndex((d) => d.subagentId === event.subagentId)
        const current = index >= 0 ? prev.delegations[index] : undefined
        const delegation: StreamingDelegation = {
          ...current,
          ...event,
          firstSeenAt: current?.firstSeenAt ?? now,
          lastSeenAt: now,
        }
        const delegations = [...prev.delegations]
        if (index >= 0) delegations[index] = delegation
        else delegations.push(delegation)
        const next = { ...prev, runId: event.runId ?? prev.runId, delegations }
        streamingMap.set(sessionKey, next)
        set({ streamingState: streamingMap, lastEventAt: now })
        schedulePersistStreamingState(sessionKey, next)
        break
      }

      case 'done': {
        const streamingMap = new Map(state.streamingState)
        const streaming = streamingMap.get(sessionKey)

        // Build the complete message — prefer authoritative final payload (bug #8 fix)
        let completeMessage: ChatMessage | null = null

        if (event.message) {
          // Prefer done event's message payload — it's the authoritative final response.
          // Strip <final>…</final> sentinel tags: the `done` message may still carry
          // them if the server serialises the final state from its streaming buffer.
          const cleanedMessage = ensureAssistantTextContent(
            stripFinalTagsFromMessage(event.message),
          )
          // Preserve tool calls from streaming state on the final message so
          // ToolCallPill can render them even after streaming state is cleared.
          // Fast tool runs clear streaming state before React renders — embedding
          // __streamToolCalls ensures pills survive in the history message.
          const streamToolCallsToEmbed =
            streaming && streaming.toolCalls.length > 0
              ? streaming.toolCalls
              : undefined
          completeMessage = {
            ...cleanedMessage,
            timestamp: getMessageEventTime(cleanedMessage) ?? now,
            __receiveTime: now,
            __realtimeSequence: realtimeMessageSequence++,
            __streamingStatus:
              event.state === 'interrupted' ? 'interrupted' : 'complete',
            ...(streamToolCallsToEmbed
              ? { __streamToolCalls: streamToolCallsToEmbed }
              : {}),
          }
        } else if (streaming && streaming.text) {
          // Fallback: build from streaming state if no final payload.
          // Strip any <final> tags that may have accumulated in the stream buffer.
          const cleanStreamText = stripFinalTags(streaming.text)
          const content: Array<MessageContent> = []

          if (streaming.thinking) {
            content.push({
              type: 'thinking',
              thinking: streaming.thinking,
            })
          }

          if (cleanStreamText) {
            content.push({
              type: 'text',
              text: cleanStreamText,
            })
          }

          for (const toolCall of streaming.toolCalls) {
            content.push({
              type: 'toolCall',
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.args as Record<string, unknown> | undefined,
            })
          }

          completeMessage = {
            role: 'assistant',
            content,
            timestamp: now,
            __receiveTime: now,
            __realtimeSequence: realtimeMessageSequence++,
            __streamingStatus: 'complete',
          }
        }

        if (completeMessage) {
          const messages = new Map(state.realtimeMessages)
          const sessionMessages = [...(messages.get(sessionKey) ?? [])]

          // Deduplicate: by ID or exact content (bug #7 fix).
          // extractMessageText handles both content-array and legacy top-level
          // text/body/message payloads, and strips <final> tags for both.
          const completeText = extractMessageText(completeMessage)
          const completeId = getMessageId(completeMessage)
          const isDuplicate = sessionMessages.some((existing) => {
            if (existing.role !== 'assistant') return false
            const existingId = getMessageId(existing)
            if (completeId && existingId && completeId === existingId)
              return true
            if (completeText && completeText === extractMessageText(existing))
              return true
            return false
          })

          if (!isDuplicate) {
            messages.set(
              sessionKey,
              appendMessageOrdered(sessionMessages, completeMessage),
            )
            set({ realtimeMessages: messages })
          } else {
            // If there IS a duplicate (e.g. a tagged pre-final message was stored),
            // replace it with the clean final version so the UI shows clean text.
            const existingIdx = sessionMessages.findIndex((existing) => {
              if (existing.role !== 'assistant') return false
              const existingId = getMessageId(existing)
              if (completeId && existingId && completeId === existingId)
                return true
              if (completeText && completeText === extractMessageText(existing))
                return true
              return false
            })
            if (existingIdx >= 0) {
              sessionMessages[existingIdx] = {
                ...sessionMessages[existingIdx],
                ...completeMessage,
              }
              messages.set(
                sessionKey,
                sortMessagesChronologically(sessionMessages),
              )
              set({ realtimeMessages: messages })
            }
          }

          // Persist the final assistant message to sessionStorage so it survives
          // dev refresh / tab navigation until backend history catches up.
          persistRecoveryMessage(sessionKey, completeMessage)
        }

        // Clear streaming state immediately — tool calls are preserved via
        // __streamToolCalls embedded on completeMessage above, so pills survive
        // in the history message without needing streaming state alive.
        // DO NOT keep a stub here — it keeps isRealtimeStreaming=true which
        // injects an invisible streaming placeholder that causes a blank gap.
        streamingMap.delete(sessionKey)
        set({ streamingState: streamingMap, lastEventAt: now })
        // Cancel any pending debounced persist — the streaming key is being
        // removed and the final message is persisted via persistRecoveryMessage
        // above. Flushing here would resurrect just-deleted streaming state.
        cancelPersistStreamingState(sessionKey)
        removeStreamingState(sessionKey)
        break
      }
    }
  },

  getRealtimeMessages: (sessionKey) => {
    return get().realtimeMessages.get(sessionKey) ?? []
  },

  getStreamingState: (sessionKey) => {
    return get().streamingState.get(sessionKey) ?? null
  },

  clearSession: (sessionKey) => {
    // Cancel any pending debounced streaming persist for this session so a
    // trailing timer can't re-write state after the session is cleared.
    cancelPersistStreamingState(sessionKey)
    const messages = new Map(get().realtimeMessages)
    const streaming = new Map(get().streamingState)
    messages.delete(sessionKey)
    streaming.delete(sessionKey)
    set({ realtimeMessages: messages, streamingState: streaming })
  },

  clearRealtimeBuffer: (sessionKey) => {
    const messages = new Map(get().realtimeMessages)
    messages.delete(sessionKey)
    set({ realtimeMessages: messages })
  },

  clearStreamingSession: (sessionKey) => {
    cancelPersistStreamingState(sessionKey)
    const streaming = new Map(get().streamingState)
    if (!streaming.has(sessionKey)) return
    streaming.delete(sessionKey)
    set({ streamingState: streaming })
  },

  clearAllStreaming: () => {
    if (get().streamingState.size === 0) return
    set({ streamingState: new Map() })
  },

  mergeHistoryMessages: (sessionKey, historyMessages) => {
    const realtimeMessages = get().realtimeMessages.get(sessionKey) ?? []

    if (realtimeMessages.length === 0) {
      return sortMessagesChronologically(historyMessages)
    }

    const matchesRealtimeMessage = (
      histMsg: ChatMessage,
      rtMsg: ChatMessage,
    ): boolean => {
      const rtId = getMessageId(rtMsg)
      const rtText = extractMessageText(rtMsg)
      const rtNonce = getClientNonce(rtMsg)
      const rtSignature = messageMultipartSignature(rtMsg)
      const histId = getMessageId(histMsg)
      if (rtId && histId && rtId === histId) {
        return true
      }

      const histNonce = getClientNonce(histMsg)
      if (rtNonce && histNonce && rtNonce === histNonce) {
        return true
      }

      if (histMsg.role === rtMsg.role && rtText) {
        const histText = extractMessageText(histMsg)
        if (histText === rtText) return true
      }

      const histIsOptimistic =
        normalizeString(histMsg.status) === 'sending' ||
        normalizeString(histMsg.__optimisticId).length > 0

      if (histIsOptimistic && histMsg.role === rtMsg.role) {
        if (rtText) {
          const histText = extractMessageText(histMsg)
          if (histText === rtText) return true
          if (histText && rtText.startsWith(histText)) return true
        }
        const rtAttachments = getMessageAttachments(rtMsg)
        const histAttachments = getMessageAttachments(histMsg)
        if (
          rtAttachments.length > 0 &&
          rtAttachments.length == histAttachments.length
        ) {
          const rtSig = rtAttachments
            .map((a) => `${normalizeString(a.name)}:${String(a.size ?? '')}`)
            .sort()
            .join('|')
          const histSig = histAttachments
            .map((a) => `${normalizeString(a.name)}:${String(a.size ?? '')}`)
            .sort()
            .join('|')
          if (rtSig && rtSig === histSig) return true
        }
      }

      return (
        rtSignature.length > 0 &&
        rtSignature === messageMultipartSignature(histMsg)
      )
    }

    const mergedHistoryMessages = historyMessages.map((histMsg) => {
      const matchingRealtime = realtimeMessages.find((rtMsg) =>
        matchesRealtimeMessage(histMsg, rtMsg),
      )
      if (!matchingRealtime) return histMsg
      // Preserve attachments from the optimistic/realtime message when history doesn't have them
      const merged = mergeRealtimeAssistantMetadata(histMsg, matchingRealtime)
      const rtAttachments = matchingRealtime.attachments
      const histAttachments = merged.attachments
      if (
        Array.isArray(rtAttachments) &&
        rtAttachments.length > 0 &&
        (!Array.isArray(histAttachments) || histAttachments.length === 0)
      ) {
        return { ...merged, attachments: rtAttachments }
      }
      return merged
    })

    const newRealtimeMessages = realtimeMessages.filter(
      (rtMsg) =>
        !mergedHistoryMessages.some((histMsg) =>
          matchesRealtimeMessage(histMsg, rtMsg),
        ),
    )

    if (newRealtimeMessages.length === 0) {
      return sortMessagesChronologically(mergedHistoryMessages)
    }

    return sortMessagesChronologically([
      ...mergedHistoryMessages,
      ...newRealtimeMessages,
    ])
  },
}))

function extractTextFromContent(
  content: Array<MessageContent> | undefined,
): string {
  if (!content || !Array.isArray(content)) return ''
  return stripFinalTags(
    content
      .filter(
        (c): c is TextContent =>
          c.type === 'text' && typeof c.text === 'string',
      )
      .map((c) => c.text)
      .join('\n')
      .trim(),
  )
}

/**
 * Extract text from a ChatMessage using multiple strategies:
 *   1. content array (canonical format)
 *   2. top-level text/body/message fields (legacy / some server adapters)
 *
 * Some servers echo user messages with a top-level `text` field instead of
 * the `content` array. Using only extractTextFromContent() would return ''
 * for those, causing dedup to fail in mergeHistoryMessages.
 */
function extractMessageText(msg: ChatMessage | null | undefined): string {
  if (!msg) return ''
  const fromContent = extractTextFromContent(msg.content)
  if (fromContent.length > 0) return fromContent

  const raw = msg as Record<string, unknown>
  for (const key of ['text', 'body', 'message']) {
    const val = raw[key]
    if (typeof val === 'string' && val.trim().length > 0)
      return stripFinalTags(val.trim())
  }
  return ''
}

function ensureAssistantTextContent(msg: ChatMessage): ChatMessage {
  if (msg.role !== 'assistant') return msg
  if (Array.isArray(msg.content) && msg.content.length > 0) return msg

  const text = extractMessageText(msg)
  if (!text) return msg

  return {
    ...msg,
    content: [{ type: 'text', text }],
  }
}

function mergeRealtimeAssistantMetadata(
  historyMessage: ChatMessage,
  realtimeMessage: ChatMessage,
): ChatMessage {
  if (
    historyMessage.role !== 'assistant' ||
    realtimeMessage.role !== 'assistant'
  ) {
    return historyMessage
  }

  const realtimeToolCalls = readStreamingToolCalls(
    realtimeMessage.__streamToolCalls,
  )
  const historyToolCalls = readStreamingToolCalls(
    historyMessage.__streamToolCalls,
  )
  const historyStreamToolCalls = readStreamingToolCalls(
    historyMessage.streamToolCalls,
  )

  if (
    realtimeToolCalls.length === 0 ||
    historyToolCalls.length > 0 ||
    historyStreamToolCalls.length > 0
  ) {
    return historyMessage
  }

  return {
    ...historyMessage,
    __streamToolCalls: realtimeToolCalls,
    streamToolCalls: realtimeToolCalls,
  }
}
