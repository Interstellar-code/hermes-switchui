// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useChatStore } from '../../../stores/chat-store'
import { isRecoverableActiveRun } from './use-active-run-check'
import type { ActiveRunSnapshot } from './use-active-run-check'
import type { ChatMessage } from '../types'

const SESSION = 'session-recovery'

function mockActiveRun(run: ActiveRunSnapshot | null) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, run }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function userMessage(): ChatMessage {
  return {
    role: 'user',
    status: 'queued',
    __optimisticId: 'opt-1',
    content: [{ type: 'text', text: 'first prompt' }],
  }
}

function answeredMessages(): Array<ChatMessage> {
  return [
    userMessage(),
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
    },
  ]
}

function unansweredMessages(): Array<ChatMessage> {
  return [userMessage()]
}

function toolOnlyMessages(): Array<ChatMessage> {
  return [
    userMessage(),
    {
      role: 'tool',
      content: [{ type: 'text', text: 'tool result' }],
    },
  ]
}

describe('isRecoverableActiveRun', () => {
  it('treats accepted and active runs as recoverable', () => {
    expect(
      isRecoverableActiveRun({
        runId: 'run-accepted',
        sessionKey: 'session-1',
        status: 'accepted',
      }),
    ).toBe(true)
    expect(
      isRecoverableActiveRun({
        runId: 'run-active',
        sessionKey: 'session-1',
        status: 'active',
      }),
    ).toBe(true)
  })

  it('keeps only recent handoff runs recoverable', () => {
    expect(
      isRecoverableActiveRun(
        {
          runId: 'recent-handoff',
          sessionKey: 'session-1',
          status: 'handoff',
          lastEventAt: 10_000,
        },
        35_000,
      ),
    ).toBe(true)

    expect(
      isRecoverableActiveRun(
        {
          runId: 'stale-handoff',
          sessionKey: 'session-1',
          status: 'handoff',
          lastEventAt: 10_000,
        },
        45_001,
      ),
    ).toBe(false)
  })

  it('does not recover terminal or stalled runs', () => {
    expect(
      isRecoverableActiveRun({
        runId: 'run-complete',
        sessionKey: 'session-1',
        status: 'complete',
      }),
    ).toBe(false)
    expect(
      isRecoverableActiveRun({
        runId: 'run-stalled',
        sessionKey: 'session-1',
        status: 'stalled',
      }),
    ).toBe(false)
  })
})

describe('useActiveRunCheck — recovery (Track 1.2)', () => {
  beforeEach(() => {
    useChatStore.setState({
      waitingSessionKeys: new Set(),
      waitingSessionMeta: {},
      interruptedSessionKeys: new Set(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function flush() {
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
  }

  it('marks waiting when a recoverable snapshot arrives (snapshot-first)', async () => {
    vi.useFakeTimers()
    mockActiveRun({ runId: 'run-live', sessionKey: SESSION, status: 'active' })
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: answeredMessages(),
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionWaiting(SESSION)).toBe(true)
    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
    vi.useRealTimers()
  })

  it('marks interrupted when snapshot absent + unanswered + not tool-only + has history', async () => {
    vi.useFakeTimers()
    mockActiveRun(null)
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: unansweredMessages(),
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionWaiting(SESSION)).toBe(false)
    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(true)
    vi.useRealTimers()
  })

  it('F1 guard: tool-only completion does NOT set interrupted', async () => {
    vi.useFakeTimers()
    mockActiveRun(null)
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: toolOnlyMessages(),
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionWaiting(SESSION)).toBe(false)
    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
    vi.useRealTimers()
  })

  it('clears cleanly when answered turn + stale snapshot', async () => {
    vi.useFakeTimers()
    useChatStore.getState().setSessionWaiting(SESSION, 'old-run')
    mockActiveRun(null)
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: answeredMessages(),
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionWaiting(SESSION)).toBe(false)
    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
    vi.useRealTimers()
  })

  it('portable empty history: predicate short-circuits, no interrupted', async () => {
    vi.useFakeTimers()
    mockActiveRun(null)
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: [],
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionWaiting(SESSION)).toBe(false)
    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
    vi.useRealTimers()
  })

  it('feature flag OFF: no interrupted affordance even with unanswered history', async () => {
    vi.useFakeTimers()
    localStorage.setItem('switchui:recovery-reconcile-v1', '0')
    mockActiveRun(null)
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: unansweredMessages(),
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
    vi.useRealTimers()
  })

  it('recoverable snapshot clears any prior interrupted flag', async () => {
    vi.useFakeTimers()
    useChatStore.getState().setSessionInterrupted(SESSION)
    mockActiveRun({ runId: 'run-live', sessionKey: SESSION, status: 'active' })
    const { useActiveRunCheck } = await import('./use-active-run-check')

    renderHook(() =>
      useActiveRunCheck({
        sessionKey: SESSION,
        enabled: true,
        messages: answeredMessages(),
      }),
    )
    await flush()

    expect(useChatStore.getState().isSessionInterrupted(SESSION)).toBe(false)
    expect(useChatStore.getState().isSessionWaiting(SESSION)).toBe(true)
    vi.useRealTimers()
  })
})
