// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'

import { useChatStore } from '../../../stores/chat-store'
import { useSendMessageState } from './use-send-message-state'

function makeBooleanRef(initial = false): RefObject<boolean> {
  return { current: initial }
}

describe('useSendMessageState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initialises with correct defaults', () => {
    const { result } = renderHook(() =>
      useSendMessageState({
        activeFriendlyId: 'sess-1',
        isNewChat: false,
        waitingForResponse: false,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
    )

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
    const { result } = renderHook(() =>
      useSendMessageState({
        activeFriendlyId: 'sess-1',
        isNewChat: false,
        waitingForResponse: false,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
    )

    result.current.streamTimer.current = 12345 as unknown as number
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
      useSendMessageState({
        activeFriendlyId: 'sess-1',
        isNewChat: false,
        waitingForResponse: true,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
    )

    // Simulate an active session key so setWaitingForResponse does something
    result.current.sessionKeyForWaiting.current = 'sess-1'
    result.current.streamTimer.current = 999 as unknown as number
    result.current.failsafeTimerRef.current = 888 as unknown as number

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
    const { result } = renderHook(() =>
      useSendMessageState({
        activeFriendlyId: 'sess-1',
        isNewChat: false,
        waitingForResponse: false,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
    )

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
      useSendMessageState({
        activeFriendlyId: undefined,
        isNewChat: false,
        waitingForResponse: false,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
    )

    act(() => {
      result.current.streamStart()
    })

    expect(result.current.streamTimer.current).toBeNull()
  })

  it('streamStart skips when isNewChat is true', () => {
    const { result } = renderHook(() =>
      useSendMessageState({
        activeFriendlyId: 'sess-1',
        isNewChat: true,
        waitingForResponse: false,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
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
      useSendMessageState({
        activeFriendlyId: 'sess-1',
        isNewChat: false,
        waitingForResponse: true,
        activeRealtimeStreamingRef: makeBooleanRef(),
      }),
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
})
