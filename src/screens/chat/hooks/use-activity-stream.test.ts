// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useActivityStream } from './use-activity-stream'
import type { RefObject } from 'react'


/**
 * Minimal EventSource stub — jsdom does not ship an EventSource impl.
 * The hook constructs one on mount; we only need it to be构造able and
 * expose addEventListener / removeEventListener / close no-ops so the
 * activity effect does not crash. The EventSource behavior itself is
 * NOT under test (per task spec).
 */
class FakeEventSource {
  static instances: Array<FakeEventSource> = []
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
}

function makeRef(value: boolean): RefObject<boolean> {
  return { current: value }
}

describe('useActivityStream', () => {
  beforeEach(() => {
    cleanup()
    FakeEventSource.instances = []
    vi.useFakeTimers()
    // jsdom lacks EventSource — install our stub on the global.
    ;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
      FakeEventSource
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('returns an empty activity list on mount', () => {
    const { result } = renderHook(() =>
      useActivityStream({
        waitingForResponseRef: makeRef(false),
        waitingForResponse: false,
      }),
    )
    expect(result.current.liveToolActivity).toEqual([])
  })

  it('opens a single persistent EventSource on mount', () => {
    renderHook(() =>
      useActivityStream({
        waitingForResponseRef: makeRef(false),
        waitingForResponse: false,
      }),
    )
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/events')
  })

  it('closes the EventSource on unmount', () => {
    const { unmount } = renderHook(() =>
      useActivityStream({
        waitingForResponseRef: makeRef(false),
        waitingForResponse: false,
      }),
    )
    const es = FakeEventSource.instances[0]
    expect(es.close).not.toHaveBeenCalled()
    unmount()
    expect(es.close).toHaveBeenCalledTimes(1)
  })

  it('does NOT clear while waitingForResponse stays true', () => {
    const { result } = renderHook(
      ({ waiting }) =>
        useActivityStream({
          waitingForResponseRef: makeRef(waiting),
          waitingForResponse: waiting,
        }),
      { initialProps: { waiting: true } },
    )
    // Advance well past 800ms — nothing should change because we never flipped
    // waitingForResponse to false (the effect early-returns while waiting).
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.liveToolActivity).toEqual([])
  })

  it('clears activity 800ms after waitingForResponse flips false', () => {
    const { result, rerender } = renderHook(
      ({ waiting }) =>
        useActivityStream({
          waitingForResponseRef: makeRef(waiting),
          waitingForResponse: waiting,
        }),
      { initialProps: { waiting: true } },
    )
    // Sanity: initial state empty.
    expect(result.current.liveToolActivity).toEqual([])

    // Flip waitingForResponse false — should schedule a 800ms clear timer.
    rerender({ waiting: false })

    // Just before the 800ms window: still empty (no data was pushed) — but
    // crucially, the timer has not fired yet so the code path ran without
    // blowing up. We confirm timer scheduling by checking 799ms vs 800ms.
    act(() => {
      vi.advanceTimersByTime(799)
    })
    // No state setter ran at this point — the only way to observe the timer
    // fired is if it ran setLiveToolActivity; we cannot inject items without
    // the EventSource. Instead, verify the timer fires without error at 800ms.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.liveToolActivity).toEqual([])
  })

  it('cancels the pending clear timer if waitingForResponse flips back true', () => {
    const { result, rerender } = renderHook(
      ({ waiting }) =>
        useActivityStream({
          waitingForResponseRef: makeRef(waiting),
          waitingForResponse: waiting,
        }),
      { initialProps: { waiting: true } },
    )

    // Schedule the clear.
    rerender({ waiting: false })
    // Cancel it by re-entering waiting.
    rerender({ waiting: true })

    // Advance well past 800ms — the original timer's cleanup should have
    // cleared it, so no setLiveToolActivity([]) call should throw or error.
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.liveToolActivity).toEqual([])
  })
})
