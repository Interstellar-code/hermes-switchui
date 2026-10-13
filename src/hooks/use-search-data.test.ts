// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { searchKeys, useSearchData } from './use-search-data'

const mockUseResolvedProfile = vi.fn<() => string | null>(() => null)
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => mockUseResolvedProfile(),
}))

// useFeatureAvailable does its own gateway-status useQuery; stub it directly
// so these tests exercise only the search queries, not that indirection.
vi.mock('@/hooks/use-feature-available', () => ({
  useFeatureAvailable: () => true,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('searchKeys', () => {
  it("sessions/skills are byte-identical to today's bare key when unscoped", () => {
    expect(searchKeys.sessions(null)).toEqual(['search', 'sessions'])
    expect(searchKeys.skills(null)).toEqual(['search', 'skills'])
  })

  it('sessions/skills differ across two profiles, and from unscoped', () => {
    for (const build of [searchKeys.sessions, searchKeys.skills]) {
      const neo = build('neo')
      const trinity = build('trinity')
      const unscoped = build(null)
      expect(JSON.stringify(neo)).not.toBe(JSON.stringify(trinity))
      expect(JSON.stringify(neo)).not.toBe(JSON.stringify(unscoped))
      expect(JSON.stringify(trinity)).not.toBe(JSON.stringify(unscoped))
    }
  })

  it('files stays unscoped — no per-Hermes-profile notion on the filesystem walk', () => {
    expect(searchKeys.files).toEqual(['search', 'files'])
  })
})

describe('useSearchData profile threading', () => {
  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return {
      queryClient,
      Wrapper: function QueryClientWrapper({
        children,
      }: {
        children: React.ReactNode
      }) {
        return React.createElement(
          QueryClientProvider,
          { client: queryClient },
          children,
        )
      },
    }
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('threads ?profile= onto /api/sessions and /api/skills when a profile is resolved, but not /api/files', async () => {
    mockUseResolvedProfile.mockReturnValue('neo')
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse({})))
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper } = createWrapper()
    renderHook(() => useSearchData('all', true), { wrapper: Wrapper })

    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3),
    )

    const urls = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(
      urls.some(
        (u) => u.startsWith('/api/sessions') && u.includes('profile=neo'),
      ),
    ).toBe(true)
    expect(
      urls.some(
        (u) => u.startsWith('/api/skills') && u.includes('profile=neo'),
      ),
    ).toBe(true)
    expect(
      urls.some((u) => u.startsWith('/api/files') && u.includes('profile=')),
    ).toBe(false)

    vi.unstubAllGlobals()
  })

  it('adds no ?profile= when unscoped — byte-identical request URLs to today', async () => {
    mockUseResolvedProfile.mockReturnValue(null)
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse({})))
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper } = createWrapper()
    renderHook(() => useSearchData('all', true), { wrapper: Wrapper })

    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3),
    )

    const urls = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.includes('profile='))).toBe(false)
    expect(urls).toContain('/api/sessions')

    vi.unstubAllGlobals()
  })

  it('makes no sessions/files/skills request while the modal is closed', async () => {
    mockUseResolvedProfile.mockReturnValue(null)
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse({})))
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper } = createWrapper()
    renderHook(() => useSearchData('all', false), { wrapper: Wrapper })

    // Old code fetched all three sources on mount; give those effects room
    // to run before asserting none did.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not cache an empty list when a fetch times out and aborts', async () => {
    mockUseResolvedProfile.mockReturnValue(null)
    // Realistic abort: the mock honours the request signal and only rejects
    // when it actually aborts (REQUEST_TIMEOUT_MS = 3 s under fake timers).
    const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/sessions')) {
        return new Promise<never>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
      }
      return Promise.resolve(jsonResponse({ entries: [] }))
    })
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper, queryClient } = createWrapper()
    vi.useFakeTimers()
    renderHook(() => useSearchData('all', true), { wrapper: Wrapper })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500)
      // Let the rejection propagate to the query's error state.
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
      }
    })

    const state = queryClient.getQueryState(searchKeys.sessions(null))
    // Old code resolved the abort to [] and cached it as a success.
    expect(state?.status).toBe('error')
    expect(state?.data).toBeUndefined()
    expect(state?.data).not.toEqual([])
  })
})
