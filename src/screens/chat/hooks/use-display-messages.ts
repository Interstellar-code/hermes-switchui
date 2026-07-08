import { useMemo } from 'react'

import { textFromMessage } from '../utils'
import type { ChatMessage, StreamingToolCall } from '../types'
import { stripQueuedWrapper } from '@/lib/strip-queued-wrapper'

/**
 * Normalize an unknown message field value into a trimmed string (empty when
 * absent / non-string). Duplicated locally to avoid a circular import on
 * chat-screen.tsx — the same helper already lives in use-chat-history.ts.
 */
function normalizeMessageValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

function messageFallbackSignature(message: ChatMessage): string {
  const raw = message as Record<string, unknown>
  const timestamp = normalizeMessageValue(
    typeof raw.timestamp === 'number' ? String(raw.timestamp) : raw.timestamp,
  )

  const contentParts = Array.isArray(message.content)
    ? message.content
        .map((part: any) => {
          if (part.type === 'text') {
            return `t:${typeof part.text === 'string' ? part.text.trim() : ''}`
          }
          if (part.type === 'thinking') {
            return `th:${typeof part.thinking === 'string' ? part.thinking : ''}`
          }
          if (part.type === 'toolCall') {
            const toolPart = part
            return `tc:${toolPart.id ?? ''}:${toolPart.name ?? ''}`
          }
          return `p:${part.type ?? ''}`
        })
        .join('|')
    : ''

  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .map((attachment) => {
          const name =
            typeof attachment.name === 'string' ? attachment.name : ''
          const size =
            typeof attachment.size === 'number' ? String(attachment.size) : ''
          const type =
            typeof attachment.contentType === 'string'
              ? attachment.contentType
              : ''
          return `${name}:${size}:${type}`
        })
        .join('|')
    : ''

  return `${message.role ?? 'unknown'}:${timestamp}:${contentParts}:${attachments}`
}

function getMessageStatusValue(message: ChatMessage): string {
  return normalizeMessageValue((message as Record<string, unknown>).status)
}

function getMessageTimestampValue(message: ChatMessage): number | null {
  const raw = message as Record<string, unknown>
  const candidates = [
    raw.timestamp,
    raw.__createdAt,
    raw.createdAt,
    raw.created_at,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate < 1_000_000_000_000 ? candidate * 1000 : candidate
    }
    if (typeof candidate === 'string') {
      const parsed = Date.parse(candidate)
      if (!Number.isNaN(parsed)) return parsed
    }
  }

  return null
}

function getMessageAttachmentSignature(message: ChatMessage): string {
  if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
    return ''
  }

  return message.attachments
    .map((attachment) => {
      const name = typeof attachment.name === 'string' ? attachment.name : ''
      const size =
        typeof attachment.size === 'number' ? String(attachment.size) : ''
      const type =
        typeof attachment.contentType === 'string'
          ? attachment.contentType
          : ''
      return `${name}:${size}:${type}`
    })
    .sort()
    .join('|')
}

function isOptimisticUserMessage(message: ChatMessage): boolean {
  const raw = message as Record<string, unknown>
  return (
    normalizeMessageValue(raw.__optimisticId).length > 0 ||
    ['sending', 'sent', 'done'].includes(getMessageStatusValue(message))
  )
}

function shouldCollapseTextDuplicate(
  existing: ChatMessage,
  candidate: ChatMessage,
): boolean {
  if (existing.role !== candidate.role) return false

  if (candidate.role === 'assistant') {
    return true
  }

  if (candidate.role !== 'user') return false

  const existingTs = getMessageTimestampValue(existing)
  const candidateTs = getMessageTimestampValue(candidate)
  if (existingTs !== null && candidateTs !== null) {
    if (Math.abs(existingTs - candidateTs) > 15_000) return false
  }

  // Collapse same-turn user duplicates even after the optimistic marker has been
  // cleared. The send path can leave us with an optimistic local message plus a
  // confirmed/history copy after completion; requiring one side to still look
  // optimistic misses that handoff and leaves both visible.
  const existingSig = getMessageAttachmentSignature(existing)
  const candidateSig = getMessageAttachmentSignature(candidate)
  if (existingSig && candidateSig) {
    return existingSig === candidateSig
  }

  return true
}

function stripQueuedWrapperFromUserMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'user') return message

  const text = textFromMessage(message)
  const cleanedText = stripQueuedWrapper(text)
  if (cleanedText === text) return message

  return {
    ...message,
    content: [{ type: 'text', text: cleanedText }],
    text: cleanedText,
    body: cleanedText,
  }
}

/**
 * Compute the display-ready message list from the realtime-merged messages.
 *
 * Pipeline: filter → sort for dedup → deduplicate → strip queued wrappers →
 * inject streaming placeholder.
 *
 * Pure extraction from chat-screen.tsx (#298) — no behavior change.
 */
export function useDisplayMessages(params: {
  realtimeMessages: Array<ChatMessage>
  activeIsRealtimeStreaming: boolean
  activeToolCalls: Array<StreamingToolCall>
  realtimeStreamingThinking: string
}): {
  finalDisplayMessages: Array<ChatMessage>
} {
  const {
    realtimeMessages,
    activeIsRealtimeStreaming,
    activeToolCalls,
    realtimeStreamingThinking,
  } = params

  // Use realtime-merged messages for display (SSE + history)
  // Re-apply display filter to realtime messages
  const finalDisplayMessages = useMemo(() => {
    const filtered = realtimeMessages.filter((msg) => {
      if (msg.role === 'user') {
        const text = stripQueuedWrapper(textFromMessage(msg))
        if (text.startsWith('A subagent task')) return false
        return true
      }
      if (msg.role === 'assistant') {
        if (msg.__streamingStatus === 'streaming') return true
        if ((msg as any).__optimisticId && msg.content.length === 0) return true
        if (textFromMessage(msg).trim().length > 0) return true
        const content = Array.isArray(msg.content) ? msg.content : []
        const hasToolCalls = content.some((part) => part.type === 'toolCall')
        const hasStreamToolCalls =
          Array.isArray((msg as any).__streamToolCalls) &&
          (msg as any).__streamToolCalls.length > 0
        return hasToolCalls || hasStreamToolCalls
      }
      return false
    })

    const sortedForDedup = [...filtered].sort((a, b) => {
      const aRaw = a as Record<string, unknown>
      const bRaw = b as Record<string, unknown>
      const aIsOptimistic =
        normalizeMessageValue(aRaw.__optimisticId).startsWith('opt-') &&
        !normalizeMessageValue(aRaw.id)
      const bIsOptimistic =
        normalizeMessageValue(bRaw.__optimisticId).startsWith('opt-') &&
        !normalizeMessageValue(bRaw.id)
      if (aIsOptimistic && !bIsOptimistic) return 1
      if (!aIsOptimistic && bIsOptimistic) return -1
      return 0
    })

    const seen = new Set<string>()
    const seenByText = new Map<string, ChatMessage>()
    const dedupedSet = new Set<ChatMessage>()
    for (const msg of sortedForDedup) {
      const raw = msg as Record<string, unknown>
      const rawOptimisticId = normalizeMessageValue(raw.__optimisticId)
      const bareOptimisticUuid = rawOptimisticId.startsWith('opt-')
        ? rawOptimisticId.slice(4)
        : ''
      const idCandidates = [
        normalizeMessageValue(raw.id),
        normalizeMessageValue(raw.messageId),
        normalizeMessageValue(raw.clientId),
        normalizeMessageValue(raw.client_id),
        normalizeMessageValue(raw.nonce),
        normalizeMessageValue(raw.idempotencyKey),
        bareOptimisticUuid,
        rawOptimisticId,
      ].filter(Boolean)

      const primaryKey =
        idCandidates.length > 0
          ? `${msg.role}:id:${idCandidates[0]}`
          : `${msg.role}:fallback:${messageFallbackSignature(msg)}`

      if (seen.has(primaryKey)) continue

      const text = stripQueuedWrapper(textFromMessage(msg)).trim()
      if (text.length > 0) {
        const normalizedText = text.replace(/\s+/g, ' ')
        const textKey = `${msg.role}:text:${normalizedText}`
        const existingTextMatch = seenByText.get(textKey)
        if (
          existingTextMatch &&
          shouldCollapseTextDuplicate(existingTextMatch, msg)
        ) {
          continue
        }
        if (!existingTextMatch) {
          seenByText.set(textKey, msg)
        }
      }

      seen.add(primaryKey)
      for (const candidate of idCandidates.slice(1)) {
        seen.add(`${msg.role}:id:${candidate}`)
      }
      dedupedSet.add(msg)
    }

    const deduped = filtered
      .filter((msg) => dedupedSet.has(msg))
      .map((msg) => stripQueuedWrapperFromUserMessage(msg))

    if (!activeIsRealtimeStreaming) {
      return deduped
    }

    const nextMessages = [...deduped]
    const streamToolCalls = activeToolCalls.map((toolCall) => ({
      ...toolCall,
      phase: toolCall.phase,
    }))

    // The live streaming text is intentionally NOT baked into the array here.
    // Embedding the per-frame text (stableActiveStreamingText) would change the
    // memo's output identity on every requestAnimationFrame tick (~60×/sec),
    // forcing ChatMessageList — and its full filter/dedup/sort/group/signature
    // pipeline — to recompute over the entire message set each frame (#212).
    // Instead the placeholder carries STABLE content and the live text reaches
    // the streaming bubble exclusively via the dedicated `streamingText` prop on
    // ChatMessageList → MessageItem. The `streamingText` prop on MessageItem
    // takes precedence over message.__streamingText, so the typewriter reveal is
    // driven entirely by that prop path and only the streaming leaf re-renders.
    const streamingMsg = {
      role: 'assistant',
      content: [],
      __optimisticId: 'streaming-current',
      __streamingStatus: 'streaming',
      __streamingText: '',
      __streamingThinking: realtimeStreamingThinking,
      __streamToolCalls: streamToolCalls,
    } as ChatMessage

    const existingStreamIdx = nextMessages.findIndex(
      (message) => message.__streamingStatus === 'streaming',
    )

    if (existingStreamIdx >= 0) {
      nextMessages[existingStreamIdx] = {
        ...nextMessages[existingStreamIdx],
        ...streamingMsg,
      }
      return nextMessages
    }

    const lastUserIdx = nextMessages.reduce(
      (lastIdx, msg, idx) => (msg.role === 'user' ? idx : lastIdx),
      -1,
    )
    if (lastUserIdx >= 0 && lastUserIdx === nextMessages.length - 1) {
      nextMessages.push(streamingMsg)
    } else if (lastUserIdx >= 0) {
      nextMessages.splice(lastUserIdx + 1, 0, streamingMsg)
    } else {
      nextMessages.push(streamingMsg)
    }
    return nextMessages
    // NOTE: activeRealtimeStreamingText / stableActiveStreamingText are
    // deliberately excluded from deps. The per-frame live text must NOT change
    // this array's identity (#212); it flows to the streaming bubble via the
    // dedicated `streamingText` prop on ChatMessageList instead.
  }, [
    activeToolCalls,
    activeIsRealtimeStreaming,
    realtimeMessages,
    realtimeStreamingThinking,
  ])

  return { finalDisplayMessages }
}
