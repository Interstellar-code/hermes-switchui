// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import {
  HISTORY_POLL_INTERVAL_MS,
  resolveHistoryRefetchInterval,
  useActivityStream,
  useLiveStreamConnected,
} from './use-activity-stream'
import type { RefObject } from 'react'

/** EventSource stub that captures listeners so tests can emit open/error. */
class FakeEventSource {
  static instances: Array<FakeEventSource> = []
  private listeners = new Map<string, Set<() => void>>()

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener = (type: string, listener: () => void) => {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener = (type: string, listener: () => void) => {
    this.listeners.get(type)?.delete(listener)
  }

  close = vi.fn()

  emit(type: string) {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) {
      listener()
    }
  }
}

function makeRef(value: boolean): RefObject<boolean> {
  return { current: value }
}

function renderActivity() {
  return renderHook(() =>
    useActivityStream({
      waitingForResponseRef: makeRef(false),
      waitingForResponse: false,
    }),
  )
}

describe('F4: history polling follows the live SSE stream', () => {
  beforeEach(() => {
    cleanup()
    FakeEventSource.instances = []
    vi.useFakeTimers()
    ;(
      globalThis as unknown as { EventSource: typeof FakeEventSource }
    ).EventSource = FakeEventSource
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('polls every 5 s only while disconnected, never while connected', () => {
    expect(resolveHistoryRefetchInterval(false)).toBe(5000)
    expect(resolveHistoryRefetchInterval(true)).toBe(false)
    expect(HISTORY_POLL_INTERVAL_MS).toBe(5000)
  })

  it('reports disconnected before the stream opens', () => {
    const { result } = renderHook(() => useLiveStreamConnected())
    expect(result.current).toBe(false)
  })

  it('reports connected once the shared /api/events stream opens', () => {
    const activity = renderActivity()
    const status = renderHook(() => useLiveStreamConnected())
    expect(status.result.current).toBe(false)

    act(() => {
      FakeEventSource.instances[0].emit('open')
    })

    expect(status.result.current).toBe(true)
    activity.unmount()
    status.unmount()
  })

  it('falls back to disconnected on stream error so polling resumes', () => {
    const activity = renderActivity()
    const status = renderHook(() => useLiveStreamConnected())

    act(() => {
      FakeEventSource.instances[0].emit('open')
    })
    expect(status.result.current).toBe(true)

    act(() => {
      FakeEventSource.instances[0].emit('error')
    })
    expect(status.result.current).toBe(false)

    activity.unmount()
    status.unmount()
  })

  it('reports disconnected after unmount', () => {
    const activity = renderActivity()
    const status = renderHook(() => useLiveStreamConnected())

    act(() => {
      FakeEventSource.instances[0].emit('open')
    })
    expect(status.result.current).toBe(true)

    activity.unmount()
    expect(status.result.current).toBe(false)
    status.unmount()
  })
})
