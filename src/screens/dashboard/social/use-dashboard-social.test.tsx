// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockDashboardSocial } from './mock'
import { useDashboardSocial } from './use-dashboard-social'
import type { ReactNode } from 'react'
import { setSessionProfile } from '@/lib/session-scope'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setSessionProfile(null)
})

function setup(status = 200) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(mockDashboardSocial), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
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

  it('keys the query by profile and polls every 30s', async () => {
    setSessionProfile('neo')
    const { result, client } = setup()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const query = client
      .getQueryCache()
      .find({ queryKey: ['dashboard', 'social', 'neo'] })
    expect(
      (query?.options as { refetchInterval?: number } | undefined)
        ?.refetchInterval,
    ).toBe(30_000)
  })

  it('surfaces a non-2xx response as an error', async () => {
    const { result } = setup(500)
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
