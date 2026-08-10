import { useCallback } from 'react'

import { resolveNewChatBootstrapSession } from '../new-chat-bootstrap'
import { createOptimisticMessage } from '../chat-screen-utils'
import { appendHistoryMessage } from '../chat-queries'
import {
  hasPendingGeneration,
  setPendingGeneration,
} from '../pending-send'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatAttachment, ChatMessage } from '../types'
import type { ActiveSendRecord } from './use-send-message-state'
import { useChatStore } from '@/stores/chat-store'
import { hapticTap } from '@/lib/haptics'

/**
 * useComposerSend — owns the composer onSubmit handler ("send").
 *
 * Extracted verbatim from chat-screen.tsx (Group F). This hook wraps the
 * ~150-line send function that handles:
 *
 * 1. Input validation — empty-body guard, UI slash commands, custom slash
 *    command expansion.
 * 2. Dedup guard — 500ms window for identical content using lastSendKeyRef
 *    + lastSendAtRef to prevent double-fire from paste events.
 * 3. Queue routing — derives queueSessionKeyForSend, checks
 *    shouldQueueInsteadOfSend (composer busy, active send, pending
 *    generation, session waiting), enqueues via useChatStore.getState().enqueue().
 * 4. UI side-effects — haptic feedback, helpers.reset(), scroll-to-bottom
 *    via requestAnimationFrame.
 * 5. New-chat bootstrap — async path that resolves session via
 *    resolveNewChatBootstrapSession, creates optimistic message, calls
 *    sendMessage, navigates to new route.
 * 6. Existing-session send — calls sendMessage with derived session key.
 *
 * Pure move — no behavior change from chat-screen.tsx.
 */
export function useComposerSend(params: {
  // Session routing
  activeFriendlyId: string
  activeSessionKey: string | undefined
  activeCanonicalKey: string
  activeQueueSessionKey: string
  forcedSessionKey: string | undefined
  resolvedSessionKey: string | undefined
  isNewChat: boolean
  isPortableMode: boolean
  embedded: boolean

  // Store/cache
  queryClient: QueryClient

  // Refs
  lastSendKeyRef: RefObject<string>
  lastSendAtRef: RefObject<number>
  lastQueueSessionKeyRef: RefObject<string>
  activeSendRef: RefObject<ActiveSendRecord | null>
  isComposerLoadingRef: RefObject<boolean>

  // Functions from other hooks
  sendMessage: (
    sessionKey: string,
    friendlyId: string,
    body: string,
    attachments?: Array<ChatAttachment>,
    fastMode?: boolean,
    skipOptimistic?: boolean,
    existingClientId?: string,
  ) => void
  handleUiSlashCommand: (command: string) => boolean
  expandCustomSlashCommand: (input: string) => string | null
  scrollChatToBottom: (behavior?: ScrollBehavior) => void
  createSessionForMessage: (
    preferredFriendlyId?: string,
  ) => Promise<{ sessionKey: string; friendlyId: string }>
  upsertSessionInCache: (friendlyId: string, lastMessage: ChatMessage) => void
  /**
   * The app's one send-failure surface (`useSendMessageState`): marks the
   * optimistic row, clears sending/waiting, sets the inline error and raises
   * the toast (routing profile refusals through the error-toast classifier).
   * Session creation is part of sending, so its failures belong here too —
   * before this, a refused `POST /api/sessions` rejected out of an un-awaited
   * promise and the user got a console stack trace, no toast, and a message
   * that silently never sent.
   */
  onError: (message: string) => void

  // Navigation
  navigate: (opts: {
    to: string
    params?: Record<string, string>
    replace?: boolean
  }) => void

  // State setters (from useSendMessageState)
  setSending: Dispatch<SetStateAction<boolean>>
  setWaitingForResponse: (waiting: boolean) => void

  // UI
  isMobile: boolean
}): {
  send: (
    body: string,
    attachments: Array<ChatComposerAttachment>,
    fastMode: boolean,
    helpers: ChatComposerHelpers,
  ) => Promise<void>
} {
  const {
    activeFriendlyId,
    activeSessionKey,
    activeCanonicalKey,
    activeQueueSessionKey,
    forcedSessionKey,
    resolvedSessionKey,
    isNewChat,
    isPortableMode,
    embedded,
    queryClient,
    lastSendKeyRef,
    lastSendAtRef,
    lastQueueSessionKeyRef,
    activeSendRef,
    isComposerLoadingRef,
    sendMessage,
    handleUiSlashCommand,
    expandCustomSlashCommand,
    scrollChatToBottom,
    createSessionForMessage,
    upsertSessionInCache,
    onError,
    navigate,
    setSending,
    setWaitingForResponse,
    isMobile,
  } = params

  const send = useCallback(
    async (
      body: string,
      attachments: Array<ChatComposerAttachment>,
      fastMode: boolean,
      helpers: ChatComposerHelpers,
    ) => {
      const trimmedBody = body.trim()
      if (trimmedBody.length === 0 && attachments.length === 0) return
      if (attachments.length === 0 && handleUiSlashCommand(trimmedBody))
        return
      const messageBody = expandCustomSlashCommand(trimmedBody) ?? trimmedBody

      // Deduplicate sends with identical content within a 500ms window.
      // This prevents double-fire from paste events that trigger multiple send paths.
      const sendKey = `${messageBody}|${attachments.map((a) => `${a.name}:${a.size}`).join(',')}`
      const now = Date.now()
      if (
        sendKey === lastSendKeyRef.current &&
        now - lastSendAtRef.current < 500
      )
        return
      lastSendKeyRef.current = sendKey
      lastSendAtRef.current = now

      const queueSessionKeyForSend =
        activeQueueSessionKey ||
        activeSendRef.current?.sessionKey ||
        lastQueueSessionKeyRef.current ||
        (isPortableMode
          ? 'main'
          : forcedSessionKey ||
            resolvedSessionKey ||
            activeSessionKey ||
            activeCanonicalKey ||
            activeFriendlyId)
      const shouldQueueInsteadOfSend =
        Boolean(queueSessionKeyForSend) &&
        (isComposerLoadingRef.current ||
          Boolean(activeSendRef.current) ||
          hasPendingGeneration() ||
          (queueSessionKeyForSend
            ? useChatStore.getState().isSessionWaiting(queueSessionKeyForSend)
            : false))

      if (shouldQueueInsteadOfSend && queueSessionKeyForSend) {
        useChatStore.getState().enqueue(queueSessionKeyForSend, {
          id: crypto.randomUUID(),
          text: messageBody,
          attachments: attachments.map((attachment) => ({ ...attachment })),
        })
        helpers.reset()
        return
      }

      // Haptic feedback on mobile when message is sent
      if (isMobile) hapticTap()

      helpers.reset()

      // Scroll to bottom immediately so user sees their message + incoming response
      requestAnimationFrame(() => scrollChatToBottom('smooth'))

      const attachmentPayload: Array<ChatAttachment> = attachments.map(
        (attachment) => ({
          ...attachment,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
          id: attachment.id ?? crypto.randomUUID(),
        }),
      )

      if (isNewChat) {
        // Create/resolve the concrete session before first send. The old flow
        // generated a UUID, fired createSession() in the background, and then
        // immediately streamed against the UUID. If registration lagged or the
        // backend returned a different persisted id, the first send hit
        // /api/sessions/<uuid>/chat/stream with a session that never existed.
        let bootstrap: { sessionKey: string; friendlyId: string }
        try {
          bootstrap = await resolveNewChatBootstrapSession({
            createSessionForMessage,
            generateThreadId: () => crypto.randomUUID(),
            isPortableMode,
          })
        } catch (err) {
          // Creating the session is the first half of sending, and it can be
          // refused for the same reasons a send can (most visibly a profile
          // scope refusal: `POST /api/sessions` → 409). Route it through the
          // same failure surface as every other send error instead of letting
          // it escape as an unhandled rejection.
          //
          // `helpers.reset()` already emptied the composer above, on the
          // assumption the message was on its way. It wasn't — nothing was
          // written anywhere, so put the user's text and attachments back
          // rather than making them retype. The raw body is restored (not the
          // slash-expanded one) so a retry behaves identically to the first
          // attempt.
          helpers.setValue(body)
          if (attachments.length > 0) helpers.setAttachments(attachments)
          // The 500ms identical-content guard above would otherwise swallow an
          // immediate retry of the message that just failed.
          lastSendKeyRef.current = ''
          onError(err instanceof Error ? err.message : String(err))
          return
        }
        const { sessionKey: threadId, friendlyId: routeFriendlyId } = bootstrap
        const { optimisticMessage } = createOptimisticMessage(
          messageBody,
          attachmentPayload,
        )
        appendHistoryMessage(
          queryClient,
          routeFriendlyId,
          threadId,
          optimisticMessage,
        )
        upsertSessionInCache(routeFriendlyId, optimisticMessage)
        setPendingGeneration(true)
        setSending(true)
        setWaitingForResponse(true)

        sendMessage(
          threadId,
          routeFriendlyId,
          messageBody,
          attachmentPayload,
          fastMode,
          true,
          typeof optimisticMessage.clientId === 'string'
            ? optimisticMessage.clientId
            : '',
        )
        // In portable mode, navigate to /chat/main instead of a transient UUID.
        if (!embedded) {
          navigate({
            to: '/chat/$sessionKey',
            params: { sessionKey: routeFriendlyId },
            replace: true,
          })
        }
        return
      }

      const sessionKeyForSend = isPortableMode
        ? 'main'
        : forcedSessionKey || resolvedSessionKey || activeSessionKey || 'main'
      sendMessage(
        sessionKeyForSend,
        isPortableMode ? 'main' : activeFriendlyId,
        messageBody,
        attachmentPayload,
        fastMode,
      )
    },
    [
      activeFriendlyId,
      activeSessionKey,
      activeCanonicalKey,
      activeQueueSessionKey,
      createSessionForMessage,
      forcedSessionKey,
      isComposerLoadingRef,
      isNewChat,
      isPortableMode,
      lastSendKeyRef,
      navigate,
      onError,
      scrollChatToBottom,
      sendMessage,
      upsertSessionInCache,
      queryClient,
      resolvedSessionKey,
      handleUiSlashCommand,
      expandCustomSlashCommand,
    ],
  )

  return { send }
}
