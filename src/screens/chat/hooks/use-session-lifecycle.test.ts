// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'

import { QueryClient } from '@tanstack/react-query'

import type { ChatAttachment, ChatMessage } from '../types'
import type { PendingSendPayload } from '../pending-send'

// --- Mocks ---

const consumePendingSendMock = vi.fn(
  (_sk: string, _fid?: string): PendingSendPayload | null => null,
)
const hasPendingSendMock = vi.fn((): boolean => false)
const hasPendingGenerationMock = vi.fn((): boolean => false)

vi.mock('../pending-send', () => ({
  consumePendingSend: (sk: string, fid?: string) =>
    consumePendingSendMock(sk, fid),
  hasPendingSend: () => hasPendingSendMock(),
  hasPendingGeneration: () => hasPendingGenerationMock(),
}))

const appendHistoryMessageMock = vi.fn()
vi.mock('../chat-queries', () => ({
  appendHistoryMessage: (...args: unknown[]) => appendHistoryMessageMock(...args),
  chatQueryKeys: {
    sessions: ['chat', 'sessions'] as const,
    history: (friendlyId: string, sessionKey: string) =>
      ['chat', 'history', friendlyId, sessionKey] as const,
  },
}))

// Import after mocks are set up
import { useSessionLifecycle } from './use-session-lifecycle'

// --- Helpers ---

function makeRef<T>(initial: T): RefObject<T> {
  return { current: initial }
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    clientId: 'client-1',
    ...overrides,
  } as ChatMessage
}

function makePending(
  overrides: Partial<PendingSendPayload> = {},
): PendingSendPayload {
  return {
    sessionKey: 'session-key-1',
    friendlyId: 'friendly-1',
    message: 'hello world',
    attachments: [],
    optimisticMessage: makeMessage({ clientId: 'client-1' }),
    ...overrides,
  }
}

interface RenderOpts {
  isNewChat?: boolean
  activeFriendlyId?: string
  activeSessionKey?: string
  forcedSessionKey?: string | undefined
  resolvedSessionKey?: string
  isPortableMode?: boolean
  portableChatFriendlyId?: string
  sendMessage?: ReturnType<typeof vi.fn>
  setWaitingForResponse?: ReturnType<typeof vi.fn>
  streamStop?: ReturnType<typeof vi.fn>
  retriedQueuedMessageKeysRef?: RefObject<Set<string>>
}

function renderLifecycle(opts: RenderOpts = {}) {
  const queryClient = new QueryClient()
  const sendMessage = opts.sendMessage ?? vi.fn()
  const setWaitingForResponse = opts.setWaitingForResponse ?? vi.fn()
  const streamStop = opts.streamStop ?? vi.fn()
  const retriedQueuedMessageKeysRef =
    opts.retriedQueuedMessageKeysRef ?? makeRef(new Set<string>())

  const state = {
    isNewChat: opts.isNewChat ?? false,
    activeFriendlyId: opts.activeFriendlyId ?? 'friendly-1',
    activeSessionKey: opts.activeSessionKey ?? 'session-key-1',
    forcedSessionKey: opts.forcedSessionKey,
    resolvedSessionKey: opts.resolvedSessionKey ?? 'session-key-1',
    isPortableMode: opts.isPortableMode ?? false,
    portableChatFriendlyId: opts.portableChatFriendlyId ?? 'friendly-1',
  }

  const utils = renderHook(() =>
    useSessionLifecycle({
      ...state,
      queryClient,
      sendMessage: sendMessage as (
        sessionKey: string,
        friendlyId: string,
        body: string,
        attachments?: Array<ChatAttachment>,
        fastMode?: boolean,
        skipOptimistic?: boolean,
        existingClientId?: string,
      ) => void,
      setWaitingForResponse: setWaitingForResponse as (v: boolean) => void,
      streamStop: streamStop as () => void,
      retriedQueuedMessageKeysRef,
    }),
  )

  const rerender = (next: Partial<RenderOpts> = {}) => {
    Object.assign(state, next)
    act(() => {
      utils.rerender()
    })
  }

  return {
    ...utils,
    rerender,
    sendMessage,
    setWaitingForResponse,
    streamStop,
    retriedQueuedMessageKeysRef,
    state,
  }
}

// --- Tests ---

describe('useSessionLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumePendingSendMock.mockReturnValue(null)
    hasPendingSendMock.mockReturnValue(false)
    hasPendingGenerationMock.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('session-change reset effect', () => {
    it('clears retriedQueuedMessageKeysRef, stops stream, and sets waiting false when no pending', () => {
      const retriedQueuedMessageKeysRef = makeRef(new Set(['key-a', 'key-b']))
      const streamStop = vi.fn()
      const setWaitingForResponse = vi.fn()

      renderLifecycle({
        activeFriendlyId: 'session-1',
        retriedQueuedMessageKeysRef,
        streamStop,
        setWaitingForResponse,
      })

      expect(retriedQueuedMessageKeysRef.current.size).toBe(0)
      expect(streamStop).toHaveBeenCalledTimes(1)
      expect(setWaitingForResponse).toHaveBeenCalledWith(false)
    })

    it('preserves waiting (sets true) and does NOT stop stream when pending send exists', () => {
      hasPendingSendMock.mockReturnValue(true)

      const retriedQueuedMessageKeysRef = makeRef(new Set(['key-a']))
      const streamStop = vi.fn()
      const setWaitingForResponse = vi.fn()

      renderLifecycle({
        activeFriendlyId: 'session-1',
        retriedQueuedMessageKeysRef,
        streamStop,
        setWaitingForResponse,
      })

      // retriedQueuedMessageKeysRef is always cleared
      expect(retriedQueuedMessageKeysRef.current.size).toBe(0)
      // but streamStop is NOT called — early return
      expect(streamStop).not.toHaveBeenCalled()
      // waiting is set to true
      expect(setWaitingForResponse).toHaveBeenCalledWith(true)
      expect(setWaitingForResponse).not.toHaveBeenCalledWith(false)
    })

    it('preserves waiting when pending generation exists', () => {
      hasPendingGenerationMock.mockReturnValue(true)

      const streamStop = vi.fn()
      const setWaitingForResponse = vi.fn()

      renderLifecycle({
        activeFriendlyId: 'session-1',
        streamStop,
        setWaitingForResponse,
      })

      expect(streamStop).not.toHaveBeenCalled()
      expect(setWaitingForResponse).toHaveBeenCalledWith(true)
    })
  })

  describe('consume pending send layout effect', () => {
    it('sends pending message after navigation when consumePendingSend returns payload', () => {
      const pending = makePending()
      consumePendingSendMock.mockReturnValue(pending)

      const sendMessage = vi.fn()
      const setWaitingForResponse = vi.fn()

      renderLifecycle({
        isNewChat: false,
        activeFriendlyId: 'friendly-1',
        activeSessionKey: 'session-key-1',
        resolvedSessionKey: 'session-key-1',
        sendMessage,
        setWaitingForResponse,
      })

      // consumePendingSend should have been called
      expect(consumePendingSendMock).toHaveBeenCalledWith(
        'session-key-1',
        'friendly-1',
      )

      // sendMessage should have been called with the pending payload fields
      expect(sendMessage).toHaveBeenCalledTimes(1)
      expect(sendMessage).toHaveBeenCalledWith(
        pending.sessionKey,
        pending.friendlyId,
        pending.message,
        pending.attachments,
        false,
        true,
        pending.optimisticMessage.clientId,
      )

      // setWaitingForResponse(true) should have been called
      expect(setWaitingForResponse).toHaveBeenCalledWith(true)

      // appendHistoryMessage should have been called (cache was empty)
      expect(appendHistoryMessageMock).toHaveBeenCalledTimes(1)
    })

    it('skips consuming pending send when isNewChat is true', () => {
      const pending = makePending()
      consumePendingSendMock.mockReturnValue(pending)

      const sendMessage = vi.fn()

      renderLifecycle({
        isNewChat: true,
        activeFriendlyId: undefined,
        sendMessage,
      })

      // consumePendingSend should NOT have been called at all
      expect(consumePendingSendMock).not.toHaveBeenCalled()
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('does nothing when consumePendingSend returns null', () => {
      consumePendingSendMock.mockReturnValue(null)

      const sendMessage = vi.fn()
      const setWaitingForResponse = vi.fn()

      renderLifecycle({
        isNewChat: false,
        sendMessage,
        setWaitingForResponse,
      })

      expect(sendMessage).not.toHaveBeenCalled()
      // setWaitingForResponse(true) from the layout effect should NOT fire
      // (the reset effect may call setWaitingForResponse(false) though)
      expect(setWaitingForResponse).not.toHaveBeenCalledWith(true)
    })

    it('uses "main" as session key when isPortableMode is true', () => {
      consumePendingSendMock.mockReturnValue(makePending())

      renderLifecycle({
        isNewChat: false,
        isPortableMode: true,
        portableChatFriendlyId: 'main',
        activeSessionKey: 'session-key-1',
        forcedSessionKey: 'forced-key',
        resolvedSessionKey: 'resolved-key',
      })

      expect(consumePendingSendMock).toHaveBeenCalledWith('main', 'main')
    })
  })

  describe('reset effect interaction with pending start', () => {
    it('pendingStartRef prevents full reset on the render where pending send was consumed', () => {
      // When consumePendingSend returns a payload, the layout effect sets
      // pendingStartRef.current = true. On the next render (triggered by
      // setWaitingForResponse(true)), the reset effect fires again but
      // sees pendingStartRef and returns early without stopping the stream.
      const pending = makePending()
      consumePendingSendMock.mockReturnValue(pending)

      const streamStop = vi.fn()
      const setWaitingForResponse = vi.fn()

      const { rerender } = renderLifecycle({
        isNewChat: false,
        activeFriendlyId: 'friendly-1',
        streamStop,
        setWaitingForResponse,
      })

      // After initial render: layout effect consumed pending → pendingStartRef = true
      // Reset effect also ran on mount. On mount, effects run in order:
      // useLayoutEffect runs before useEffect. So:
      // 1. useLayoutEffect: consumePendingSend → pendingStartRef.current = true
      // 2. useEffect (reset): sees pendingStartRef.current === true → sets it false, returns
      //    → streamStop NOT called
      expect(streamStop).not.toHaveBeenCalled()

      // Rerender with same values — pendingStartRef is now false (cleared by reset effect)
      // consumePendingSend returns null now (it was consumed)
      consumePendingSendMock.mockReturnValue(null)

      act(() => {
        rerender({
          isNewChat: false,
          activeFriendlyId: 'friendly-1',
          streamStop,
          setWaitingForResponse,
        })
      })

      // streamStop should still not have been called because
      // the deps didn't change for the reset effect (activeFriendlyId same)
      expect(streamStop).not.toHaveBeenCalled()
    })
  })
})
