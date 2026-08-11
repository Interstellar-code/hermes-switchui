// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useProfileServability } from './use-profile-servability'

const mockFetch = vi.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body, text: async () => JSON.stringify(body) }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    )
  }
}

describe('useProfileServability', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('issues no request while disabled, and returns null', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ scope: { mode: 'single' } }))
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: false,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    await Promise.resolve()
    expect(result.current).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null while the probe is still loading', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: true,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    expect(result.current).toBeNull()
  })

  it('warns when the gateway is single-mode and several profiles exist on disk', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'single', servingProfile: 'default', sessionCounts: {} },
      }),
    )
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: true,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current?.kind).toBe('unreachable'))
    if (result.current?.kind !== 'unreachable') throw new Error('expected unreachable')
    expect(result.current.unreachable).toEqual(['hermes-switch'])
  })

  it('stays quiet when only one profile exists on disk, even if not multiplexed', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'single', servingProfile: 'default', sessionCounts: {} },
      }),
    )
    const { result } = renderHook(
      () => useProfileServability({ enabled: true, diskProfiles: ['default'] }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current).toEqual({ kind: 'ok' }))
  })

  it('stays quiet under multiplex once every disk profile is served', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: {
          mode: 'multiplex',
          servedProfiles: ['default', 'hermes-switch'],
          sessionCounts: {},
        },
      }),
    )
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: true,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current).toEqual({ kind: 'ok' }))
  })

  it('warns under multiplex when a disk profile is missing from served_profiles', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: {
          mode: 'multiplex',
          servedProfiles: ['default'],
          sessionCounts: {},
        },
      }),
    )
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: true,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current?.kind).toBe('unreachable'))
    if (result.current?.kind !== 'unreachable') throw new Error('expected unreachable')
    expect(result.current.unreachable).toEqual(['hermes-switch'])
  })

  it('reports a non-committal indeterminate result when the topology probe fails, never "ok"', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false))
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: true,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current?.kind).toBe('indeterminate'))
    if (result.current?.kind !== 'indeterminate') throw new Error('expected indeterminate')
    expect(result.current.detail).not.toMatch(/misconfigur/i)
  })

  it('carries the unknown reason through from the scope payload', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        scope: { mode: 'unknown', reason: 'remote-gated', sessionCounts: {} },
      }),
    )
    const { result } = renderHook(
      () =>
        useProfileServability({
          enabled: true,
          diskProfiles: ['default', 'hermes-switch'],
        }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current?.kind).toBe('indeterminate'))
    if (result.current?.kind !== 'indeterminate') throw new Error('expected indeterminate')
    expect(result.current.detail).toContain('gated')
  })
})
