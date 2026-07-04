// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import type { RefObject } from 'react'

import { useRetryRecovery } from './use-retry-recovery'
import type { ChatMessage } from '../types'

function makeSetRef(): RefObject<Set<string>> {
  return { current: new Set<string>() }
}

function makeUserErrorMessage(
  text: string,
  clientId?: string,
): ChatMessage {
  const base: Record<string, unknown> = {
    role: 'user',
    status: 'error',
    content: [{ type: 'text', text }],
  }
  if (clientId) base.clientId = clientId
  return base as unknown as ChatMessage
}

function makeAssistantMessage(text: string): ChatMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
  } as unknown as ChatMessage
}

function makeStatusQuery(ok: boolean | undefined) {
  return { data: ok === undefined ? undefined : { ok } } as never
}

function defaultParams(
  overrides: Partial<Parameters<typeof useRetryRecovery>[0]> = {},
): Parameters<typeof useRetryRecovery>[0] {
  return {
    sendMessage: vi.fn(),
    queryClient: new QueryClient(),
    activeSessionKey: 'session-active',
    forcedSessionKey: undefined,
    resolvedSessionKey: 'session-resolved',
    isPortableMode: false,
    portableChatFriendlyId: 'main',
    sessionKeyForHistory: 'session-history',
    finalDisplayMessages: [],
    retriedQueuedMessageKeysRef: makeSetRef(),
    statusQuery: makeStatusQuery(true),
    handleRefetch: vi.fn(),
    ...overrides,
  }
}

describe('useRetryRecovery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- retryQueuedMessage ---

  it('retryQueuedMessage: resolves session key and calls sendMessage', () => {
    const sendMessage = vi.fn()
    const { result } = renderHook(() =>
      useRetryRecovery(
        defaultParams({
          sendMessage,
          forcedSessionKey: 'forced-key',
          finalDisplayMessages: [makeUserErrorMessage('hello', 'client-1')],
        }),
      ),
    )

    const message = makeUserErrorMessage('hello', 'client-1')
    let ok: boolean | undefined
    act(() => {
      ok = result.current.retryQueuedMessage(message, 'manual')
    })

    expect(ok).toBe(true)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    // forcedSessionKey takes precedence over resolvedSessionKey/activeSessionKey
    expect(sendMessage).toHaveBeenCalledWith(
      'forced-key',
      'main',
      'hello',
      [],
      false,
      true,
      'client-1',
    )
  })

  it('retryQueuedMessage: dedup guard skips already-retried messages in auto mode', () => {
    const sendMessage = vi.fn()
    const retriedQueuedMessageKeysRef = makeSetRef()
    // Pre-seed the dedup set with this message's key
    const message = makeUserErrorMessage('dup', 'client-dup')
    // The key format is `client:<clientId>` — seed it directly
    retriedQueuedMessageKeysRef.current.add('client:client-dup')

    const { result } = renderHook(() =>
      useRetryRecovery(
        defaultParams({
          sendMessage,
          retriedQueuedMessageKeysRef,
        }),
      ),
    )

    let ok: boolean | undefined
    act(() => {
      ok = result.current.retryQueuedMessage(message, 'auto')
    })

    expect(ok).toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  // --- flushRetryableMessages ---

  it('flushRetryableMessages: finds error messages and retries each', () => {
    const sendMessage = vi.fn()
    const messages: Array<ChatMessage> = [
      makeUserErrorMessage('first', 'c1'),
      makeAssistantMessage('reply'),
      makeUserErrorMessage('second', 'c2'),
      // Non-error user message — should be skipped
      { role: 'user', content: [{ type: 'text', text: 'fine' }] } as unknown as ChatMessage,
    ]

    const { result } = renderHook(() =>
      useRetryRecovery(
        defaultParams({
          sendMessage,
          finalDisplayMessages: messages,
        }),
      ),
    )

    act(() => {
      result.current.flushRetryableMessages()
    })

    // Two error-status user messages → two sendMessage calls
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  // --- handleRetryMessage ---

  it('handleRetryMessage: clears dedup key and retries with manual mode', () => {
    const sendMessage = vi.fn()
    const retriedQueuedMessageKeysRef = makeSetRef()
    const message = makeUserErrorMessage('retry-me', 'client-manual')
    // Seed dedup so we can assert handleRetryMessage removes it before retrying
    retriedQueuedMessageKeysRef.current.add('client:client-manual')

    const { result } = renderHook(() =>
      useRetryRecovery(
        defaultParams({
          sendMessage,
          retriedQueuedMessageKeysRef,
        }),
      ),
    )

    act(() => {
      result.current.handleRetryMessage(message)
    })

    // Manual retry ignores dedup, so sendMessage fires despite the seeded key
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      'session-resolved',
      'main',
      'retry-me',
      [],
      false,
      true,
      'client-manual',
    )
    // The dedup key was deleted before retrying
    expect(retriedQueuedMessageKeysRef.current.has('client:client-manual')).toBe(false)
  })

  // --- health-restored effect ---

  it('health-restored effect: flushes retryable messages on claude:health-restored event', () => {
    const sendMessage = vi.fn()
    const messages: Array<ChatMessage> = [
      makeUserErrorMessage('flushed', 'c-flush'),
    ]

    renderHook(() =>
      useRetryRecovery(
        defaultParams({
          sendMessage,
          finalDisplayMessages: messages,
        }),
      ),
    )

    act(() => {
      window.dispatchEvent(new Event('claude:health-restored'))
    })

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
