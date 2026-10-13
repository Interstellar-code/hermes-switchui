// @vitest-environment jsdom
/**
 * Perf pass P1: the banner used to fire a fixed 10 s setInterval probe of
 * /api/connection-status. It now self-schedules: 30 s while connected,
 * 10 s after a failed probe, and nothing at all while the tab is hidden
 * (resuming on visibilitychange). Only fetch and timers are faked — the
 * banner component itself is the code under test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ClaudeReconnectBanner } from './claude-reconnect-banner'

type FetchMock = ReturnType<typeof vi.fn>

function resJson(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 503,
    headers: {
      get: (name: string) =>
        name === 'content-type' ? 'application/json' : null,
    },
    json: () => Promise.resolve(body),
  } as Response)
}

function connectionStatusCalls(fetchMock: FetchMock): number {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).startsWith('/api/connection-status'),
  ).length
}

describe('ClaudeReconnectBanner poll cadence', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    try {
      delete (document as { hidden?: boolean }).hidden
    } catch {
      /* no own hidden property to restore */
    }
  })

  async function advance(ms: number) {
    await act(async () => {
      if (ms > 0) {
        await vi.advanceTimersByTimeAsync(ms)
      }
      // Drain the fetch promise chains so the next poll is scheduled
      // before the caller asserts on call counts.
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
    })
  }

  it('probes every 30 s while connected', async () => {
    const fetchMock = vi.fn(() => resJson({}))
    vi.stubGlobal('fetch', fetchMock)

    vi.useFakeTimers()
    render(<ClaudeReconnectBanner />)

    await advance(0)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    // Old code (fixed 10 s) already had its second probe here.
    await advance(10_000)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    await advance(19_999)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    await advance(1)
    expect(connectionStatusCalls(fetchMock)).toBe(2)
  })

  it('drops to 10 s after a failed probe', async () => {
    let connectionStatusOk = true
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/connection-status')) {
        return connectionStatusOk ? resJson({}) : resJson({}, false)
      }
      if (url.startsWith('/api/claude-proxy/health')) {
        return resJson({}, false)
      }
      if (url.startsWith('/api/start-claude')) {
        // Failed auto-restart: no 2.5 s follow-up probe to account for.
        return resJson({}, false)
      }
      return resJson({})
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.useFakeTimers()
    render(<ClaudeReconnectBanner />)

    await advance(0)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    // Old code probed at 10 s; the new code waits out the 30 s window.
    await advance(10_000)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    connectionStatusOk = false
    await advance(20_000)
    expect(connectionStatusCalls(fetchMock)).toBe(2)

    // The failed probe tightens the cadence to 10 s…
    await advance(10_000)
    expect(connectionStatusCalls(fetchMock)).toBe(3)

    // …and not sooner: the next probe waits the full 10 s.
    await advance(9_999)
    expect(connectionStatusCalls(fetchMock)).toBe(3)

    await advance(1)
    expect(connectionStatusCalls(fetchMock)).toBe(4)
  })

  it('schedules nothing while hidden and resumes on visibilitychange', async () => {
    let hidden = true
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    const fetchMock = vi.fn(() => resJson({}))
    vi.stubGlobal('fetch', fetchMock)

    vi.useFakeTimers()
    render(<ClaudeReconnectBanner />)

    // Old code probed on mount and every 10 s, hidden or not.
    await advance(60_000)
    expect(connectionStatusCalls(fetchMock)).toBe(0)

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(0)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    hidden = true
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(60_000)
    expect(connectionStatusCalls(fetchMock)).toBe(1)

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(0)
    expect(connectionStatusCalls(fetchMock)).toBe(2)
  })
})
