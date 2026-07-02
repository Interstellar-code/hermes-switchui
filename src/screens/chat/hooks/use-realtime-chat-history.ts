import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '../../../stores/chat-store'
import { appendHistoryMessage, chatQueryKeys } from '../chat-queries'
import { toast } from '../../../components/ui/toast'
import { textFromMessage } from '../utils'
import { isInternalSystemMessage } from '../internal-message-filter'
import type { ChatMessage } from '../types'
import type { StreamingState } from '../../../stores/chat-store'

const PORTABLE_HISTORY_STORAGE_KEY = 'claude_portable_chat_main'
const PORTABLE_HISTORY_LIMIT = 100

/** Read clientId from a message using either camelCase or snake_case field. */
function readClientId(message: ChatMessage): string {
  const raw = message as Record<string, unknown>
  for (const key of ['clientId', 'client_id']) {
    const val = raw[key]
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
  }
  return ''
}

/**
 * Extract plain-text content from a user message for dedup comparison.
 *
 * Uses a multi-field strategy because different server versions / channel
 * adapters shape the SSE payload differently:
 *   • Modern format:  content: [{type:'text', text:'...'}]
 *   • Legacy format:  text: '...' | body: '...' | message: '...'
 *
 * textFromMessage() only reads the content-array format, so using it alone
 * causes the dedup to miss echoes that carry a top-level `text` field,
 * leaving those duplicate messages visible in the chat.
 */
function extractUserMessageText(message: ChatMessage): string {
  // Primary: content-array format (modern canonical)
  const fromContent = textFromMessage(message).trim()
  if (fromContent.length > 0) return fromContent

  // Fallback: top-level text/body/message fields (legacy / some channel adapters)
  const raw = message as Record<string, unknown>
  for (const key of ['text', 'body', 'message']) {
    const val = raw[key]
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
  }

  return ''
}

/**
 * Build a compact attachment-identity signature for image-only dedup.
 * Compares name + size because those survive the round-trip to the server;
 * base64 content is stripped before storage.
 */
function attachmentSignature(message: ChatMessage): string {
  const attachments = Array.isArray(
    (message as Record<string, unknown>).attachments,
  )
    ? ((message as Record<string, unknown>).attachments as Array<
        Record<string, unknown>
      >)
    : []
  if (attachments.length === 0) return ''
  return attachments
    .map((a) => `${String(a.name ?? '')}:${String(a.size ?? '')}`)
    .sort()
    .join('|')
}

function persistPortableHistory(messages: Array<ChatMessage>) {
  if (typeof window === 'undefined') return

  const persistedMessages = messages
    .filter((message) => message.__streamingStatus !== 'streaming')
    .slice(-PORTABLE_HISTORY_LIMIT)

  try {
    window.localStorage.setItem(
      PORTABLE_HISTORY_STORAGE_KEY,
      JSON.stringify({
        messages: persistedMessages,
        updatedAt: Date.now(),
      }),
    )
  } catch {
    // Ignore persistence failures (quota, private mode, malformed messages).
  }
}

const EMPTY_MESSAGES: Array<ChatMessage> = []
const EMPTY_TOOL_CALLS: Array<{
  id: string
  name: string
  phase: string
  args?: unknown
}> = []
const EMPTY_LIFECYCLE_EVENTS: StreamingState['lifecycleEvents'] = []

type UseRealtimeChatHistoryOptions = {
  sessionKey: string
  friendlyId: string
  historyMessages: Array<ChatMessage>
  enabled?: boolean
  onUserMessage?: (message: ChatMessage, source?: string) => void
  onApprovalRequest?: (approval: Record<string, unknown>) => void
  onCompactionStart?: () => void
  onCompactionEnd?: () => void
}

type CompactionEvent = {
  phase?: string
  sessionKey: string
}

/**
 * Hook that makes SSE the PRIMARY source for new messages and streaming.
 * - Streaming chunks update the chat-store (already happens)
 * - When 'done' arrives, the complete message is immediately available
 * - History polling is now just a backup/backfill mechanism
 */
export function useRealtimeChatHistory({
  sessionKey,
  friendlyId,
  historyMessages,
  enabled = true,
  portableMode = false,
  onUserMessage,
  onApprovalRequest,
  onCompactionStart,
  onCompactionEnd,
}: UseRealtimeChatHistoryOptions & { portableMode?: boolean }) {
  const queryClient = useQueryClient()
  const effectiveFriendlyId = portableMode ? 'main' : friendlyId
  const effectiveSessionKey = portableMode ? 'main' : sessionKey
  const [lastCompletedRunAt, setLastCompletedRunAt] = useState<number | null>(
    null,
  )
  const completedStreamingTextRef = useRef<string>('')
  const completedStreamingThinkingRef = useRef<string>('')
  const lastCompactionSignalRef = useRef<string>('')
  const isBackfillingRef = useRef(false)
  const clearCompletedStreaming = useCallback(() => {
    completedStreamingTextRef.current = ''
    completedStreamingThinkingRef.current = ''
  }, [])

  const backfillHistory = useCallback(async () => {
    if (!effectiveSessionKey || effectiveSessionKey === 'new') return
    if (isBackfillingRef.current) return

    isBackfillingRef.current = true
    try {
      const key = chatQueryKeys.history(
        effectiveFriendlyId,
        effectiveSessionKey,
      )
      await queryClient.invalidateQueries({ queryKey: key, exact: true })
      await queryClient.refetchQueries({
        queryKey: key,
        exact: true,
        type: 'active',
      })
    } finally {
      isBackfillingRef.current = false
    }
  }, [effectiveFriendlyId, effectiveSessionKey, queryClient])

  useEffect(() => {
    if (!enabled) return
    if (!effectiveSessionKey || effectiveSessionKey === 'new') return
    void backfillHistory()
  }, [backfillHistory, effectiveSessionKey, enabled])



  const mergeHistoryMessages = useChatStore((s) => s.mergeHistoryMessages)
  const clearSession = useChatStore((s) => s.clearSession)
  const lastEventAt = useChatStore((s) => s.lastEventAt)
  const realtimeMessages = useChatStore(
    (s) => s.realtimeMessages.get(effectiveSessionKey) ?? EMPTY_MESSAGES,
  )

  // Subscribe directly to streaming state — useMemo with stable fn ref was stale (bug #1)
  const streamingState = useChatStore(
    (s) => s.streamingState.get(effectiveSessionKey) ?? null,
  )
  const streamingStateRef = useRef(streamingState)
  const lastStreamClearTimeRef = useRef<number>(0)
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeSessionKeyRef = useRef(effectiveSessionKey)
  const isUnmountingRef = useRef(false)
  activeSessionKeyRef.current = effectiveSessionKey

  useEffect(() => {
    const prev = streamingStateRef.current
    streamingStateRef.current = streamingState
    const startedNewStream =
      streamingState !== null &&
      (prev === null || prev.runId !== streamingState.runId)
    if (startedNewStream) {
      clearCompletedStreaming()
    }
    // Streaming just completed — capture final text so the message stays
    // visible during the handoff from streaming placeholder to history message.
    if (prev && prev.text && !streamingState) {
      completedStreamingTextRef.current = prev.text
      if (prev.thinking) {
        completedStreamingThinkingRef.current = prev.thinking
      }
      lastStreamClearTimeRef.current = Date.now()
      setLastCompletedRunAt(Date.now())
    }
  }, [clearCompletedStreaming, streamingState])

  // Merge history with real-time messages.
  //
  // Subscribe to `realtimeMessages` directly in the dep array so a buffer
  // change recomputes the merge even when it doesn't bump `lastEventAt` — e.g.
  // a deterministic buffer clear on session switch (#220). `lastEventAt` is
  // retained because streaming events mutate buffer entries in place and bump
  // the proxy without changing the array reference, so it still triggers
  // recompute for those.
  const mergedMessages = useMemo(() => {
    if (effectiveSessionKey === 'new') return historyMessages
    return mergeHistoryMessages(effectiveSessionKey, historyMessages)
  }, [
    effectiveSessionKey,
    historyMessages,
    mergeHistoryMessages,
    lastEventAt,
    realtimeMessages,
  ])

  useEffect(() => {
    if (!portableMode) return
    if (mergedMessages.length === 0) return
    persistPortableHistory(mergedMessages)
  }, [mergedMessages, portableMode])

  useEffect(() => {
    if (!onCompactionStart) return
    if (realtimeMessages.length === 0) return
    const latest = realtimeMessages[realtimeMessages.length - 1]

    const textCandidates = [
      textFromMessage(latest),
      ...(Array.isArray(latest.content) ? latest.content : []).map((part) => {
        if (part.type === 'text') return String(part.text ?? '')
        if (part.type === 'thinking') return String(part.thinking ?? '')
        return ''
      }),
    ]
      .join('\n')
      .toLowerCase()

    // Only trigger on Hermes Agent's actual mid-compaction signal.
    // "pre-compaction memory flush" and "store durable memories now" are routine
    // heartbeat messages — do NOT match those here.
    if (!textCandidates.includes('compacting context')) return

    const signal = `${latest.role ?? ''}:${textCandidates}`
    if (signal === lastCompactionSignalRef.current) return
    lastCompactionSignalRef.current = signal
    onCompactionStart()
  }, [onCompactionStart, realtimeMessages])

  // Periodic history sync — catch missed messages every 30s
  // Skip during active streaming to prevent race conditions
  useEffect(() => {
    if (!effectiveSessionKey || effectiveSessionKey === 'new' || !enabled)
      return
    syncIntervalRef.current = setInterval(() => {
      // Don't poll during active streaming — causes flicker/overwrites
      if (streamingStateRef.current !== null) return
      // Guard window: don't poll right after streaming clears — new stream
      // may be starting and history API may return stale/incomplete data
      if (Date.now() - lastStreamClearTimeRef.current < 3000) return
      const key = chatQueryKeys.history(
        effectiveFriendlyId,
        effectiveSessionKey,
      )
      queryClient.invalidateQueries({ queryKey: key })
    }, 30000)
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    }
  }, [effectiveFriendlyId, effectiveSessionKey, enabled, queryClient])

  // Clear the PREVIOUS session's realtime buffer deterministically when the
  // session changes (#220).
  //
  // realtimeMessages is a per-session Map and mergeHistoryMessages only reads
  // the active session's buffer, so the session we navigate AWAY from is no
  // longer rendered — clearing it immediately is safe and bounds Map growth.
  // The old 5s setTimeout misfired on rapid A→B→A switches (it could wipe a
  // session we'd switched back to, or never fire and leak buffers).
  //
  // Handoff protection preserved: we never clear the now-active key (guarded by
  // activeSessionKeyRef), and we skip clearing on true unmount
  // (isUnmountingRef) so a remount of the same session keeps its in-flight
  // final assistant message until history catches up.
  useEffect(() => {
    if (!effectiveSessionKey || effectiveSessionKey === 'new') return undefined
    const keyForThisEffect = effectiveSessionKey
    return () => {
      if (isUnmountingRef.current) return
      // Only clear if we actually moved to a different session; never clear the
      // session we are currently viewing.
      if (activeSessionKeyRef.current === keyForThisEffect) return
      clearSession(keyForThisEffect)
    }
  }, [effectiveSessionKey, clearSession])

  useEffect(() => {
    isUnmountingRef.current = false
    return () => {
      isUnmountingRef.current = true
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    }
  }, [])

  // Compute streaming UI state
  const isRealtimeStreaming = streamingState !== null
  const realtimeStreamingText = streamingState?.text ?? ''
  const realtimeStreamingThinking = streamingState?.thinking ?? ''
  const realtimeLifecycleEvents =
    streamingState?.lifecycleEvents ?? EMPTY_LIFECYCLE_EVENTS

  return {
    messages: mergedMessages,
    isRealtimeStreaming,
    realtimeStreamingText,
    realtimeStreamingThinking,
    realtimeLifecycleEvents,
    completedStreamingText: completedStreamingTextRef,
    completedStreamingThinking: completedStreamingThinkingRef,
    clearCompletedStreaming,
    streamingRunId: streamingState?.runId ?? null,
    activeToolCalls: streamingState?.toolCalls ?? EMPTY_TOOL_CALLS,
    lastCompletedRunAt, // Parent watches this to clear waitingForResponse
  }
}
