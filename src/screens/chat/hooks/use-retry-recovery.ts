import { useCallback, useEffect, useRef } from 'react'
import { textFromMessage } from '../utils'
import {
  updateHistoryMessageByClientId,
  updateHistoryMessageByClientIdEverywhere,
} from '../chat-queries'
import type { RefObject } from 'react'
import type { QueryClient, UseQueryResult } from '@tanstack/react-query'

import type { ChatAttachment, ChatMessage } from '../types'

// ---------------------------------------------------------------------------
// Helpers (moved verbatim from chat-screen.tsx — pure move, no logic change)
// ---------------------------------------------------------------------------

function normalizeMessageValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

function getMessageClientId(message: ChatMessage): string {
  const raw = message as Record<string, unknown>
  const directClientId = normalizeMessageValue(raw.clientId)
  if (directClientId) return directClientId

  const alternateClientId = normalizeMessageValue(raw.client_id)
  if (alternateClientId) return alternateClientId

  const optimisticId = normalizeMessageValue(raw.__optimisticId)
  if (optimisticId.startsWith('opt-')) {
    return optimisticId.slice(4)
  }
  return ''
}

function getRetryMessageKey(message: ChatMessage): string {
  const clientId = getMessageClientId(message)
  if (clientId) return `client:${clientId}`

  const raw = message as Record<string, unknown>
  const optimisticId = normalizeMessageValue(raw.__optimisticId)
  if (optimisticId) return `optimistic:${optimisticId}`

  const messageId = normalizeMessageValue(raw.id)
  if (messageId) return `id:${messageId}`

  const timestamp = normalizeMessageValue(
    typeof raw.timestamp === 'number' ? String(raw.timestamp) : raw.timestamp,
  )
  const messageText = textFromMessage(message).trim()
  return `fallback:${message.role ?? 'unknown'}:${timestamp}:${messageText}`
}

function isRetryableQueuedMessage(message: ChatMessage): boolean {
  if ((message.role || '') !== 'user') return false
  const raw = message as Record<string, unknown>
  const status = normalizeMessageValue(raw.status)
  return status === 'error'
}

function getMessageRetryAttachments(
  message: ChatMessage,
): Array<ChatAttachment> {
  if (!Array.isArray(message.attachments)) return []
  return message.attachments.filter((attachment) => {
    return Boolean(attachment) && typeof attachment === 'object'
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Send-message signature (mirrors useSendMessageState's sendMessage).
 */
export type SendMessageFn = (
  sessionKey: string,
  friendlyId: string,
  body: string,
  attachments?: Array<ChatAttachment>,
  fastMode?: boolean,
  skipOptimistic?: boolean,
  existingClientId?: string,
) => void

/**
 * Minimal shape of the statusQuery we read for health/error detection.
 * Avoids coupling this hook to the full StatusResponse type.
 */
type StatusQueryLike = UseQueryResult<{ ok?: boolean }>

/**
 * Extracted from chat-screen.tsx — pure move, no behavior change.
 *
 * Owns the retry/recovery cluster: retrying queued messages that errored,
 * flushing them on reconnect / health-restored, and the user-facing retry
 * button handler. The three effects wire reconnect, health-restored polling,
 * and the `claude:health-restored` window event.
 *
 * `retriedQueuedMessageKeysRef` is shared with `useSessionLifecycle`, so it
 * stays owned by the screen and is passed in. The two refs that only this
 * cluster used (`hasSeenDisconnectRef`, `hadErrorRef`) are internal to the
 * hook.
 */
export function useRetryRecovery(params: {
  sendMessage: SendMessageFn
  queryClient: QueryClient
  activeSessionKey: string
  forcedSessionKey: string | undefined
  resolvedSessionKey: string
  isPortableMode: boolean
  portableChatFriendlyId: string
  sessionKeyForHistory: string
  finalDisplayMessages: Array<ChatMessage>
  retriedQueuedMessageKeysRef: RefObject<Set<string>>
  statusQuery: StatusQueryLike
  handleRefetch: () => void
}): {
  retryQueuedMessage: (message: ChatMessage, mode: 'manual' | 'auto') => boolean
  flushRetryableMessages: () => void
  handleRetryMessage: (message: ChatMessage) => void
} {
  const {
    sendMessage,
    queryClient,
    activeSessionKey,
    forcedSessionKey,
    resolvedSessionKey,
    isPortableMode,
    portableChatFriendlyId,
    sessionKeyForHistory,
    finalDisplayMessages,
    retriedQueuedMessageKeysRef,
    statusQuery,
    handleRefetch,
  } = params

  // Internal refs (formerly hasSeenDisconnectRef / hadErrorRef in the screen).
  const hasSeenDisconnectRef = useRef(false)
  const hadErrorRef = useRef(false)

  const retryQueuedMessage = useCallback(
    (message: ChatMessage, mode: 'manual' | 'auto') => {
      if (!isRetryableQueuedMessage(message)) return false

      const body = textFromMessage(message).trim()
      const attachments = getMessageRetryAttachments(message)
      if (body.length === 0 && attachments.length === 0) return false

      const retryKey = getRetryMessageKey(message)
      if (
        mode === 'auto' &&
        retriedQueuedMessageKeysRef.current.has(retryKey)
      ) {
        return false
      }

      const sessionKeyForSend = isPortableMode
        ? 'main'
        : forcedSessionKey || resolvedSessionKey || activeSessionKey || 'main'
      const sessionKeyForMessage = sessionKeyForHistory || sessionKeyForSend
      const existingClientId = getMessageClientId(message)

      if (existingClientId) {
        updateHistoryMessageByClientId(
          queryClient,
          portableChatFriendlyId,
          sessionKeyForMessage,
          existingClientId,
          function markSending(currentMessage) {
            return { ...currentMessage, status: 'sending' }
          },
        )
        updateHistoryMessageByClientIdEverywhere(
          queryClient,
          existingClientId,
          function markSendingEverywhere(currentMessage) {
            return { ...currentMessage, status: 'sending' }
          },
        )
      }

      if (mode === 'auto') {
        retriedQueuedMessageKeysRef.current.add(retryKey)
      }

      sendMessage(
        sessionKeyForSend,
        portableChatFriendlyId,
        body,
        attachments,
        false,
        true,
        existingClientId,
      )
      return true
    },
    [
      activeSessionKey,
      forcedSessionKey,
      isPortableMode,
      portableChatFriendlyId,
      queryClient,
      resolvedSessionKey,
      sessionKeyForHistory,
      sendMessage,
    ],
  )

  const flushRetryableMessages = useCallback(
    () => {
      for (const message of finalDisplayMessages) {
        retryQueuedMessage(message, 'auto')
      }
    },
    [finalDisplayMessages, retryQueuedMessage],
  )

  const handleRetryMessage = useCallback(
    (message: ChatMessage) => {
      const retryKey = getRetryMessageKey(message)
      retriedQueuedMessageKeysRef.current.delete(retryKey)
      retryQueuedMessage(message, 'manual')
    },
    [retryQueuedMessage],
  )

  useEffect(() => {
    if (hasSeenDisconnectRef.current) {
      hasSeenDisconnectRef.current = false
      flushRetryableMessages()
    }
  }, [flushRetryableMessages])

  useEffect(() => {
    const isHealthy = statusQuery.data?.ok === true
    if (isHealthy && hadErrorRef.current) {
      hadErrorRef.current = false
      flushRetryableMessages()
    }
  }, [flushRetryableMessages, statusQuery.data])

  useEffect(() => {
    function handleHealthRestored() {
      retriedQueuedMessageKeysRef.current.clear()
      hadErrorRef.current = false
      flushRetryableMessages()
      handleRefetch()
    }

    window.addEventListener('claude:health-restored', handleHealthRestored)
    return () => {
      window.removeEventListener('claude:health-restored', handleHealthRestored)
    }
  }, [flushRetryableMessages, handleRefetch])

  return { retryQueuedMessage, flushRetryableMessages, handleRetryMessage }
}
