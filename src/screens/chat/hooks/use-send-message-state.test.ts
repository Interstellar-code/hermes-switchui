// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatStore } from '../../../stores/chat-store'
import { createOptimisticMessage } from '../chat-screen-utils'
import {
  appendHistoryMessage,
  updateHistoryMessageByClientId,
  updateHistoryMessageByClientIdEverywhere,
  updateSessionLastMessage,
} from '../chat-queries'
import { invalidateSessionLists } from '../sessions-feed'
import { isMissingAuth, missingAuthMessage } from '../utils'
import { useSendMessageState } from './use-send-message-state'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { AgentActivity } from '@/stores/chat-activity-store'
import type { ChatAttachment, ChatMessage } from '../types'

// Import mocked functions for assertion
import { playChatComplete } from '@/lib/sounds'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import { toast } from '@/components/ui/toast'
import { showErrorToast } from '@/components/error-toast'

// --- Mocks for sendMessage dependencies ---

vi.mock('../chat-screen-utils', () => ({
  createOptimisticMessage: vi.fn(() => ({
    clientId: 'client-test-1',
    optimisticMessage: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      clientId: 'client-test-1',
      status: 'sending',
    },
  })),
}))

vi.mock('../chat-queries', () => ({
  appendHistoryMessage: vi.fn(),
  updateHistoryMessageByClientId: vi.fn(),
  updateHistoryMessageByClientIdEverywhere: vi.fn(),
  updateSessionLastMessage: vi.fn(),
}))

vi.mock('../pending-send', () => ({
  setPendingGeneration: vi.fn(),
  consumePendingSend: vi.fn(),
  hasPendingGeneration: vi.fn(() => false),
  hasPendingSend: vi.fn(() => false),
  isRecentSession: vi.fn(() => false),
  resetPendingSend: vi.fn(),
}))

vi.mock('@/lib/stream-utils', () => ({
  stripDataUrlPrefix: vi.fn((v: string) => v.replace(/^data:[^,]+,/, '')),
}))

vi.mock('../sessions-feed', () => ({
  invalidateSessionLists: vi.fn(),
}))

vi.mock('@/lib/sounds', () => ({
  playChatComplete: vi.fn(),
}))

vi.mock('@/hooks/use-chat-settings', () => ({
  useChatSettingsStore: {
    getState: vi.fn(() => ({ settings: { soundOnChatComplete: false } })),
  },
}))

vi.mock('@/components/ui/toast', () => ({
  toast: vi.fn(),
}))

vi.mock('@/components/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

function makeBooleanRef(initial = false): RefObject<boolean> {
  return { current: initial }
}

function makeStringRef(initial = ''): RefObject<string> {
  return { current: initial }
}

function makeVoidFnRef(): RefObject<() => void> {
  return { current: vi.fn() }
}

function makeStartStreamingRef(): RefObject<
  (params: Record<string, unknown>) => Promise<void>
> {
  return { current: vi.fn(async () => {}) }
}

function makeMessagesRef(
  messages: Array<ChatMessage> = [],
): RefObject<Array<ChatMessage>> {
  return { current: messages }
}

function makeModelRef(
  model: string | undefined = undefined,
): RefObject<string | undefined> {
  return { current: model }
}

/** Build a full params object with sensible mocks for all PR 2 fields. */
function makeParams(overrides?: {
  activeFriendlyId?: string | undefined
  isNewChat?: boolean
  waitingForResponse?: boolean
  thinkingLevelRef?: RefObject<string>
  setLocalActivity?: (a: AgentActivity) => void
  setError?: Dispatch<SetStateAction<string | null>>
  clearCompletedStreamingRef?: RefObject<() => void>
  startStreamingRef?: RefObject<
    (params: Record<string, unknown>) => Promise<void>
  >
  queryClient?: unknown
  finalDisplayMessagesRef?: RefObject<Array<ChatMessage>>
  currentModelRef?: RefObject<string | undefined>
  onSessionResolved?: (params: {
    sessionKey: string
    friendlyId: string
  }) => void
  navigate?: (opts: { to: string; replace: boolean }) => void
  embedded?: boolean
  cancelStreamingRef?: RefObject<(() => void) | null>
}): Parameters<typeof useSendMessageState>[0] {
  const o = overrides ?? {}
  return {
    activeFriendlyId: 'activeFriendlyId' in o ? o.activeFriendlyId : 'sess-1',
    isNewChat: o.isNewChat ?? false,
    waitingForResponse: o.waitingForResponse ?? false,
    activeRealtimeStreamingRef: makeBooleanRef(),
    thinkingLevelRef: o.thinkingLevelRef ?? makeStringRef('off'),
    setLocalActivity: (o.setLocalActivity ?? vi.fn()) as (
      a: AgentActivity,
    ) => void,
    setError: (o.setError ?? vi.fn()) as Dispatch<
      SetStateAction<string | null>
    >,
    clearCompletedStreamingRef: o.clearCompletedStreamingRef ?? makeVoidFnRef(),
    startStreamingRef: o.startStreamingRef ?? makeStartStreamingRef(),
    queryClient: (o.queryClient ?? {}) as Parameters<
      typeof useSendMessageState
    >[0]['queryClient'],
    finalDisplayMessagesRef: o.finalDisplayMessagesRef ?? makeMessagesRef([]),
    currentModelRef: o.currentModelRef ?? makeModelRef('test-model'),
    onSessionResolved: o.onSessionResolved,
    navigate: (o.navigate ?? vi.fn()) as (opts: {
      to: string
      replace: boolean
    }) => void,
    embedded: o.embedded ?? false,
    cancelStreamingRef: o.cancelStreamingRef ?? {
      current: null,
    },
  }
}

describe('useSendMessageState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('initialises with correct defaults', () => {
    const { result } = renderHook(() => useSendMessageState(makeParams()))

    expect(result.current.sending).toBe(false)
    expect(result.current.activeSendRef.current).toBeNull()
    expect(result.current.sessionKeyForWaiting.current).toBeUndefined()
    expect(result.current.streamTimer.current).toBeNull()
    expect(result.current.failsafeTimerRef.current).toBeNull()
    expect(result.current.lastSendKeyRef.current).toBe('')
    expect(result.current.lastSendAtRef.current).toBe(0)
    expect(result.current.waitingForResponseRef.current).toBe(false)
  })

  it('streamStop clears streamTimer', () => {
    const { result } = renderHook(() => useSendMessageState(makeParams()))

    result.current.streamTimer.current = 12345
    act(() => {
      result.current.streamStop()
    })
    expect(result.current.streamTimer.current).toBeNull()
  })

  it('streamFinish clears state flags and calls setWaitingForResponse + setPendingGeneration', () => {
    const setSessionWaiting = vi.fn()
    const clearSessionWaiting = vi.fn()
    vi.spyOn(useChatStore, 'getState').mockReturnValue({
      setSessionWaiting,
      clearSessionWaiting,
    } as unknown as ReturnType<typeof useChatStore.getState>)

    const { result } = renderHook(() =>
      useSendMessageState(makeParams({ waitingForResponse: true })),
    )

    result.current.sessionKeyForWaiting.current = 'sess-1'
    result.current.streamTimer.current = 999
    result.current.failsafeTimerRef.current = 888

    act(() => {
      result.current.setSending(true)
    })
    expect(result.current.sending).toBe(true)

    act(() => {
      result.current.streamFinish()
    })

    expect(result.current.streamTimer.current).toBeNull()
    expect(result.current.failsafeTimerRef.current).toBeNull()
    expect(result.current.sending).toBe(false)
    expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')

    vi.restoreAllMocks()
  })

  it('streamStart sets a 2s fallback timer when activeFriendlyId is set and not new chat', () => {
    const refreshFn = vi.fn()
    const { result } = renderHook(() => useSendMessageState(makeParams()))

    result.current.refreshHistoryRef.current = refreshFn

    act(() => {
      result.current.streamStart()
    })

    expect(result.current.streamTimer.current).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(refreshFn).toHaveBeenCalledTimes(1)
  })

  it('streamStart skips when activeFriendlyId is missing', () => {
    const { result } = renderHook(() =>
      useSendMessageState(makeParams({ activeFriendlyId: undefined })),
    )

    act(() => {
      result.current.streamStart()
    })

    expect(result.current.streamTimer.current).toBeNull()
  })

  it('streamStart skips when isNewChat is true', () => {
    const { result } = renderHook(() =>
      useSendMessageState(makeParams({ isNewChat: true })),
    )

    act(() => {
      result.current.streamStart()
    })

    expect(result.current.streamTimer.current).toBeNull()
  })

  it('syncLastCompletedRunAt triggers 10s failsafe → streamFinish', () => {
    const clearSessionWaiting = vi.fn()
    vi.spyOn(useChatStore, 'getState').mockReturnValue({
      setSessionWaiting: vi.fn(),
      clearSessionWaiting,
    } as unknown as ReturnType<typeof useChatStore.getState>)

    const { result } = renderHook(() =>
      useSendMessageState(makeParams({ waitingForResponse: true })),
    )

    act(() => {
      result.current.sessionKeyForWaiting.current = 'sess-1'
      result.current.syncLastCompletedRunAt(12345)
    })

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')
    vi.restoreAllMocks()
  })

  // --- sendMessage tests (PR 2) ---

  describe('sendMessage', () => {
    it('creates optimistic message and appends to query cache', () => {
      const setSessionWaiting = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting,
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const queryClient = { __mock: true }
      const { result } = renderHook(() =>
        useSendMessageState(makeParams({ queryClient })),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage('sess-key-1', 'sess-1', 'hello world')
      })

      expect(createOptimisticMessage).toHaveBeenCalledWith('hello world', [])
      expect(appendHistoryMessage).toHaveBeenCalledWith(
        queryClient,
        'sess-1',
        'sess-key-1',
        expect.objectContaining({ clientId: 'client-test-1' }),
      )
      expect(updateSessionLastMessage).toHaveBeenCalledWith(
        queryClient,
        'sess-key-1',
        'sess-1',
        expect.objectContaining({ clientId: 'client-test-1' }),
      )

      vi.restoreAllMocks()
    })

    it('sets state flags (sending=true) and writes activeSendRef', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage('sess-key-1', 'sess-1', 'hello')
      })

      expect(result.current.sending).toBe(true)
      expect(result.current.activeSendRef.current).toEqual({
        sessionKey: 'sess-key-1',
        friendlyId: 'sess-1',
        clientId: 'client-test-1',
      })

      vi.restoreAllMocks()
    })

    it('arms the 600s failsafe timer', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage('sess-key-1', 'sess-1', 'hello')
      })

      expect(result.current.failsafeTimerRef.current).not.toBeNull()

      vi.restoreAllMocks()
    })

    it('calls startStreaming with enriched body and correct params', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const startStreamingMock = vi.fn(
        async (_params: Record<string, unknown>) => {},
      )
      const messages: Array<ChatMessage> = [
        { role: 'user', content: [{ type: 'text', text: 'previous msg' }] },
      ]
      const { result } = renderHook(() =>
        useSendMessageState(
          makeParams({
            thinkingLevelRef: makeStringRef('high'),
            startStreamingRef: { current: startStreamingMock },
            finalDisplayMessagesRef: makeMessagesRef(messages),
            currentModelRef: makeModelRef('claude-4.6'),
          }),
        ),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage(
          'sess-key-1',
          'sess-1',
          'new message',
          [],
          true, // fastMode
        )
      })

      expect(startStreamingMock).toHaveBeenCalledTimes(1)
      const callArgs = startStreamingMock.mock.calls[0][0]
      expect(callArgs.sessionKey).toBe('sess-key-1')
      expect(callArgs.friendlyId).toBe('sess-1')
      expect(callArgs.message).toBe('new message')
      expect(callArgs.fastMode).toBe(true)
      expect(callArgs.thinking).toBe('high')
      expect(callArgs.model).toBe('claude-4.6')
      expect(callArgs.history).toEqual([
        { role: 'user', content: 'previous msg' },
      ])
      expect(callArgs.attachments).toBeUndefined()

      vi.restoreAllMocks()
    })

    it('skipOptimistic=true skips optimistic message creation', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage(
          'sess-key-1',
          'sess-1',
          'hello',
          [],
          false,
          true, // skipOptimistic
        )
      })

      expect(createOptimisticMessage).not.toHaveBeenCalled()
      expect(appendHistoryMessage).not.toHaveBeenCalled()
      expect(updateSessionLastMessage).not.toHaveBeenCalled()

      vi.restoreAllMocks()
    })

    it('passes attachment payload when attachments are provided', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const startStreamingMock = vi.fn(
        async (_params: Record<string, unknown>) => {},
      )
      const attachments: Array<ChatAttachment> = [
        {
          id: 'att-1',
          name: 'test.txt',
          contentType: 'text/plain',
          dataUrl: 'data:text/plain;base64,SGVsbG8=',
          size: 5,
        },
      ]
      const { result } = renderHook(() =>
        useSendMessageState(
          makeParams({
            startStreamingRef: { current: startStreamingMock },
          }),
        ),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage(
          'sess-key-1',
          'sess-1',
          'see attached',
          attachments,
        )
      })

      const callArgs = startStreamingMock.mock.calls[0][0]
      expect(callArgs.attachments).toBeDefined()
      const payload = callArgs.attachments as Array<Record<string, unknown>>
      expect(payload).toHaveLength(1)
      expect(payload[0].contentType).toBe('text/plain')
      expect(payload[0].type).toBe('file')

      vi.restoreAllMocks()
    })

    it('injects text attachment content into the message body', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const startStreamingMock = vi.fn(
        async (_params: Record<string, unknown>) => {},
      )
      const attachments: Array<ChatAttachment> = [
        {
          id: 'att-1',
          name: 'notes.txt',
          contentType: 'text/plain',
          dataUrl: 'raw text content here',
          size: 22,
        },
      ]
      const { result } = renderHook(() =>
        useSendMessageState(
          makeParams({
            startStreamingRef: { current: startStreamingMock },
          }),
        ),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.sendMessage(
          'sess-key-1',
          'sess-1',
          'body text',
          attachments,
        )
      })

      const callArgs = startStreamingMock.mock.calls[0][0]
      expect(callArgs.message).toContain('body text')
      expect(callArgs.message).toContain('<attachment name="notes.txt">')
      expect(callArgs.message).toContain('raw text content here')

      vi.restoreAllMocks()
    })
  })

  // --- SSE callback tests (PR 3 — Group D) ---

  describe('onComplete', () => {
    it('clears activeSendRef and does not refetch the session list', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const queryClient = { __mock: true }
      const { result } = renderHook(() =>
        useSendMessageState(makeParams({ queryClient })),
      )

      result.current.activeSendRef.current = {
        sessionKey: 'sk-1',
        friendlyId: 'sess-1',
        clientId: 'client-abc',
      }

      act(() => {
        result.current.onComplete()
      })

      expect(result.current.activeSendRef.current).toBeNull()
      expect(updateHistoryMessageByClientIdEverywhere).toHaveBeenCalledWith(
        queryClient,
        'client-abc',
        expect.any(Function),
      )
      expect(result.current.sending).toBe(false)
      expect(invalidateSessionLists).not.toHaveBeenCalled()

      vi.restoreAllMocks()
    })

    it('plays sound when soundOnChatComplete is enabled', () => {
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)
      vi.mocked(useChatSettingsStore.getState).mockReturnValue({
        settings: { soundOnChatComplete: true },
      } as ReturnType<typeof useChatSettingsStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      act(() => {
        result.current.onComplete()
      })

      expect(playChatComplete).toHaveBeenCalledTimes(1)

      vi.restoreAllMocks()
    })
  })

  describe('onError', () => {
    it('general error: sets error, calls toast and showErrorToast, clears state', () => {
      const setError = vi.fn()
      const clearSessionWaiting = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting,
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() =>
        useSendMessageState(makeParams({ setError })),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'
      result.current.activeSendRef.current = {
        sessionKey: 'sk-1',
        friendlyId: 'sess-1',
        clientId: 'client-err',
      }

      act(() => {
        result.current.onError('something went wrong')
      })

      expect(setError).toHaveBeenCalledWith(
        'Failed to send message. something went wrong',
      )
      expect(toast).toHaveBeenCalledWith('Failed to send message', {
        type: 'error',
      })
      expect(showErrorToast).toHaveBeenCalledWith('something went wrong')
      expect(result.current.activeSendRef.current).toBeNull()
      expect(result.current.sending).toBe(false)
      expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')

      vi.restoreAllMocks()
    })

    it('auth-missing error: navigates to / and clears state without toast', () => {
      const navigate = vi.fn()
      const clearSessionWaiting = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting,
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() =>
        useSendMessageState(makeParams({ navigate, embedded: false })),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.onError(missingAuthMessage)
      })

      expect(isMissingAuth(missingAuthMessage)).toBe(true)
      expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
      expect(toast).not.toHaveBeenCalled()
      expect(showErrorToast).not.toHaveBeenCalled()
      expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')

      vi.restoreAllMocks()
    })

    it('auth-missing error: does not navigate when embedded', () => {
      const navigate = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() =>
        useSendMessageState(makeParams({ navigate, embedded: true })),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'

      act(() => {
        result.current.onError(missingAuthMessage)
      })

      expect(navigate).not.toHaveBeenCalled()

      vi.restoreAllMocks()
    })
  })

  describe('onAbort', () => {
    it('clears activeSendRef and all state flags', () => {
      const clearSessionWaiting = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting,
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      result.current.sessionKeyForWaiting.current = 'sess-1'
      result.current.activeSendRef.current = {
        sessionKey: 'sk-1',
        friendlyId: 'sess-1',
        clientId: 'client-abort',
      }

      act(() => {
        result.current.setSending(true)
      })

      act(() => {
        result.current.onAbort()
      })

      expect(result.current.activeSendRef.current).toBeNull()
      expect(result.current.sending).toBe(false)
      expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')

      vi.restoreAllMocks()
    })
  })

  // --- Abort helper tests (PR 3 — Group E) ---

  describe('handleAbortStreaming', () => {
    it('calls cancelStreaming via ref and clears state', () => {
      const cancelStreamingFn = vi.fn()
      const clearSessionWaiting = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting,
        clearStreamingSession: vi.fn(),
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const queryClient = { __mock: true }
      const { result } = renderHook(() =>
        useSendMessageState(
          makeParams({
            queryClient,
            cancelStreamingRef: { current: cancelStreamingFn },
          }),
        ),
      )

      result.current.sessionKeyForWaiting.current = 'sess-1'
      result.current.activeSendRef.current = {
        sessionKey: 'sk-1',
        friendlyId: 'sess-1',
        clientId: 'client-abort-stream',
      }

      act(() => {
        result.current.setSending(true)
      })

      act(() => {
        result.current.handleAbortStreaming()
      })

      expect(cancelStreamingFn).toHaveBeenCalledTimes(1)
      expect(updateHistoryMessageByClientIdEverywhere).toHaveBeenCalledWith(
        queryClient,
        'client-abort-stream',
        expect.any(Function),
      )
      expect(result.current.activeSendRef.current).toBeNull()
      expect(result.current.sending).toBe(false)
      expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')

      vi.restoreAllMocks()
    })
  })

  describe('reconcileStuckBusyState', () => {
    it('clears streaming session in store and calls streamFinish', () => {
      const clearStreamingSession = vi.fn()
      const clearSessionWaiting = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting,
        clearStreamingSession,
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      result.current.sessionKeyForWaiting.current = 'sess-1'
      result.current.activeSendRef.current = {
        sessionKey: 'sk-stuck',
        friendlyId: 'sess-1',
        clientId: 'client-stuck',
      }

      act(() => {
        result.current.setSending(true)
      })

      act(() => {
        result.current.reconcileStuckBusyState('sk-stuck')
      })

      expect(clearStreamingSession).toHaveBeenCalledWith('sk-stuck')
      expect(result.current.activeSendRef.current).toBeNull()
      expect(result.current.sending).toBe(false)
      expect(clearSessionWaiting).toHaveBeenCalledWith('sess-1')

      vi.restoreAllMocks()
    })

    it('skips clearStreamingSession when sessionKey is empty', () => {
      const clearStreamingSession = vi.fn()
      vi.spyOn(useChatStore, 'getState').mockReturnValue({
        setSessionWaiting: vi.fn(),
        clearSessionWaiting: vi.fn(),
        clearStreamingSession,
      } as unknown as ReturnType<typeof useChatStore.getState>)

      const { result } = renderHook(() => useSendMessageState(makeParams()))

      act(() => {
        result.current.reconcileStuckBusyState('')
      })

      expect(clearStreamingSession).not.toHaveBeenCalled()

      vi.restoreAllMocks()
    })
  })
})
