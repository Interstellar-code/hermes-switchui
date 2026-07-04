import { useCallback, useEffect } from 'react'
import type { RefObject } from 'react'

import { useChatStore } from '../../../stores/chat-store'
import { readMessageText } from '../chat-screen-utils'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'

/**
 * Interrupted-session affordance + message-queue drain.
 *
 * Two responsibilities, both originally inlined in `chat-screen.tsx`:
 *
 * 1. **Interrupted session** — surfaces whether the current session was marked
 *    interrupted (e.g. a prior run was killed mid-stream) and provides a
 *    `handleResendInterrupted` callback that clears the flag and re-sends the
 *    last non-optimistic user message (or refetches history when none exists).
 *
 * 2. **Queue drain** — on the falling edge of `isComposerLoading`, dequeues the
 *    next pending message for the active session and sends it. This is the
 *    happy-path drain; the `useDrainWatchdog` hook is the escape hatch when SSE
 *    completion events are dropped.
 *
 * Placed AFTER `send` in the original component so the closure can capture it
 * without a temporal-dead-zone error; the same ordering applies here because
 * `send` is a parameter.
 */
export function useMessageRetry({
  resolvedSessionKey,
  finalDisplayMessages,
  isComposerLoading,
  activeQueueSessionKey,
  lastQueueSessionKeyRef,
  commandHelpers,
  send,
  refetchHistory,
}: {
  resolvedSessionKey: string | undefined
  finalDisplayMessages: Array<ChatMessage>
  isComposerLoading: boolean
  activeQueueSessionKey: string
  lastQueueSessionKeyRef: RefObject<string>
  commandHelpers: ChatComposerHelpers
  send: (
    body: string,
    attachments: Array<ChatComposerAttachment>,
    fastMode: boolean,
    helpers: ChatComposerHelpers,
  ) => Promise<void>
  refetchHistory: () => void
}): {
  isCurrentSessionInterrupted: boolean
  handleResendInterrupted: () => void
} {
  // Phase 1.2: interrupted affordance handlers. Placed AFTER `send` so
  // the closure can capture it without a temporal-dead-zone error.
  const isCurrentSessionInterrupted = useChatStore((state) =>
    resolvedSessionKey ? state.isSessionInterrupted(resolvedSessionKey) : false,
  )

  const handleResendInterrupted = useCallback(() => {
    if (!resolvedSessionKey) return
    const store = useChatStore.getState()
    store.clearSessionInterrupted(resolvedSessionKey)
    const lastUser = [...finalDisplayMessages]
      .reverse()
      .find((m) => m?.role === 'user' && !m.__optimisticId)
    if (lastUser && typeof lastUser.content !== 'undefined') {
      const text = readMessageText(lastUser)
      if (text.trim()) {
        send(text, [], false, commandHelpers)
      }
    } else {
      // No user message found — still clear the flag and let the user
      // re-type. This handles the "interrupted but history is empty" edge.
      void refetchHistory()
    }
  }, [
    resolvedSessionKey,
    finalDisplayMessages,
    send,
    commandHelpers,
    refetchHistory,
  ])

  useEffect(() => {
    if (isComposerLoading) return

    const sessionKey = activeQueueSessionKey || lastQueueSessionKeyRef.current
    if (!sessionKey) return

    const nextQueued = useChatStore.getState().dequeue(sessionKey)
    if (!nextQueued) return

    send(nextQueued.text, nextQueued.attachments, false, commandHelpers)
  }, [activeQueueSessionKey, isComposerLoading, send])

  return { isCurrentSessionInterrupted, handleResendInterrupted }
}
