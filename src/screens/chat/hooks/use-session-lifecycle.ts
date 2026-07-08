import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  appendHistoryMessage,
  chatQueryKeys,
} from '../chat-queries'
import {
  consumePendingSend,
  hasPendingGeneration,
  hasPendingSend,
} from '../pending-send'
import type { RefObject } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import type { ChatAttachment } from '../types'

export function useSessionLifecycle(params: {
  isNewChat: boolean
  activeFriendlyId: string | undefined
  activeSessionKey: string
  forcedSessionKey: string | undefined
  resolvedSessionKey: string
  isPortableMode: boolean
  portableChatFriendlyId: string | undefined
  queryClient: QueryClient
  sendMessage: (
    sessionKey: string,
    friendlyId: string,
    body: string,
    attachments?: Array<ChatAttachment>,
    fastMode?: boolean,
    skipOptimistic?: boolean,
    existingClientId?: string,
  ) => void
  setWaitingForResponse: (waiting: boolean) => void
  streamStop: () => void
  retriedQueuedMessageKeysRef: RefObject<Set<string>>
}): void {
  const {
    isNewChat,
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    resolvedSessionKey,
    isPortableMode,
    portableChatFriendlyId,
    queryClient,
    sendMessage,
    setWaitingForResponse,
    streamStop,
    retriedQueuedMessageKeysRef,
  } = params

  // These two refs are used exclusively by the two effects below, so they
  // live here rather than in the screen.
  const pendingStartRef = useRef(false)
  const lastAssistantSignature = useRef('')

  // Reset state when session changes
  useEffect(() => {
    const resetKey = isNewChat ? 'new' : activeFriendlyId
    if (!resetKey) return
    retriedQueuedMessageKeysRef.current.clear()
    if (pendingStartRef.current) {
      pendingStartRef.current = false
      return
    }
    if (hasPendingSend() || hasPendingGeneration()) {
      setWaitingForResponse(true)
      return
    }
    streamStop()
    lastAssistantSignature.current = ''
    setWaitingForResponse(false)
  }, [activeFriendlyId, isNewChat, streamStop])

  useLayoutEffect(() => {
    if (isNewChat) return
    const pending = consumePendingSend(
      isPortableMode
        ? 'main'
        : forcedSessionKey || resolvedSessionKey || activeSessionKey,
      portableChatFriendlyId,
    )
    if (!pending) return
    pendingStartRef.current = true
    const historyKey = chatQueryKeys.history(
      pending.friendlyId,
      pending.sessionKey,
    )
    const cached = queryClient.getQueryData(historyKey)
    const cachedMessages = Array.isArray((cached as any)?.messages)
      ? (cached as any).messages
      : []
    const alreadyHasOptimistic = cachedMessages.some((message: any) => {
      if (pending.optimisticMessage.clientId) {
        if (message.clientId === pending.optimisticMessage.clientId) return true
        if (message.__optimisticId === pending.optimisticMessage.clientId)
          return true
      }
      if (pending.optimisticMessage.__optimisticId) {
        if (message.__optimisticId === pending.optimisticMessage.__optimisticId)
          return true
      }
      return false
    })
    if (!alreadyHasOptimistic) {
      appendHistoryMessage(
        queryClient,
        pending.friendlyId,
        pending.sessionKey,
        pending.optimisticMessage,
      )
    }
    setWaitingForResponse(true)
    sendMessage(
      pending.sessionKey,
      pending.friendlyId,
      pending.message,
      pending.attachments,
      false,
      true,
      typeof pending.optimisticMessage.clientId === 'string'
        ? pending.optimisticMessage.clientId
        : '',
    )
  }, [
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    isPortableMode,
    portableChatFriendlyId,
    queryClient,
    resolvedSessionKey,
    sendMessage,
  ])
}
