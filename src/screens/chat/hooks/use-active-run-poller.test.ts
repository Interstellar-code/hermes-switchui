// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useActiveRunPoller } from './use-active-run-poller'
import type { RefObject } from 'react'

import type { ActiveRunSnapshot } from './use-active-run-check'
import type { ActiveSendRecord } from './use-send-message-state'

const SESSION = 'session-poller'

// A run that is NOT recoverable — status 'complete' is terminal.
const TERMINAL_RUN: ActiveRunSnapshot = {
  runId: 'run-1',
  status: 'complete',
  sessionKey: SESSION,
}

// A run that IS recoverable — status 'active' keeps the poller from clearing.
const ACTIVE_RUN: ActiveRunSnapshot = {
  runId: 'run-2',
  status: 'active',
  sessionKey: SESSION,
}

function mockFetch(run: ActiveRunSnapshot | null, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve({ ok, run }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function ref<T>(initial: T): RefObject<T> {
  return { current: initial }
}

type PollerParams = Parameters<typeof useActiveRunPoller>[0]

function makeProps(overrides: Partial<PollerParams> = {}): PollerParams {
  return {
    waitingForResponse: overrides.waitingForResponse ?? true,
    resolvedSessionKey: overrides.resolvedSessionKey ?? SESSION,
    activeSendRef: overrides.activeSendRef ?? ref<ActiveSendRecord | null>(null),
    activeRealtimeStreamingRef:
      overrides.activeRealtimeStreamingRef ?? ref<boolean>(false),
    streamFinish: overrides.streamFinish ?? vi.fn(),
    refreshHistoryRef:
      overrides.refreshHistoryRef ?? ref<() => void>(vi.fn()),
  }
}

describe('useActiveRunPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not poll when !waitingForResponse or !resolvedSessionKey', async () => {
    const fetchMock = mockFetch(TERMINAL_RUN)

    // No waiting → no poll.
    const { rerender } = renderHook(
      (p: PollerParams) => useActiveRunPoller(p),
      { initialProps: makeProps({ waitingForResponse: false }) },
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()

    // Now waiting but no key → still no poll.
    rerender(makeProps({ waitingForResponse: true, resolvedSessionKey: '' }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls every 5s for active-run completion', async () => {
    mockFetch(ACTIVE_RUN)
    const fetchMock = vi.mocked(globalThis.fetch)

    renderHook((p: PollerParams) => useActiveRunPoller(p), {
      initialProps: makeProps(),
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalled()
    const callsAfter5s = fetchMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfter5s)
  })

  it('calls streamFinish + refreshHistoryRef when run is not recoverable', async () => {
    // Terminal run + no local activity → should clear waiting state.
    mockFetch(TERMINAL_RUN)
    const streamFinish = vi.fn()
    const refreshFn = vi.fn()
    const props = makeProps({
      activeSendRef: ref<ActiveSendRecord | null>(null),
      activeRealtimeStreamingRef: ref<boolean>(false),
      streamFinish,
      refreshHistoryRef: ref<() => void>(refreshFn),
    })

    renderHook((p: PollerParams) => useActiveRunPoller(p), {
      initialProps: props,
    })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(streamFinish).toHaveBeenCalledTimes(1)
    expect(refreshFn).toHaveBeenCalledTimes(1)
  })

  it('does NOT clear when there is local runtime activity', async () => {
    mockFetch(TERMINAL_RUN)
    const streamFinish = vi.fn()
    const refreshFn = vi.fn()
    const props = makeProps({
      activeRealtimeStreamingRef: ref<boolean>(true),
      streamFinish,
      refreshHistoryRef: ref<() => void>(refreshFn),
    })

    renderHook((p: PollerParams) => useActiveRunPoller(p), {
      initialProps: props,
    })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(streamFinish).not.toHaveBeenCalled()
    expect(refreshFn).not.toHaveBeenCalled()
  })

  it('returns liveProgressLabel derived from tool calls', async () => {
    const runWithTool = {
      runId: 'run-3',
      status: 'active',
      sessionKey: SESSION,
      // toolCalls is intentionally untyped on ActiveRunSnapshot at runtime —
      // the poller reads it defensively via Array.isArray.
      toolCalls: [
        { name: 'read_file', phase: 'calling', preview: 'main.ts' },
      ],
    } as unknown as ActiveRunSnapshot
    mockFetch(runWithTool)

    const { result } = renderHook(
      (p: PollerParams) => useActiveRunPoller(p),
      { initialProps: makeProps() },
    )

    // Poller 2 fires an immediate poll on mount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // verbForTool('read_file') → 'Reading'; preview appended.
    expect(result.current.liveProgressLabel).toContain('Reading')
    expect(result.current.liveProgressLabel).toContain('main.ts')
  })

  it('clears the label when waiting stops', async () => {
    const runWithTool = {
      runId: 'run-4',
      status: 'active',
      sessionKey: SESSION,
      toolCalls: [{ name: 'bash', phase: 'calling' }],
    } as unknown as ActiveRunSnapshot
    mockFetch(runWithTool)

    const { result, rerender } = renderHook(
      (p: PollerParams) => useActiveRunPoller(p),
      { initialProps: makeProps() },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.liveProgressLabel).not.toBe('')

    // Stop waiting → label clears immediately via the early-return branch.
    rerender(makeProps({ waitingForResponse: false }))
    expect(result.current.liveProgressLabel).toBe('')
  })
})
