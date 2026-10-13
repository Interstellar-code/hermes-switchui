// @vitest-environment jsdom
/**
 * Contract for the shared session-status poll (perf-pass2 C1): the chat page
 * mounts useSessionStatus four times (context-bar, chat-header-v2,
 * chat-header-actions-v2, chat-meta-bar-v2) — all mounts must share ONE
 * /api/session-status request per interval, keep the legacy EMPTY_PAYLOAD
 * default, 401→context-usage fallback, and 5s-doubling backoff that stops
 * after 5 consecutive failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  __resetSessionStatusFailures,
  useSessionStatus,
} from './use-session-status'
import type { SessionStatusPayload } from './use-session-status'
import type { ReactNode } from 'react'

import type { Mock } from 'vitest'

const EMPTY_PAYLOAD: SessionStatusPayload = {
  contextPercent: 0,
  model: '',
  maxTokens: 0,
  usedTokens: 0,
  status: 'idle',
  sessionKey: 'new',
  sessionLabel: '',
  modelProvider: '',
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
  estimatedCost: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  apiCallCount: 0,
  source: '',
  endReason: '',
  estimated: true,
  maxSource: 'default',
  compressionThreshold: null,
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

function sessionStatusBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    payload: {
      contextPercent: 12,
      model: 'claude-test',
      status: 'running',
      sessionKey: 'sess-1',
      ...overrides,
    },
  }
}

let fetchMock: Mock

function countCalls(path: string): number {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes(path)).length
}

function setupHook(sessionKey: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useSessionStatus(sessionKey), { wrapper })
}

/** Advance fake time and let queued fetch promises resolve. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    // TanStack batches observer notifications behind a setTimeout(0)
    // (query-core notifyManager), which fake timers hold until the clock
    // moves again. Without this extra tick the query cache has the new
    // payload but the hook still renders the previous one.
    await vi.advanceTimersByTimeAsync(1)
  })
  // Drain the promise chain a boundary-fired fetch leaves behind.
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

describe('useSessionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSessionStatusFailures()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shares one request per interval across 4 consumers and returns EMPTY_PAYLOAD before data', async () => {
    let resolveFirst!: (value: Response) => void
    const firstCall = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    fetchMock.mockImplementationOnce(() => firstCall)
    fetchMock.mockImplementation(() =>
      jsonResponse(sessionStatusBody({ contextPercent: 50 })),
    )

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hooks = [0, 1, 2, 3].map(() =>
      renderHook(() => useSessionStatus('sess-1'), { wrapper }),
    )

    expect(hooks.map((h) => h.result.current)).toEqual([
      EMPTY_PAYLOAD,
      EMPTY_PAYLOAD,
      EMPTY_PAYLOAD,
      EMPTY_PAYLOAD,
    ])

    resolveFirst(await jsonResponse(sessionStatusBody({ contextPercent: 50 })))
    await advance(0)
    expect(countCalls('/api/session-status')).toBe(1)
    expect(hooks.every((h) => h.result.current.contextPercent === 50)).toBe(
      true,
    )

    await advance(15_000)
    expect(countCalls('/api/session-status')).toBe(2)
  })

  it('falls back to /api/context-usage on 401 and resumes the 15 s cadence', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/session-status'))
        return jsonResponse({}, false, 401)
      if (url.includes('/api/context-usage')) {
        return jsonResponse({
          ok: true,
          model: 'fallback-model',
          contextPercent: 42,
          usedTokens: 111,
          maxTokens: 222,
          estimated: false,
          maxSource: 'gateway',
          compressionThreshold: 0.8,
        })
      }
      return jsonResponse({}, false, 404)
    })

    const hook = setupHook('sess-2')
    await advance(0)

    expect(countCalls('/api/context-usage')).toBe(1)
    expect(hook.result.current.contextPercent).toBe(42)
    expect(hook.result.current.model).toBe('fallback-model')
    expect(hook.result.current.usedTokens).toBe(111)
    expect(hook.result.current.estimated).toBe(false)
    expect(hook.result.current.maxSource).toBe('gateway')
    expect(hook.result.current.compressionThreshold).toBe(0.8)
    expect(hook.result.current.status).toBe('idle')

    await advance(15_000)
    expect(countCalls('/api/session-status')).toBe(2)
    expect(countCalls('/api/context-usage')).toBe(2)
  })

  it('backs off 5 s doubling on 5xx and stops after 5 consecutive failures', async () => {
    fetchMock.mockImplementation(() => jsonResponse({}, false, 503))

    const hook = setupHook('sess-3')
    await advance(0)
    expect(countCalls('/api/session-status')).toBe(1)

    await advance(5_000)
    expect(countCalls('/api/session-status')).toBe(2)

    await advance(10_000)
    expect(countCalls('/api/session-status')).toBe(3)

    await advance(20_000)
    expect(countCalls('/api/session-status')).toBe(4)

    await advance(40_000)
    expect(countCalls('/api/session-status')).toBe(5)
    expect(hook.result.current).toEqual(EMPTY_PAYLOAD)

    await advance(120_000)
    expect(countCalls('/api/session-status')).toBe(5)
  })

  it('recovers to the 15 s cadence after a 5xx succeeds again', async () => {
    fetchMock.mockImplementationOnce(() => jsonResponse({}, false, 500))
    fetchMock.mockImplementation(() =>
      jsonResponse(sessionStatusBody({ contextPercent: 33, model: 'back' })),
    )

    const hook = setupHook('sess-4')
    await advance(0)
    expect(countCalls('/api/session-status')).toBe(1)
    expect(hook.result.current).toEqual(EMPTY_PAYLOAD)

    await advance(5_000)
    expect(countCalls('/api/session-status')).toBe(2)
    expect(hook.result.current.contextPercent).toBe(33)
    expect(hook.result.current.model).toBe('back')

    await advance(5_000)
    expect(countCalls('/api/session-status')).toBe(2)

    await advance(10_000)
    expect(countCalls('/api/session-status')).toBe(3)
  })

  it('never shares data between session keys', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      const key = url.searchParams.get('sessionKey') ?? ''
      return jsonResponse(sessionStatusBody({ model: `model-${key}` }))
    })

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const a = renderHook(() => useSessionStatus('sess-a'), { wrapper })
    const b = renderHook(() => useSessionStatus('sess-b'), { wrapper })
    await advance(0)

    expect(countCalls('/api/session-status')).toBe(2)
    expect(a.result.current.model).toBe('model-sess-a')
    expect(b.result.current.model).toBe('model-sess-b')
  })
})
