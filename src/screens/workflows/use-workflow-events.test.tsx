// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useWorkflowEvents } from './use-workflow-events'

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
}

function replay(opts?: { skipReplayed?: boolean }) {
  const hook = renderHook(() => useWorkflowEvents('run-1', opts))
  act(() => {
    const es = FakeEventSource.instances.at(-1)!
    es.listeners.get('node_completed')!({
      data: JSON.stringify({ _replayed: true }),
    } as MessageEvent)
    es.listeners.get('node_started')!({
      data: JSON.stringify({}),
    } as MessageEvent)
    vi.advanceTimersByTime(100)
  })
  return hook.result.current.events.map((e) => e.type)
}

describe('useWorkflowEvents replay filter', () => {
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

  it('keeps replayed frames by default', () => {
    expect(replay()).toEqual(['node_completed', 'node_started'])
  })

  it('drops replayed frames with skipReplayed', () => {
    expect(replay({ skipReplayed: true })).toEqual(['node_started'])
  })

  it('buffers the pause/resume/retry/session event types', () => {
    const hook = renderHook(() => useWorkflowEvents('run-1'))
    const types = [
      'node_paused',
      'workflow_resumed',
      'workflow_resumed_execute',
      'node_session_started',
      'node_retrying',
      'workflow_retried',
    ]
    act(() => {
      const es = FakeEventSource.instances.at(-1)!
      for (const t of types) {
        es.listeners.get(t)!({ data: JSON.stringify({}) } as MessageEvent)
      }
      vi.advanceTimersByTime(100)
    })
    expect(hook.result.current.events.map((e) => e.type)).toEqual(types)
  })
})
