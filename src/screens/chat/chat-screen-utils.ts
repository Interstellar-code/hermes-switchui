import type { ChatAttachment, ChatMessage } from './types'

export type StickyStreamingTextState = {
  runId: string | null
  text: string
}

export function advanceStickyStreamingText(params: {
  isStreaming: boolean
  runId: string | null
  rawText: string
  smoothedText: string
  previousState: StickyStreamingTextState
}): StickyStreamingTextState {
  const { isStreaming, runId, rawText, smoothedText, previousState } = params

  if (!isStreaming) {
    return { runId: null, text: '' }
  }

  const nextRunId = runId ?? previousState.runId ?? 'streaming'
  const isNewRun = nextRunId !== previousState.runId
  const candidateText = smoothedText || rawText
  const nextText =
    candidateText.length > 0
      ? candidateText
      : isNewRun
        ? ''
        : previousState.text

  return {
    runId: nextRunId,
    text: nextText,
  }
}

type OptimisticMessagePayload = {
  clientId: string
  optimisticId: string
  optimisticMessage: ChatMessage
}

export function createOptimisticMessage(
  body: string,
  attachments: Array<ChatAttachment> = [],
): OptimisticMessagePayload {
  const clientId = crypto.randomUUID()
  const optimisticId = `opt-${clientId}`
  const timestamp = Date.now()
  const textContent =
    body.length > 0 ? [{ type: 'text' as const, text: body }] : []

  const optimisticMessage: ChatMessage = {
    role: 'user',
    content: textContent.length > 0 ? textContent : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    __optimisticId: optimisticId,
    __createdAt: timestamp,
    clientId,
    client_id: clientId,
    status: 'sending',
    timestamp,
  }

  return { clientId, optimisticId, optimisticMessage }
}

export function readMessageText(message: ChatMessage): string {
  const content = Array.isArray(message.content) ? message.content : []
  const contentText = content
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('\n')
  const streamingText =
    typeof message.__streamingText === 'string' ? message.__streamingText : ''
  return `${contentText}\n${streamingText}`.trim()
}

function readStatus(message: ChatMessage): string {
  const status = (message as Record<string, unknown>).status
  return typeof status === 'string' ? status.toLowerCase().trim() : ''
}

function isPendingUserMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false

  const status = readStatus(message)
  if (
    status === 'error' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'aborted' ||
    status === 'sent' ||
    status === 'done'
  ) {
    return false
  }

  if (status === 'sending' || status === 'queued' || status === 'pending') {
    return true
  }

  const raw = message as Record<string, unknown>
  return (
    typeof raw.__optimisticId === 'string' ||
    typeof raw.clientId === 'string' ||
    typeof raw.client_id === 'string'
  )
}

function isFinalAssistantAnswer(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false
  if (message.__streamingStatus === 'streaming') return false
  return readMessageText(message).trim().length > 0
}

export function hasUnansweredLatestUserTurn(
  messages: Array<ChatMessage>,
): boolean {
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index
      break
    }
  }

  if (latestUserIndex < 0) return false

  const latestUser = messages[latestUserIndex]
  if (!isPendingUserMessage(latestUser)) return false

  const afterLatestUser = messages.slice(latestUserIndex + 1)
  if (afterLatestUser.length === 0) return true

  for (const message of afterLatestUser) {
    if (isFinalAssistantAnswer(message)) return false
    if (
      message.role === 'assistant' ||
      message.role === 'tool' ||
      message.role === 'toolResult'
    ) {
      return true
    }
  }

  return true
}

/**
 * F1 guard for `hasUnansweredLatestUserTurn`.
 *
 * A turn is "tool-only completed" when the latest user message is followed
 * exclusively by tool/toolResult/streaming-placeholder messages (no final
 * assistant text answer). This pattern arises when an agent finishes a run
 * by executing tools but never emits a final synthesis — the user sees
 * tool output but no conversational reply. Reading this as "unanswered"
 * would cause the recovery predicate to surface a phantom `interrupted`
 * affordance for what is actually a completed run.
 *
 * Returns `false` when:
 *  - there is no latest user turn
 *  - a final assistant text answer already follows
 *  - the turn is already answered by any user-visible assistant message
 */
export function latestTurnIsToolOnly(messages: Array<ChatMessage>): boolean {
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index
      break
    }
  }

  if (latestUserIndex < 0) return false

  const afterLatestUser = messages.slice(latestUserIndex + 1)
  if (afterLatestUser.length === 0) return false

  let sawAnyToolOutput = false
  for (const message of afterLatestUser) {
    if (isFinalAssistantAnswer(message)) return false
    if (message.role === 'tool' || message.role === 'toolResult') {
      sawAnyToolOutput = true
      continue
    }
    if (message.role === 'assistant') {
      // Streaming assistant placeholder without text content — part of a
      // tool-only flow. Don't conclude tool-only yet; keep scanning.
      if (message.__streamingStatus === 'streaming') continue
      // Any other assistant message (with text or final) means the turn
      // is no longer tool-only.
      return false
    }
    // Unknown role (system, etc.) — not a tool-only turn.
    return false
  }

  return sawAnyToolOutput
}

export type ChatRuntimeBusyState = {
  sending: boolean
  waitingForResponse: boolean
  hasActiveSend: boolean
  activeIsRealtimeStreaming: boolean
  derivedIsStreaming: boolean
  hasPendingGeneration: boolean
}

/**
 * Runtime activity is the source of truth for disabling the composer and
 * deferring new sends. UI-only projections (for example the detached thinking
 * bubble) and history shape (for example an unanswered old user turn) must not
 * feed this value, otherwise interrupted sessions can self-lock and queue every
 * future message even after the backend has no active run.
 */
export function isChatRuntimeBusy({
  sending,
  waitingForResponse,
  hasActiveSend,
  activeIsRealtimeStreaming,
  derivedIsStreaming,
  hasPendingGeneration,
}: ChatRuntimeBusyState): boolean {
  return (
    sending ||
    waitingForResponse ||
    hasActiveSend ||
    activeIsRealtimeStreaming ||
    derivedIsStreaming ||
    hasPendingGeneration
  )
}

/**
 * Maps a tool/skill name to a human-friendly progress verb for the thinking
 * bubble (live-progress fallback poller, used when SSE is down). Pure string
 * classification — no side effects.
 */
export function verbForTool(name: string): string {
  const n = (name || '').toLowerCase()
  if (n.includes('terminal') || n.includes('bash') || n.includes('shell'))
    return 'Running terminal'
  if (n.includes('write') || n.includes('edit') || n.includes('create'))
    return 'Writing file'
  if (n.includes('read') || n.includes('view') || n.includes('cat'))
    return 'Reading file'
  if (
    n.includes('search') ||
    n.includes('grep') ||
    n.includes('glob') ||
    n.includes('find')
  )
    return 'Searching'
  if (n.includes('skill')) return 'Loading skill'
  if (n.includes('mcp')) return `Calling ${name}`
  if (n.includes('fetch') || n.includes('http') || n.includes('web'))
    return 'Fetching'
  return name ? `Running ${name}` : 'Working'
}

/**
 * Scrolls the chat message viewport to the bottom. No-op when the viewport
 * element is absent (for example during SSR or before first paint).
 */
export function scrollChatToBottom(behavior: ScrollBehavior = 'smooth'): void {
  const viewport = document.querySelector('[data-chat-scroll-viewport]')
  if (viewport) {
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
  }
}
