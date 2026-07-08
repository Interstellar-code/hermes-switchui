import { useCallback, useEffect, useRef, useState } from 'react'
import { setPendingGeneration } from '../pending-send'
import { isMissingAuth, textFromMessage } from '../utils'
import { createOptimisticMessage } from '../chat-screen-utils'
import {
  appendHistoryMessage,
  updateHistoryMessageByClientId,
  updateHistoryMessageByClientIdEverywhere,
  updateSessionLastMessage,
} from '../chat-queries'
import { invalidateSessionLists } from '../sessions-feed'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import type { ChatAttachment, ChatMessage } from '../types'
import type { AgentActivity } from '@/stores/chat-activity-store'
import { useChatStore } from '@/stores/chat-store'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import { stripDataUrlPrefix } from '@/lib/stream-utils'
import { playChatComplete } from '@/lib/sounds'
import { toast } from '@/components/ui/toast'
import { showErrorToast } from '@/components/error-toast'

export type ActiveSendRecord = {
  sessionKey: string
  friendlyId: string
  clientId: string
}

// --- Utility functions moved from chat-screen.tsx (seam #4 PR 2) ---
// These are used exclusively by sendMessage and were relocated alongside
// it to avoid passing them as parameters.

type PortableHistoryMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

function normalizeMimeType(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function isImageMimeType(value: unknown): boolean {
  const normalized = normalizeMimeType(value)
  return normalized.startsWith('image/')
}

function readDataUrlMimeType(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = /^data:([^;,]+)[^,]*,/i.exec(value.trim())
  return match?.[1]?.trim().toLowerCase() || ''
}

function getPortableHistoryContent(message: ChatMessage): string {
  const text = textFromMessage(message).trim()
  if (text) return text
  if (
    message.role === 'user' &&
    Array.isArray(message.attachments) &&
    message.attachments.length > 0
  ) {
    return 'Please review the attached content.'
  }
  return ''
}

function buildPortableHistory(
  messages: Array<ChatMessage>,
): Array<PortableHistoryMessage> {
  return messages
    .filter(
      (
        message,
      ): message is ChatMessage & { role: 'user' | 'assistant' | 'system' } =>
        message.role === 'user' ||
        message.role === 'assistant' ||
        message.role === 'system',
    )
    .filter((message) => (message as any).__streamingStatus !== 'streaming')
    .map((message) => {
      const content = getPortableHistoryContent(message)
      if (!content) return null
      return {
        role: message.role,
        content,
      }
    })
    .filter((message): message is PortableHistoryMessage => message !== null)
    .slice(-20)
}

/**
 * useSendMessageState — owns the send-path state flags, refs,
 * timer/stream-lifecycle functions, AND the core sendMessage logic
 * extracted from chat-screen.tsx (seam #4 PR 1 + PR 2).
 *
 * Group A: state declarations + refs (sending, activeSendRef,
 * waitingForResponseRef, sessionKeyForWaiting, streamTimer,
 * failsafeTimerRef, refreshHistoryRef, lastSendKeyRef, lastSendAtRef).
 *
 * Group B: timer/stream lifecycle (streamStop, streamStart,
 * streamFinish + cleanup + failsafe effects).
 *
 * Group C (PR 2): sendMessage — the core send-path function that
 * normalises attachments, creates optimistic messages, arms the
 * failsafe timer, and calls startStreaming.
 *
 * `setWaitingForResponse` is also owned here because it closes over
 * `sessionKeyForWaiting.current` — moving it avoids a circular
 * dependency between the hook and the screen.
 *
 * `lastCompletedRunAt` cannot be a direct param due to a dependency
 * cycle (this hook's `waitingForResponseRef` → usePendingApprovals →
 * useRealtimeChatHistory → lastCompletedRunAt). Instead the screen
 * calls `syncLastCompletedRunAt` after the realtime hook returns; a
 * state bump re-triggers the 10 s failsafe effect exactly as before.
 *
 * Several sendMessage dependencies (startStreaming,
 * clearCompletedStreaming, finalDisplayMessages, currentModel) are
 * likewise produced by hooks called AFTER this hook in the render
 * order (useRealtimeChatHistory → useStreamingMessage → useMemo).
 * They are passed as RefObject bridges and synced during render in
 * the screen, so sendMessage always reads the latest value. This
 * mirrors the existing ref-based pattern for thinkingLevelRef and
 * activeRealtimeStreamingRef.
 */
export function useSendMessageState(params: {
  activeFriendlyId: string | undefined
  isNewChat: boolean
  waitingForResponse: boolean
  activeRealtimeStreamingRef: RefObject<boolean>
  // PR 2 params — needed by sendMessage
  thinkingLevelRef: RefObject<string>
  setLocalActivity: (activity: AgentActivity) => void
  setError: Dispatch<SetStateAction<string | null>>
  clearCompletedStreamingRef: RefObject<() => void>
  startStreamingRef: RefObject<
    (params: {
      sessionKey: string
      friendlyId: string
      message: string
      history?: Array<PortableHistoryMessage>
      thinking?: string
      fastMode?: boolean
      attachments?: Array<ChatAttachment>
      idempotencyKey?: string
      model?: string
    }) => Promise<void>
  >
  queryClient: QueryClient
  finalDisplayMessagesRef: RefObject<Array<ChatMessage>>
  currentModelRef: RefObject<string | undefined>
  setResearchResetKey: Dispatch<SetStateAction<number>>
  // PR 3 params — needed by SSE callbacks + abort helpers
  onSessionResolved?: (params: {
    sessionKey: string
    friendlyId: string
  }) => void
  navigate: (opts: { to: string; replace: boolean }) => void
  embedded: boolean
  cancelStreamingRef: RefObject<(() => void) | null>
}): {
  // State
  sending: boolean
  setSending: Dispatch<SetStateAction<boolean>>
  // Refs (exposed because Groups C-G still read them)
  activeSendRef: RefObject<ActiveSendRecord | null>
  waitingForResponseRef: RefObject<boolean>
  sessionKeyForWaiting: RefObject<string | undefined>
  lastSendKeyRef: RefObject<string>
  lastSendAtRef: RefObject<number>
  streamTimer: RefObject<number | null>
  failsafeTimerRef: RefObject<number | null>
  refreshHistoryRef: RefObject<() => void>
  // Stream lifecycle functions
  streamStop: () => void
  streamStart: () => void
  streamFinish: () => void
  // Waiting-state setter (moved here — closes over sessionKeyForWaiting)
  setWaitingForResponse: (waiting: boolean) => void
  // Late-sync for lastCompletedRunAt (decoupled from realtime hook cycle)
  syncLastCompletedRunAt: (value: number | null) => void
  // Core send function (PR 2)
  sendMessage: (
    sessionKey: string,
    friendlyId: string,
    body: string,
    attachments?: Array<ChatAttachment>,
    fastMode?: boolean,
    skipOptimistic?: boolean,
    existingClientId?: string,
  ) => void
  // SSE callbacks (PR 3 — Group D)
  onSessionResolved: (params: {
    sessionKey: string
    friendlyId: string
  }) => void
  onStarted: (params: { runId: string | null }) => void
  onComplete: () => void
  onError: (messageText: string) => void
  onMessageAccepted: (
    sessionKey: string,
    friendlyId: string,
    clientId: string,
  ) => void
  onAbort: () => void
  // Abort helpers (PR 3 — Group E)
  reconcileStuckBusyState: (sessionKey: string) => void
  handleAbortStreaming: () => void
} {
  const {
    activeFriendlyId,
    isNewChat,
    waitingForResponse,
    activeRealtimeStreamingRef,
    thinkingLevelRef,
    setLocalActivity,
    setError,
    clearCompletedStreamingRef,
    startStreamingRef,
    queryClient,
    finalDisplayMessagesRef,
    currentModelRef,
    setResearchResetKey,
    onSessionResolved: onSessionResolvedProp,
    navigate,
    embedded,
    cancelStreamingRef,
  } = params

  // --- Group A: State declarations + refs ---

  const [sending, setSending] = useState(false)

  // --- Issue #43 fix: lift waitingForResponse into persistent Zustand store ---
  // The store survives component unmount, so navigating away mid-stream
  // doesn't lose the "waiting" flag. sessionStorage backup handles reloads.
  const sessionKeyForWaiting = useRef<string | undefined>(undefined)

  const streamTimer = useRef<number | null>(null)
  const failsafeTimerRef = useRef<number | null>(null)

  const refreshHistoryRef = useRef<() => void>(() => {})

  // Idempotency guard prevents duplicate sends on paste/attach double-fire.
  const lastSendKeyRef = useRef('')
  const lastSendAtRef = useRef(0)
  const activeSendRef = useRef<ActiveSendRecord | null>(null)

  // Hoist refs before useRealtimeChatHistory so applyApprovalRequest (returned
  // by usePendingApprovals) is available when the hook is called. These refs
  // are read non-reactively inside E28's timer callback.
  const waitingForResponseRef = useRef(waitingForResponse)
  useEffect(() => {
    waitingForResponseRef.current = waitingForResponse
  }, [waitingForResponse])

  // setWaitingForResponse — moved from chat-screen.tsx because it closes over
  // sessionKeyForWaiting.current which lives in this hook now.
  const setWaitingForResponse = useCallback((waiting: boolean) => {
    const store = useChatStore.getState()
    const key = sessionKeyForWaiting.current
    if (!key) return
    if (waiting) {
      store.setSessionWaiting(key)
    } else {
      store.clearSessionWaiting(key)
    }
  }, [])

  // lastCompletedRunAt decoupling: the realtime chat-history hook depends on
  // applyApprovalRequest (from usePendingApprovals) which depends on
  // waitingForResponseRef (from this hook) — a cycle. The screen calls
  // syncLastCompletedRunAt after the realtime hook returns; the state bump
  // re-triggers the 10 s failsafe effect exactly as the original dep did.
  const lastCompletedRunAtRef = useRef<number | null>(null)
  const [lastCompletedRunAtVersion, setLastCompletedRunAtVersion] = useState(0)
  const syncLastCompletedRunAt = useCallback((value: number | null) => {
    if (lastCompletedRunAtRef.current !== value) {
      lastCompletedRunAtRef.current = value
      setLastCompletedRunAtVersion((v) => v + 1)
    }
  }, [])

  // --- Group B: Timer/stream lifecycle functions ---

  // --- Stream management ---
  const streamStop = useCallback(() => {
    if (streamTimer.current) {
      window.clearTimeout(streamTimer.current)
      streamTimer.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      streamStop()
      if (failsafeTimerRef.current) {
        window.clearTimeout(failsafeTimerRef.current)
        failsafeTimerRef.current = null
      }
    }
  }, [streamStop])

  const streamFinish = useCallback(() => {
    streamStop()
    if (failsafeTimerRef.current) {
      window.clearTimeout(failsafeTimerRef.current)
      failsafeTimerRef.current = null
    }
    setPendingGeneration(false)
    setWaitingForResponse(false)
    // Issue #53 — also drop the local `sending` flag. The composer's
    // disabled state is keyed off `sending`, so without this the 120s
    // failsafe (see send flow below) clears the spinner but leaves the
    // composer + model selector unclickable until the page is reloaded.
    setSending(false)
  }, [streamStop]) // eslint-disable-line react-hooks/exhaustive-deps -- setWaitingForResponse + setSending + setPendingGeneration are stable

  const streamStart = useCallback(() => {
    if (!activeFriendlyId || isNewChat) return
    // Bug #3 fix: no more 350ms polling loop — SSE handles realtime updates.
    // Single delayed fetch as fallback to catch the initial response.
    if (streamTimer.current) window.clearTimeout(streamTimer.current)
    streamTimer.current = window.setTimeout(() => {
      if (activeRealtimeStreamingRef.current) return
      refreshHistoryRef.current()
    }, 2000)
  }, [activeFriendlyId, isNewChat]) // eslint-disable-line react-hooks/exhaustive-deps -- activeRealtimeStreamingRef + refreshHistoryRef are stable refs

  // Failsafe: clear after done event + 10s if response never shows in display
  useEffect(() => {
    if (lastCompletedRunAtRef.current && waitingForResponse) {
      const timer = window.setTimeout(() => streamFinish(), 10000)
      return () => window.clearTimeout(timer)
    }
  }, [lastCompletedRunAtVersion, waitingForResponse, streamFinish])

  // Hard failsafe: if waiting for 5s+ and SSE missed the done event, refetch history
  useEffect(() => {
    if (!waitingForResponse) return
    const fallback = window.setTimeout(() => {
      if (activeRealtimeStreamingRef.current) return
      refreshHistoryRef.current()
    }, 5000)
    return () => window.clearTimeout(fallback)
  }, [waitingForResponse]) // eslint-disable-line react-hooks/exhaustive-deps -- activeRealtimeStreamingRef + refreshHistoryRef are stable refs

  // --- Group C (PR 2): sendMessage ---
  // Moved verbatim from chat-screen.tsx — the core send-path function.
  //
  // Late-bound dependencies (startStreaming, clearCompletedStreaming,
  // finalDisplayMessages, currentModel) are read from RefObject bridges
  // so sendMessage always sees the latest value without needing them in
  // the useCallback deps. This is necessary because the producing hooks
  // (useRealtimeChatHistory, useStreamingMessage, useMemo) run AFTER
  // this hook in the render order due to the waitingForResponseRef →
  // usePendingApprovals → useRealtimeChatHistory dependency chain.

  const sendMessage = useCallback(
    function sendMessage(
      sessionKey: string,
      friendlyId: string,
      body: string,
      attachments: Array<ChatAttachment> = [],
      fastMode = false,
      skipOptimistic = false,
      existingClientId = '',
    ) {
      // Read from ref so we always get the latest value without capturing it in deps
      const currentThinkingLevel = thinkingLevelRef.current
      setLocalActivity('reading')
      const normalizedAttachments = attachments.map((attachment) => ({
        ...attachment,
        id: attachment.id ?? crypto.randomUUID(),
      }))

      // Inject text/file attachment content directly into the message body.
      // Servers reliably forward text in the message body; file attachments
      // may be silently dropped for non-image types.
      const textBlocks = normalizedAttachments
        .filter((a) => {
          const mime =
            normalizeMimeType(a.contentType ?? '') ||
            readDataUrlMimeType(a.dataUrl ?? '')
          return !isImageMimeType(mime) && (a.dataUrl ?? '').length > 0
        })
        .map((a) => {
          const raw = a.dataUrl ?? ''
          const content = raw.startsWith('data:')
            ? atob(raw.split(',')[1] ?? '')
            : raw
          return `\n\n<attachment name="${a.name ?? 'file'}">\n${content}\n</attachment>`
        })
      const enrichedBody = body + textBlocks.join('')

      let optimisticClientId = existingClientId
      setResearchResetKey((current) => current + 1)
      if (!skipOptimistic) {
        const { clientId, optimisticMessage } = createOptimisticMessage(
          body,
          normalizedAttachments,
        )
        optimisticClientId = clientId
        appendHistoryMessage(
          queryClient,
          friendlyId,
          sessionKey,
          optimisticMessage,
        )
        updateSessionLastMessage(
          queryClient,
          sessionKey,
          friendlyId,
          optimisticMessage,
        )
      }

      setPendingGeneration(true)
      setSending(true)
      setError(null)
      clearCompletedStreamingRef.current()
      setWaitingForResponse(true)
      activeSendRef.current = {
        sessionKey,
        friendlyId,
        clientId: optimisticClientId,
      }

      // Failsafe: keep frontend aligned with the backend send-stream timeout.
      // Prevents the composer from re-enabling while the backend is still
      // processing a long-running request (#122).
      if (failsafeTimerRef.current) {
        window.clearTimeout(failsafeTimerRef.current)
      }
      failsafeTimerRef.current = window.setTimeout(() => {
        streamFinish()
      }, 600_000)

      // Send a compatibility shape for attachment parsing.
      // Different server/channel versions read different keys.
      const payloadAttachments = normalizedAttachments.map((attachment) => {
        const mimeType =
          normalizeMimeType(attachment.contentType) ||
          readDataUrlMimeType(attachment.dataUrl)
        const isImage = isImageMimeType(mimeType)
        // For text/file attachments, dataUrl holds raw text (not a base64 data URL).
        // We must base64-encode it so the server can build a valid data: URI.
        const rawDataUrl = attachment.dataUrl ?? ''
        let encodedContent: string
        let finalDataUrl: string
        if (!isImage && !rawDataUrl.startsWith('data:')) {
          encodedContent = btoa(unescape(encodeURIComponent(rawDataUrl)))
          finalDataUrl = mimeType
            ? `data:${mimeType};base64,${encodedContent}`
            : `data:text/plain;base64,${encodedContent}`
        } else {
          encodedContent = stripDataUrlPrefix(rawDataUrl)
          finalDataUrl = rawDataUrl
        }
        return {
          id: attachment.id,
          name: attachment.name,
          fileName: attachment.name,
          contentType: mimeType || undefined,
          mimeType: mimeType || undefined,
          mediaType: mimeType || undefined,
          type: isImage ? 'image' : 'file',
          content: encodedContent,
          data: encodedContent,
          base64: encodedContent,
          dataUrl: finalDataUrl,
          size: attachment.size,
        }
      })
      const history = buildPortableHistory(finalDisplayMessagesRef.current)

      try {
        streamStart()
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn('[chat] streamStart error (non-fatal):', e)
        }
      }

      const currentModel = currentModelRef.current
      void startStreamingRef.current({
        sessionKey,
        friendlyId,
        message: enrichedBody,
        history,
        attachments:
          payloadAttachments.length > 0 ? payloadAttachments : undefined,
        thinking:
          currentThinkingLevel === 'off' ? undefined : currentThinkingLevel,
        fastMode,
        model: currentModel || undefined,
        idempotencyKey: optimisticClientId || crypto.randomUUID(),
      }).catch((err: unknown) => {
        const messageText = err instanceof Error ? err.message : String(err)
        if (import.meta.env.DEV) {
          console.warn('[chat] send-stream failed', messageText)
        }
      })
    },
    // All late-bound values are accessed via refs (stable), so the only
    // reactive deps are the direct-value params and internal lifecycle fns.
    [
      queryClient,
      setLocalActivity,
      streamFinish,
      streamStart,
    ], // eslint-disable-line react-hooks/exhaustive-deps -- setError + setResearchResetKey are stable useState setters; thinkingLevelRef + clearCompletedStreamingRef + startStreamingRef + finalDisplayMessagesRef + currentModelRef are stable refs
  )

  // --- Group D (PR 3): SSE Callbacks ---
  // Moved verbatim from chat-screen.tsx — these are the callbacks passed
  // to useStreamingMessage. They own the send-path lifecycle side effects
  // (optimistic message updates, state clears, session-list invalidation,
  // sound, toast, navigation).

  const onSessionResolved = useCallback(
    ({
      sessionKey,
      friendlyId,
    }: {
      sessionKey: string
      friendlyId: string
    }) => {
      const activeSend = activeSendRef.current
      if (activeSend) {
        activeSendRef.current = {
          ...activeSend,
          sessionKey,
          friendlyId,
        }
      }
      if (
        sessionKey === activeFriendlyId &&
        friendlyId === activeFriendlyId
      ) {
        return
      }
      onSessionResolvedProp?.({ sessionKey, friendlyId })
    },
    [activeFriendlyId, onSessionResolvedProp],
  )

  const onStarted = useCallback(
    ({ runId }: { runId: string | null }) => {
      const activeSend = activeSendRef.current
      if (!activeSend?.clientId) return
      updateHistoryMessageByClientIdEverywhere(
        queryClient,
        activeSend.clientId,
        (message) => ({
          ...message,
          status: 'sent',
          runId: runId ?? message.runId,
        }),
      )
      setSending(false)
    },
    [queryClient],
  )

  const onComplete = useCallback(() => {
    const activeSend = activeSendRef.current
    if (activeSend?.clientId) {
      updateHistoryMessageByClientIdEverywhere(
        queryClient,
        activeSend.clientId,
        (message) => ({
          ...message,
          status: 'done',
        }),
      )
    }
    activeSendRef.current = null
    refreshHistoryRef.current()
    setSending(false)
    // Invalidate both session-list caches so the session moves into today's
    // bucket immediately after the assistant response completes (last_active is
    // freshest at this point — gateway updatedAt reflects the just-finished turn) (#218).
    invalidateSessionLists(queryClient)
    // Clear waitingForResponse so ThinkingBubble hides and message renders
    streamFinish()
    // Play notification sound if the user opted in (Settings → Chat).
    // Read directly from the store to avoid re-creating this callback on every settings change.
    if (useChatSettingsStore.getState().settings.soundOnChatComplete) {
      playChatComplete()
    }
  }, [queryClient, streamFinish])

  const onError = useCallback(
    (messageText: string) => {
      const activeSend = activeSendRef.current
      if (activeSend?.clientId && !isMissingAuth(messageText)) {
        updateHistoryMessageByClientIdEverywhere(
          queryClient,
          activeSend.clientId,
          (message) => ({
            ...message,
            status: 'error',
          }),
        )
      }
      activeSendRef.current = null
      setSending(false)
      if (isMissingAuth(messageText)) {
        // Clear waiting before the early return — otherwise an auth-failure
        // error strands waitingSessionKeys for the full 120s TTL and the
        // composer shows a stuck spinner if the user returns to the session
        // within that window. See #120.
        setPendingGeneration(false)
        setWaitingForResponse(false)
        if (!embedded) {
          try {
            navigate({ to: '/', replace: true })
          } catch {
            /* router not ready */
          }
        }
        return
      }
      const errorMessage = `Failed to send message. ${messageText}`
      setError(errorMessage)
      toast('Failed to send message', { type: 'error' })
      showErrorToast(messageText)
      setPendingGeneration(false)
      setWaitingForResponse(false)
    },
    [navigate, queryClient], // eslint-disable-line react-hooks/exhaustive-deps -- embedded + setError + setSending + setWaitingForResponse are stable/screen-level values
  )

  const onMessageAccepted = useCallback(
    (_sessionKey: string, friendlyId: string, clientId: string) => {
      // HTTP 200 received — server accepted the message. Clear "sending"
      // status immediately so the Retry timer never fires. This is the
      // primary confirmation path since the server does NOT echo user
      // messages back via SSE.
      updateHistoryMessageByClientId(
        queryClient,
        friendlyId,
        _sessionKey,
        clientId,
        (message) => ({
          ...message,
          status: 'queued',
        }),
      )
      updateHistoryMessageByClientIdEverywhere(
        queryClient,
        clientId,
        (message) => ({
          ...message,
          status: 'queued',
        }),
      )
    },
    [queryClient],
  )

  const onAbort = useCallback(() => {
    activeSendRef.current = null
    setSending(false)
    setPendingGeneration(false)
    setWaitingForResponse(false)
  }, [setWaitingForResponse])

  // --- Group E (PR 3): Abort Helpers ---

  const reconcileStuckBusyState = useCallback(
    (sessionKey: string) => {
      activeSendRef.current = null
      if (sessionKey) {
        useChatStore.getState().clearStreamingSession(sessionKey)
      }
      streamFinish()
    },
    [streamFinish],
  )

  const handleAbortStreaming = useCallback(() => {
    const activeSend = activeSendRef.current
    if (activeSend?.clientId) {
      updateHistoryMessageByClientIdEverywhere(
        queryClient,
        activeSend.clientId,
        (message) => ({
          ...message,
          status: 'sent',
        }),
      )
    }
    activeSendRef.current = null
    cancelStreamingRef.current?.()
    setSending(false)
    setPendingGeneration(false)
    setWaitingForResponse(false)
  }, [queryClient]) // eslint-disable-line react-hooks/exhaustive-deps -- cancelStreamingRef is a stable ref; setSending + setWaitingForResponse + setPendingGeneration are stable

  return {
    sending,
    setSending,
    activeSendRef,
    waitingForResponseRef,
    sessionKeyForWaiting,
    lastSendKeyRef,
    lastSendAtRef,
    streamTimer,
    failsafeTimerRef,
    refreshHistoryRef,
    streamStop,
    streamStart,
    streamFinish,
    setWaitingForResponse,
    syncLastCompletedRunAt,
    sendMessage,
    onSessionResolved,
    onStarted,
    onComplete,
    onError,
    onMessageAccepted,
    onAbort,
    reconcileStuckBusyState,
    handleAbortStreaming,
  }
}
