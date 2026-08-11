// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { countFromArray, navCountKeys, useNavCounts } from './use-nav-counts'

const mockUseResolvedProfile = vi.fn<() => string | null>(() => null)
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => mockUseResolvedProfile(),
}))

afterEach(() => vi.restoreAllMocks())

describe('countFromArray', () => {
  it('uses an API total instead of a truncated page length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ skills: Array(200), total: 329 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )

    await expect(
      countFromArray('/api/skills?tab=installed&limit=200', 'skills', 'total'),
    ).resolves.toBe(329)
  })

  it('falls back to the array length when no total is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ profiles: [{ name: 'neo' }] }), {
            status: 200,
          }),
        ),
      ),
    )

    await expect(
      countFromArray('/api/profiles/list', 'profiles'),
    ).resolves.toBe(1)
  })
})

describe('navCountKeys', () => {
  const builders: Array<[string, (profile: string | null) => Array<unknown>]> = [
    ['tasks', navCountKeys.tasks],
    ['templates', navCountKeys.templates],
    ['jobs', navCountKeys.jobs],
    ['sessions', navCountKeys.sessions],
    ['workflows', navCountKeys.workflows],
    ['skills', navCountKeys.skills],
    ['mcp', navCountKeys.mcp],
    ['profiles', navCountKeys.profiles],
  ]

  for (const [name, build] of builders) {
    it(`${name} is byte-identical to today's bare key when unscoped`, () => {
      expect(build(null)).toEqual(['nav-count', name])
    })

    it(`${name} differs across two profiles`, () => {
      const neo = build('neo')
      const trinity = build('trinity')
      const unscoped = build(null)
      expect(JSON.stringify(neo)).not.toBe(JSON.stringify(trinity))
      expect(JSON.stringify(neo)).not.toBe(JSON.stringify(unscoped))
      expect(JSON.stringify(trinity)).not.toBe(JSON.stringify(unscoped))
    })
  }
})

describe('useNavCounts profile threading', () => {
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

  it('threads ?profile= onto /api/sessions and /api/skills, but not the other endpoints, when a profile is resolved', async () => {
    mockUseResolvedProfile.mockReturnValue('neo')
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse({})))
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper } = createWrapper()
    renderHook(() => useNavCounts(true), { wrapper: Wrapper })

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    // Let all nine badge queries settle.
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(8))

    const urls = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.startsWith('/api/sessions') && u.includes('profile=neo'))).toBe(true)
    expect(urls.some((u) => u.startsWith('/api/skills') && u.includes('profile=neo'))).toBe(true)
    // No-profile-support endpoints must NOT get a profile param.
    expect(urls.some((u) => u.startsWith('/api/mcp') && u.includes('profile='))).toBe(false)
    expect(urls.some((u) => u.startsWith('/api/workflow-definitions') && u.includes('profile='))).toBe(false)

    vi.unstubAllGlobals()
  })

  it('adds no ?profile= at all when unscoped — byte-identical request URLs to today', async () => {
    mockUseResolvedProfile.mockReturnValue(null)
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse({})))
    vi.stubGlobal('fetch', mockFetch)

    const { Wrapper } = createWrapper()
    renderHook(() => useNavCounts(true), { wrapper: Wrapper })

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(8))

    const urls = mockFetch.mock.calls.map((call) => String(call[0]))
    expect(urls.some((u) => u.includes('profile='))).toBe(false)
    expect(urls).toContain('/api/sessions')

    vi.unstubAllGlobals()
  })
})
