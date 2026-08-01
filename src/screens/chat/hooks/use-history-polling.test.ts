// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHistoryPolling } from './use-history-polling'
import type { RefObject } from 'react'

function ref<T>(initial: T): RefObject<T> {
  return { current: initial }
}

/** Force jsdom's `document.visibilityState` to a given value. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  })
}

function dispatchVisibility() {
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useHistoryPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── chat-refresh listener ────────────────────────────────────────────

  it('chat-refresh listener: calls refetch on "claude:chat-refresh" event', async () => {
    const refetch = vi.fn()
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: ref(false),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    window.dispatchEvent(new Event('claude:chat-refresh'))
    expect(refetch).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('claude:chat-refresh'))
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('chat-refresh listener: removed on unmount', async () => {
    const refetch = vi.fn()
    const { unmount } = renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: ref(false),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    unmount()

    window.dispatchEvent(new Event('claude:chat-refresh'))
    expect(refetch).not.toHaveBeenCalled()
  })

  // ── visibility poll ──────────────────────────────────────────────────

  it('visibility poll: does not loop when not waiting for a response', async () => {
    const refetch = vi.fn()
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: ref(false),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Idle mounts rely on useChatHistory's mount refetch; this hook schedules
    // no delayed duplicate request.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(refetch).not.toHaveBeenCalled()

    // Tab becomes visible but we are not waiting — only the immediate refetch.
    setVisibility('visible')
    dispatchVisibility()
    expect(refetch).toHaveBeenCalledTimes(1)

    // Advance well past the 3 s poll interval — no extra calls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('visibility poll: starts bounded loop when tab becomes visible + waitingForResponse is true', async () => {
    const refetch = vi.fn()
    const waitingRef = ref(false)
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: waitingRef,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Flip waiting ON, then make tab visible.
    waitingRef.current = true
    setVisibility('visible')
    dispatchVisibility()
    expect(refetch).toHaveBeenCalledTimes(1) // immediate refetch on return

    // First poll at +3 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(refetch).toHaveBeenCalledTimes(2)

    // Second poll at +6 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it('visibility poll: loop stops once waitingForResponse clears', async () => {
    const refetch = vi.fn()
    const waitingRef = ref(false)
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: waitingRef,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Start the visibility loop.
    waitingRef.current = true
    setVisibility('visible')
    dispatchVisibility()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    // 1 (visibility immediate) + 1 (first poll) = 2.
    expect(refetch).toHaveBeenCalledTimes(2)

    // Response arrives — loop should stop after the pending poll's scheduleNext.
    waitingRef.current = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    // The pending poll timer fires its refetch before scheduleNext notices.
    expect(refetch).toHaveBeenCalledTimes(3)

    // No further polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000)
    })
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  // ── remount catch-up ─────────────────────────────────────────────────

  it('remount recovery: skips the delayed refetch when not waiting', async () => {
    const refetch = vi.fn()
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: ref(false),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // No duplicate full-history request after mounting an idle chat.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(refetch).not.toHaveBeenCalled()
  })

  it('remount catch-up: starts bounded loop if waiting on mount', async () => {
    const refetch = vi.fn()
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: ref(true),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // 2 s delayed refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(refetch).toHaveBeenCalledTimes(1)

    // First poll-loop refetch at 3 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(refetch).toHaveBeenCalledTimes(2)

    // Second poll at 6 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  // ── overlap guard ────────────────────────────────────────────────────

  it('overlap guard: visibility event does not start a second loop while remount loop is active', async () => {
    const refetch = vi.fn()
    const waitingRef = ref(true)
    renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: waitingRef,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Remount loop is active (first poll at 3 s). Drain the 2 s delayed refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(refetch).toHaveBeenCalledTimes(1)

    // Visibility event: immediate refetch, but NO second loop (guard held).
    setVisibility('visible')
    dispatchVisibility()
    expect(refetch).toHaveBeenCalledTimes(2)

    // At t = 3 s: exactly one poll from the remount loop. If the visibility
    // handler had also started a loop we'd see an extra poll here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(refetch).toHaveBeenCalledTimes(3)

    // At t = 6 s: still only one loop polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(refetch).toHaveBeenCalledTimes(4)
  })

  // ── cleanup ──────────────────────────────────────────────────────────

  it('cleanup: unmount cancels any in-flight visibility loop', async () => {
    const refetch = vi.fn()
    const waitingRef = ref(false)
    const { unmount } = renderHook(() =>
      useHistoryPolling({
        refetchHistory: refetch,
        waitingForResponseRef: waitingRef,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    waitingRef.current = true
    setVisibility('visible')
    dispatchVisibility()
    expect(refetch).toHaveBeenCalledTimes(1) // visibility immediate

    // Unmount — cleanup sets returnPollActiveRef = false. The already-scheduled
    // poll timer still fires its refetch before scheduleNext notices the guard
    // flipped (this matches the original behaviour), but the loop does NOT
    // continue for the full 60 s.
    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    // 1 (so far) + 1 orphaned poll = 2. Critically, NOT 3+ — the loop stopped.
    expect(refetch).toHaveBeenCalledTimes(2)
  })
})
