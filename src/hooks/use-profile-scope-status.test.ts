// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  PROFILE_SCOPE_STATUS_KEY,
  useProfileScopeStatus,
} from './use-profile-scope-status'

const mockFetch = vi.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body, text: async () => JSON.stringify(body) }
}

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

describe('useProfileScopeStatus', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shares the composer cache entry under the exact query key', () => {
    expect(PROFILE_SCOPE_STATUS_KEY).toEqual(['profiles', 'scope-status'])
  })

  it('reads "served" when multiplex servedProfiles includes the profile', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: {
          mode: 'multiplex',
          servedProfiles: ['neo', 'trinity'],
          sessionCounts: {},
        },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('neo'), {
      wrapper: Wrapper,
    })
    await waitFor(() =>
      expect(result.current.reachability).toBe('served'),
    )
    expect(result.current.mode).toBe('multiplex')
  })

  it('reads "not-served" when multiplex servedProfiles excludes the profile — the actionable G-05 case', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'multiplex', servedProfiles: ['neo'], sessionCounts: {} },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('morpheus'), {
      wrapper: Wrapper,
    })
    await waitFor(() =>
      expect(result.current.reachability).toBe('not-served'),
    )
  })

  it('reads "served" under single-gateway mode when this IS the profile the gateway is running', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: {
          mode: 'single',
          servedProfiles: null,
          servingProfile: 'hermes-switch',
          sessionCounts: {},
        },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('hermes-switch'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.mode).toBe('single'))
    expect(result.current.reachability).toBe('served')
    expect(result.current.servingProfile).toBe('hermes-switch')
  })

  it('reads "not-served" under single-gateway mode when the gateway is running a DIFFERENT profile — the fix for W3 audit item 1', async () => {
    // This hook used to answer 'served' unconditionally in single mode
    // because the serving profile was unavailable to it. `servingProfile`
    // (forwarded by /api/gateway-status) closes that gap.
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: {
          mode: 'single',
          servedProfiles: null,
          servingProfile: 'hermes-switch',
          sessionCounts: {},
        },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('neo'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.reachability).toBe('not-served'))
    expect(result.current.servingProfile).toBe('hermes-switch')
  })

  it('fails closed to "unknown" in single mode when servingProfile is absent', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'single', servedProfiles: null, sessionCounts: {} },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('neo'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.mode).toBe('single'))
    expect(result.current.reachability).toBe('unknown')
  })

  it('fails closed to "unknown" when the gateway-status scope.mode itself is "unknown" (remote-gated or probe-failed topology)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'unknown', servedProfiles: null, sessionCounts: {} },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('neo'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.mode).toBe('unknown'))
    expect(result.current.reachability).toBe('unknown')
    expect(result.current.servingProfile).toBeNull()
  })

  it('fails closed to "unknown" — never "served" — when the probe errors', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, false))
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('neo'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.reachability).toBe('unknown'))
  })

  it('fails closed to "unknown" while the first fetch is still in flight', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus('neo'), {
      wrapper: Wrapper,
    })
    expect(result.current.reachability).toBe('unknown')
  })

  it('returns "served" for a falsy profile name without making an assertion about the gateway', () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'multiplex', servedProfiles: [], sessionCounts: {} },
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProfileScopeStatus(undefined), {
      wrapper: Wrapper,
    })
    expect(result.current.reachability).toBe('served')
  })

  it('dedupes across many simultaneous observers — one fetch, not N (the 96-card requirement)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'multiplex', servedProfiles: ['neo'], sessionCounts: {} },
      }),
    )
    const { Wrapper } = createWrapper()
    const names = Array.from({ length: 96 }, (_, i) => `profile-${i}`)

    // One `renderHook` per name = one independent component instance per
    // "card", all sharing the same `QueryClient` via the closed-over
    // `Wrapper` — this is the real shape of 96 `ProfileCard`s each calling
    // the hook once, not one component looping the hook 96 times.
    const rendered = names.map((name) =>
      renderHook(() => useProfileScopeStatus(name), { wrapper: Wrapper }),
    )

    await waitFor(() => {
      for (const { result } of rendered) {
        expect(result.current.reachability).not.toBe('unknown')
      }
    })

    // 96 observers on the same key still resolve to exactly one network call.
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
