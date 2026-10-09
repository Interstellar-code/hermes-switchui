// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockDashboardSocial, mockDashboardSocialEmpty } from './mock'
import { useDashboardSocial } from './use-dashboard-social'
import type { ReactNode } from 'react'
import { setSessionProfile } from '@/lib/session-scope'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
  setSessionProfile(null)
})

// Payloads are served in order; the last one repeats.
function setup(status = 200, payloads: Array<unknown> = [mockDashboardSocial]) {
  let call = 0
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]),
        {
          status,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return {
    fetchMock,
    client,
    ...renderHook(() => useDashboardSocial(), { wrapper }),
  }
}

describe('useDashboardSocial', () => {
  it('omits the profile param when unscoped', async () => {
    const { result, fetchMock } = setup()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual(['/api/dashboard/social'])
    expect(result.current.data).toEqual(mockDashboardSocial)
  })

  it('sends ?profile=neo when a profile is resolved', async () => {
    setSessionProfile('neo')
    const { result, fetchMock } = setup()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/dashboard/social?profile=neo',
    ])
  })

  it('keys the query by profile and polls every 30s when complete', async () => {
    setSessionProfile('neo')
    const { result, client } = setup()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = client
      .getQueryCache()
      .find({ queryKey: ['dashboard', 'social', 'neo'] })
    const interval = (
      query?.options as {
        refetchInterval?: (q: NonNullable<typeof query>) => number
      }
    ).refetchInterval
    expect(interval?.(query!)).toBe(30_000)
  })

  it('retries a null-slice response every 5s, at most 3 times, then polls every 30s', async () => {
    vi.useFakeTimers()
    const { fetchMock } = setup(200, [mockDashboardSocialEmpty])
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    // cap reached: nothing at +5s, next poll at +30s
    await vi.advanceTimersByTimeAsync(25_000)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('stops the fast retry once a complete response arrives', async () => {
    vi.useFakeTimers()
    const { fetchMock } = setup(200, [
      mockDashboardSocialEmpty,
      mockDashboardSocial,
    ])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('surfaces a non-2xx response as an error', async () => {
    const { result } = setup(500)
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
