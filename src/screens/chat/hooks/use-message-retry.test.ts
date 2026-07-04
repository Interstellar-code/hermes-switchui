// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { RefObject } from 'react'

import { useChatStore } from '../../../stores/chat-store'
import { useMessageRetry } from './use-message-retry'
import type {
  ChatComposerAttachment,
  ChatComposerHelpers,
} from '../components/chat-composer-types'
import type { ChatMessage } from '../types'

const SESSION = 'session-retry'

const commandHelpers: ChatComposerHelpers = {
  reset() {},
  setValue() {},
  setAttachments() {},
}

function makeRef(value = ''): RefObject<string> {
  return { current: value }
}

function makeUserMessage(text: string): ChatMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  } as unknown as ChatMessage
}

function defaultParams(
  overrides: Partial<Parameters<typeof useMessageRetry>[0]> = {},
): Parameters<typeof useMessageRetry>[0] {
  return {
    resolvedSessionKey: SESSION,
    finalDisplayMessages: [],
    isComposerLoading: false,
    activeQueueSessionKey: SESSION,
    lastQueueSessionKeyRef: makeRef(SESSION),
    commandHelpers,
    send: vi.fn().mockResolvedValue(undefined),
    refetchHistory: vi.fn(),
    ...overrides,
  }
}

describe('useMessageRetry', () => {
  beforeEach(() => {
    useChatStore.setState({
      interruptedSessionKeys: new Set(),
      messageQueue: {},
      messageQueueActivity: {},
      runPhase: new Map(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- handleResendInterrupted ---

  it('handleResendInterrupted: finds last user message and calls send', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const messages: Array<ChatMessage> = [
      makeUserMessage('first'),
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } as unknown as ChatMessage,
      makeUserMessage('second'),
    ]

    const { result } = renderHook(() =>
      useMessageRetry(
        defaultParams({
          finalDisplayMessages: messages,
          send,
        }),
      ),
    )

    act(() => {
      result.current.handleResendInterrupted()
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('second', [], false, commandHelpers)
  })

  it('handleResendInterrupted: clears the interrupted flag in the store', () => {
    useChatStore.setState({
      interruptedSessionKeys: new Set([SESSION]),
    })

    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(true)

    const { result } = renderHook(() => useMessageRetry(defaultParams()))

    act(() => {
      result.current.handleResendInterrupted()
    })

    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
  })

  it('handleResendInterrupted: refetches history when no user message is found', () => {
    const refetchHistory = vi.fn()
    const send = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() =>
      useMessageRetry(
        defaultParams({
          finalDisplayMessages: [],
          send,
          refetchHistory,
        }),
      ),
    )

    act(() => {
      result.current.handleResendInterrupted()
    })

    expect(send).not.toHaveBeenCalled()
    expect(refetchHistory).toHaveBeenCalledTimes(1)
  })

  // --- Queue drain ---

  it('queue drain: dequeues and sends when the composer is free', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.getState().enqueue(SESSION, {
      id: 'q1',
      text: 'queued text',
      attachments: [{ id: 'a1', name: 'f.txt', contentType: 'text/plain', size: 1 }],
    })

    renderHook(() =>
      useMessageRetry(
        defaultParams({
          isComposerLoading: false,
          send,
        }),
      ),
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'queued text',
      [{ id: 'a1', name: 'f.txt', contentType: 'text/plain', size: 1 }],
      false,
      commandHelpers,
    )
  })

  it('queue drain: does nothing when the composer is loading', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useChatStore.getState().enqueue(SESSION, {
      id: 'q1',
      text: 'queued text',
      attachments: [],
    })

    renderHook(() =>
      useMessageRetry(
        defaultParams({
          isComposerLoading: true,
          send,
        }),
      ),
    )

    expect(send).not.toHaveBeenCalled()
  })

  // --- isCurrentSessionInterrupted ---

  it('isCurrentSessionInterrupted: reflects the store state', () => {
    const { result, rerender } = renderHook(() => useMessageRetry(defaultParams()))

    expect(result.current.isCurrentSessionInterrupted).toBe(false)

    useChatStore.setState({
      interruptedSessionKeys: new Set([SESSION]),
    })

    rerender()

    expect(result.current.isCurrentSessionInterrupted).toBe(true)
  })
})
