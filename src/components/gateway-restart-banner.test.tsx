// @vitest-environment jsdom
/**
 * `startClaudeAgent()` (behind POST /api/start-agent) only ever spawns the
 * gateway when it's unreachable — it no-ops on an already-healthy one. So
 * this banner must offer "Start gateway" when the gateway is down and
 * "Restart gateway" (the real restart, via `gatewayRestart()` / the
 * dashboard's /api/gateway/restart, same mechanism the Providers screen
 * uses) when it's up. Both paths must confirm success with a bounded poll
 * rather than declaring victory the moment the request is accepted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import {
  GATEWAY_STATUS_HEALTHY_REFETCH_MS,
  GATEWAY_STATUS_UNHEALTHY_REFETCH_MS,
  GatewayRestartBanner,
  RESTART_POLL_INTERVAL_MS,
  RESTART_POLL_TIMEOUT_MS,
} from './gateway-restart-banner'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'

const gatewayRestartMock = vi.fn(() => Promise.resolve({ ok: true }))

vi.mock('@/lib/hermes-client', () => ({
  gatewayRestart: () => gatewayRestartMock(),
}))

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GatewayRestartBanner />
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response)
}

describe('GatewayRestartBanner', () => {
  beforeEach(() => {
    useGatewayRestartStore.setState({
      needsRestart: false,
      profileName: null,
      since: null,
    })
    gatewayRestartMock.mockReset().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders nothing when no restart is pending', () => {
    renderBanner()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('offers "Restart gateway" (the real restart) when the gateway is healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({ capabilities: { health: true } })
        }
        if (url.startsWith('/api/gateway-reprobe')) {
          return jsonResponse({ gateway: { available: true } })
        }
        return jsonResponse({})
      }),
    )

    act(() => {
      useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
    })
    renderBanner()

    const button = await screen.findByRole('button', {
      name: 'Restart gateway',
    })
    fireEvent.click(button)

    await waitFor(() =>
      expect(
        screen.getByText(/Gateway restarted — the new config is live\./),
      ).toBeTruthy(),
    )
    expect(gatewayRestartMock).toHaveBeenCalledTimes(1)
  })

  it('offers "Start gateway" (never claims to restart) when the gateway is down', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/gateway-status')) {
        return jsonResponse({ capabilities: { health: false } })
      }
      if (url.startsWith('/api/start-agent')) {
        return jsonResponse({ ok: true, message: 'started' })
      }
      if (url.startsWith('/api/gateway-reprobe')) {
        return jsonResponse({ gateway: { available: true } })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    act(() => {
      useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
    })
    renderBanner()

    const button = await screen.findByRole('button', { name: 'Start gateway' })
    fireEvent.click(button)

    await waitFor(() =>
      expect(
        screen.getByText(/Gateway started — the new config is live\./),
      ).toBeTruthy(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/start-agent',
      expect.objectContaining({ method: 'POST' }),
    )
    // Never called the gateway's own restart endpoint for the down case.
    expect(gatewayRestartMock).not.toHaveBeenCalled()
  })

  it('reports failure and keeps the copyable command when the restart call itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({ capabilities: { health: true } })
        }
        return jsonResponse({})
      }),
    )
    gatewayRestartMock.mockRejectedValueOnce(new Error('dashboard not running'))

    act(() => {
      useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
    })
    renderBanner()

    const button = await screen.findByRole('button', {
      name: 'Restart gateway',
    })
    fireEvent.click(button)

    await waitFor(() =>
      expect(screen.getByText(/dashboard not running/)).toBeTruthy(),
    )
    // The manual fallback never disappears, failure or not.
    expect(screen.getByText(/copy: hermes gateway restart/)).toBeTruthy()
    // Button is re-enabled so the user can retry.
    const retryButton = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Restart gateway',
    })
    expect(retryButton.disabled).toBe(false)
  })

  it('bounds the confirmation poll and gives up with a clear message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({ capabilities: { health: true } })
        }
        if (url.startsWith('/api/gateway-reprobe')) {
          // Never comes back healthy.
          return jsonResponse({ gateway: { available: false } })
        }
        return jsonResponse({})
      }),
    )

    act(() => {
      useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
    })
    renderBanner()

    // Get to the button under real timers (react-query/testing-library's
    // internal waits are real-time based); only the poll loop needs faking.
    const button = await screen.findByRole('button', {
      name: 'Restart gateway',
    })
    vi.useFakeTimers()
    fireEvent.click(button)

    // Drain the bounded poll loop (timeout + one interval of slack).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        RESTART_POLL_TIMEOUT_MS + RESTART_POLL_INTERVAL_MS * 2,
      )
    })

    expect(screen.getByText(/did not come back within/)).toBeTruthy()
    expect(screen.getByText(/copy: hermes gateway restart/)).toBeTruthy()
  })

  it('names the real problem (token mismatch) instead of "looks like it stopped" when /health 401s', async () => {
    // A 401 means the gateway IS up but this workspace's own bearer token
    // doesn't match — gateway-capabilities.ts's probeHealth() reports that as
    // health:false + authError:true (W3 audit item 5). Telling the user "the
    // gateway looks like it stopped" here would be actively wrong.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({
            capabilities: { health: false, authError: true },
          })
        }
        return jsonResponse({})
      }),
    )

    act(() => {
      useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
    })
    renderBanner()

    await waitFor(() =>
      expect(screen.getByText(/token doesn't match/)).toBeTruthy(),
    )
    expect(screen.queryByText(/looks like it stopped/)).toBeNull()
  })

  it('keeps the dismiss control working at every phase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({ capabilities: { health: true } })
        }
        return jsonResponse({})
      }),
    )

    act(() => {
      useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
    })
    renderBanner()

    await screen.findByRole('button', { name: 'Restart gateway' })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss banner' }))

    expect(useGatewayRestartStore.getState().needsRestart).toBe(false)
  })

  // Interval tests: everything runs on fake timers from before render so
  // react-query schedules its refetchInterval setInterval on the fake
  // clock; `advanceTimersByTimeAsync` also flushes the fetch promises.
  // The 1 s settle window lets the first fetch resolve before the first
  // checkpoint, so the interval's origin is within [0, 1 s] of mount.
  describe('gateway-status refetch cadence', () => {
    async function advanceTo(clock: { t: number }, targetMs: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(targetMs - clock.t)
        // Drain the fetch promise chains so call counts are stable on return.
        for (let i = 0; i < 10; i += 1) {
          await Promise.resolve()
        }
      })
      clock.t = targetMs
    }

    it('polls every 30 s while the gateway is healthy', async () => {
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({ capabilities: { health: true } })
        }
        return jsonResponse({})
      })
      vi.stubGlobal('fetch', fetchMock)

      act(() => {
        useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
      })
      vi.useFakeTimers()
      renderBanner()

      const statusCalls = () =>
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).startsWith('/api/gateway-status'),
        ).length
      const clock = { t: 0 }

      await advanceTo(clock, 1_000)
      expect(statusCalls()).toBe(1)
      expect(
        screen.getByRole('button', { name: 'Restart gateway' }),
      ).toBeTruthy()

      // Old code refetched at a fixed 15 s — already a second call by now.
      await advanceTo(clock, GATEWAY_STATUS_HEALTHY_REFETCH_MS - 1)
      expect(statusCalls()).toBe(1)

      await advanceTo(clock, GATEWAY_STATUS_HEALTHY_REFETCH_MS + 2_000)
      expect(statusCalls()).toBe(2)
    })

    it('polls every 10 s while the gateway is unhealthy', async () => {
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/gateway-status')) {
          return jsonResponse({ capabilities: { health: false } })
        }
        return jsonResponse({})
      })
      vi.stubGlobal('fetch', fetchMock)

      act(() => {
        useGatewayRestartStore.getState().markNeedsRestart('hermes-switch')
      })
      vi.useFakeTimers()
      renderBanner()

      const statusCalls = () =>
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).startsWith('/api/gateway-status'),
        ).length
      const clock = { t: 0 }

      await advanceTo(clock, 1_000)
      expect(statusCalls()).toBe(1)
      expect(screen.getByRole('button', { name: 'Start gateway' })).toBeTruthy()

      // The interval origin is t=0 (the immediate mock resolves before the
      // clock moves), so the second fetch lands at ~10 s, not 11 s.
      await advanceTo(clock, GATEWAY_STATUS_UNHEALTHY_REFETCH_MS - 1)
      expect(statusCalls()).toBe(1)

      // Old code waited 15 s — no second call by 13 s.
      await advanceTo(clock, GATEWAY_STATUS_UNHEALTHY_REFETCH_MS + 3_000)
      expect(statusCalls()).toBe(2)
    })
  })
})
