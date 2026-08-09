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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import {
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

    const button = await screen.findByRole('button', { name: 'Restart gateway' })
    fireEvent.click(button)

    await waitFor(() =>
      expect(screen.getByText(/Gateway restarted — the new config is live\./)).toBeTruthy(),
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
      expect(screen.getByText(/Gateway started — the new config is live\./)).toBeTruthy(),
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

    const button = await screen.findByRole('button', { name: 'Restart gateway' })
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText(/dashboard not running/)).toBeTruthy())
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
    const button = await screen.findByRole('button', { name: 'Restart gateway' })
    vi.useFakeTimers()
    fireEvent.click(button)

    // Drain the bounded poll loop (timeout + one interval of slack).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESTART_POLL_TIMEOUT_MS + RESTART_POLL_INTERVAL_MS * 2)
    })

    expect(screen.getByText(/did not come back within/)).toBeTruthy()
    expect(screen.getByText(/copy: hermes gateway restart/)).toBeTruthy()
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
})
