// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useChatStore } from '../../../stores/chat-store'
import {
  DRAIN_WATCHDOG_IDLE_MS,
  useDrainWatchdog,
} from './use-drain-watchdog'
import type { ActiveRunSnapshot } from './use-active-run-check'

const SESSION = 'session-watchdog'

function enqueueOne(sessionKey = SESSION) {
  useChatStore.getState().enqueue(sessionKey, {
    id: 'q1',
    text: 'queued message',
    attachments: [],
  })
}

function mockActiveRun(run: ActiveRunSnapshot | null) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true, run }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Advance fake timers far enough to fire the watchdog tick and flush the
// resolved fetch microtasks.
async function runWatchdogTick() {
  // Tick interval (1s) + idle threshold cushion.
  await vi.advanceTimersByTimeAsync(DRAIN_WATCHDOG_IDLE_MS + 1_500)
}

describe('useDrainWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Reset only the slices this hook reads.
    useChatStore.setState({
      messageQueue: {},
      messageQueueActivity: {},
      lastEventAt: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('arms on a busy composer even with an empty queue (single-message lost run)', async () => {
    // No enqueue: the gateway-restart-mid-stream case has nothing queued behind
    // the in-flight run. The watchdog must still arm on the busy composer, probe
    // liveness, and reconcile when the run is gone — otherwise the thinking
    // bubble stays stuck until the 120s TTL.
    const fetchMock = mockActiveRun(null)
    const reconcile = vi.fn()

    renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: true,
        reconcile,
      }),
    )

    await runWatchdogTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledWith(SESSION)
  })

  it('does not arm (no fetch) when the composer is not busy', async () => {
    enqueueOne()
    const fetchMock = mockActiveRun(null)
    const reconcile = vi.fn()

    renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: false,
        reconcile,
      }),
    )

    await runWatchdogTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('does not fetch while SSE is still active (within the idle window)', async () => {
    enqueueOne()
    const fetchMock = mockActiveRun(null)
    const reconcile = vi.fn()
    // A fresh event keeps the idle delta below the threshold.
    useChatStore.setState({ lastEventAt: Date.now() })

    renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: true,
        reconcile,
      }),
    )

    // Advance less than the idle threshold.
    await vi.advanceTimersByTimeAsync(DRAIN_WATCHDOG_IDLE_MS - 1_000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('does NOT reconcile when the active run is still recoverable (live)', async () => {
    enqueueOne()
    // lastEventAt = 0 → idle since epoch → past threshold immediately.
    const fetchMock = mockActiveRun({
      runId: 'run-live',
      sessionKey: SESSION,
      status: 'active',
    })
    const reconcile = vi.fn()

    renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: true,
        reconcile,
      }),
    )

    await runWatchdogTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('reconciles when the run is not recoverable (null snapshot)', async () => {
    enqueueOne()
    const fetchMock = mockActiveRun(null)
    const reconcile = vi.fn()

    renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: true,
        reconcile,
      }),
    )

    await runWatchdogTick()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledWith(SESSION)
  })

  it('reconciles when the run is terminal (complete snapshot)', async () => {
    enqueueOne()
    const fetchMock = mockActiveRun({
      runId: 'run-done',
      sessionKey: SESSION,
      status: 'complete',
    })
    const reconcile = vi.fn()

    renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: true,
        reconcile,
      }),
    )

    await runWatchdogTick()

    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('does not fetch after unmount', async () => {
    enqueueOne()
    const fetchMock = mockActiveRun(null)
    const reconcile = vi.fn()

    const { unmount } = renderHook(() =>
      useDrainWatchdog({
        sessionKey: SESSION,
        isComposerLoading: true,
        reconcile,
      }),
    )

    unmount()
    await runWatchdogTick()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })
})
