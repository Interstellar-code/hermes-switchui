// @vitest-environment jsdom
/**
 * perf-pass2 C1: the context alert must read the shared session-status poll
 * (see use-session-status.ts) instead of issuing its own /api/context-usage
 * request every 15 s — while firing at the same thresholds (90/75), keeping
 * the same-day sessionStorage dedupe, the 'new'/'main' guards, and the
 * real-time context-usage-store reactions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useContextAlert } from './use-context-alert'
import type { ReactNode } from 'react'

import type { Mock } from 'vitest'
import { __resetSessionStatusFailures } from '@/hooks/use-session-status'
import { useContextUsageStore } from '@/stores/context-usage-store'

const REAL_KEY = 'sess-1'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

function sessionStatusAt(percent: number) {
  return jsonResponse({
    ok: true,
    payload: { contextPercent: percent, model: 'claude-test' },
  })
}

let fetchMock: Mock

function countCalls(path: string): number {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes(path)).length
}

function renderAlert(sessionKey: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useContextAlert(sessionKey), { wrapper })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function storedSentFlags(): Record<string, boolean> {
  const raw = window.sessionStorage.getItem(`claude-ctx-alert:${REAL_KEY}`)
  return raw ? (JSON.parse(raw) as { sent: Record<string, boolean> }).sent : {}
}

describe('useContextAlert', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSessionStatusFailures()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    window.sessionStorage.clear()
    useContextUsageStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('mounts without any /api/context-usage request and fires the 75 % threshold from the shared poll', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/session-status')) return sessionStatusAt(80)
      return jsonResponse({ ok: true, contextPercent: 80 })
    })

    const { result } = renderAlert(REAL_KEY)
    await advance(0)

    expect(countCalls('/api/context-usage')).toBe(0)
    expect(countCalls('/api/session-status')).toBe(1)
    expect(result.current.alertOpen).toBe(true)
    expect(result.current.alertThreshold).toBe(75)
    expect(result.current.alertPercent).toBe(80)
    expect(storedSentFlags()).toEqual({ '75': true, '90': false })
  })

  it('fires 90 first, then 75 on a same-day remount (sessionStorage dedupe)', async () => {
    fetchMock.mockImplementation(() => sessionStatusAt(95))

    const first = renderAlert(REAL_KEY)
    await advance(0)
    expect(first.result.current.alertOpen).toBe(true)
    expect(first.result.current.alertThreshold).toBe(90)
    expect(storedSentFlags()).toEqual({ '75': false, '90': true })
    first.unmount()

    const second = renderAlert(REAL_KEY)
    await advance(0)
    expect(second.result.current.alertOpen).toBe(true)
    expect(second.result.current.alertThreshold).toBe(75)
    expect(second.result.current.alertPercent).toBe(95)
    expect(storedSentFlags()).toEqual({ '75': true, '90': true })
  })

  it('stays silent below the thresholds', async () => {
    fetchMock.mockImplementation(() => sessionStatusAt(40))

    const { result } = renderAlert(REAL_KEY)
    await advance(0)

    expect(result.current.alertOpen).toBe(false)
    expect(result.current.alertThreshold).toBe(0)
    expect(result.current.alertPercent).toBe(40)
  })

  it('makes no request at all for the "new" key', async () => {
    const { result } = renderAlert('new')
    await advance(0)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.alertOpen).toBe(false)
  })

  it('still reacts in real time to context-usage-store updates for its session', async () => {
    fetchMock.mockImplementation(() => sessionStatusAt(10))

    const { result } = renderAlert(REAL_KEY)
    await advance(0)
    expect(result.current.alertOpen).toBe(false)
    expect(result.current.alertPercent).toBe(10)

    act(() => {
      const store = useContextUsageStore.getState()
      store.setSessionKey(REAL_KEY)
      store.updateContextPercent(REAL_KEY, 93)
    })

    expect(result.current.alertOpen).toBe(true)
    expect(result.current.alertThreshold).toBe(90)
    expect(result.current.alertPercent).toBe(93)
  })
})
