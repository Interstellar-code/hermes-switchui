// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
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
    renderHook(() => useSearchData('all'), { wrapper: Wrapper })

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3))

    const urls = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.startsWith('/api/sessions') && u.includes('profile=neo'))).toBe(true)
    expect(urls.some((u) => u.startsWith('/api/skills') && u.includes('profile=neo'))).toBe(true)
    expect(urls.some((u) => u.startsWith('/api/files') && u.includes('profile='))).toBe(false)

    vi.unstubAllGlobals()
  })

  it('adds no ?profile= when unscoped — byte-identical request URLs to today', async () => {
    mockUseResolvedProfile.mockReturnValue(null)
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse({})))
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper } = createWrapper()
    renderHook(() => useSearchData('all'), { wrapper: Wrapper })

    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3))

    const urls = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.includes('profile='))).toBe(false)
    expect(urls).toContain('/api/sessions')

    vi.unstubAllGlobals()
  })
})
