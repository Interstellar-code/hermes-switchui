// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LIVE_INVALIDATE_MS, useConductorLive } from './use-conductor-live'
import type { ReactNode } from 'react'

class FakeEventSource {
  static instances: Array<FakeEventSource> = []
  listeners = new Map<string, (e: MessageEvent) => void>()
  onmessage: ((e: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, fn)
  }
  emit(type: string, data: Record<string, unknown>) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

function setup(runId: string | null) {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(({ id }) => useConductorLive(id), {
    wrapper,
    initialProps: { id: runId },
  })
  return { hook, invalidate }
}

/** Emit, then let the 80ms SSE flush run. */
function emit(type: string, data: Record<string, unknown>) {
  act(() => {
    FakeEventSource.instances.at(-1)!.emit(type, data)
    vi.advanceTimersByTime(100)
  })
}

describe('useConductorLive', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.useFakeTimers()
    ;(globalThis as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens no stream while idle', () => {
    setup(null)
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('opens exactly one stream, for the selected run', () => {
    setup('run-1')
    expect(FakeEventSource.instances.map((e) => e.url)).toEqual([
      '/api/workflow-events?runId=run-1',
    ])
  })

  it('ignores replayed frames (D9)', () => {
    const { hook, invalidate } = setup('run-1')
    emit('node_completed', { event_type: 'node_completed', _replayed: true })
    expect(hook.result.current.events).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('node events invalidate run + missions, throttled to ≤1/s', () => {
    const { invalidate } = setup('run-1')
    const keys = () => invalidate.mock.calls.map((c) => c[0]?.queryKey)

    emit('node_started', { event_type: 'node_started' })
    expect(keys()).toEqual([
      ['workflow-runs', 'run-1'],
      ['conductor', 'missions'],
    ])

    emit('node_completed', { event_type: 'node_completed' })
    emit('node_started', { event_type: 'node_started' })
    expect(invalidate).toHaveBeenCalledTimes(2) // still inside the window

    act(() => {
      vi.advanceTimersByTime(LIVE_INVALIDATE_MS)
    })
    expect(invalidate).toHaveBeenCalledTimes(4) // one trailing flush

    emit('tool_called', { event_type: 'tool_called' })
    act(() => {
      vi.advanceTimersByTime(LIVE_INVALIDATE_MS * 2)
    })
    expect(invalidate).toHaveBeenCalledTimes(4) // non-node events don't invalidate
  })

  it("does not rescan the previous run's events after switching runs", () => {
    const { hook, invalidate } = setup('run-1')
    emit('node_started', { event_type: 'node_started' })
    emit('node_completed', { event_type: 'node_completed' })
    expect(invalidate).toHaveBeenCalledTimes(2)

    hook.rerender({ id: 'run-2' })
    act(() => {
      vi.advanceTimersByTime(LIVE_INVALIDATE_MS)
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
