// @vitest-environment jsdom
/**
 * The write lock has to hold below the UI, not only in it: `MemoryPicker`
 * withholds the button while locked, and this proves the hook refuses too, so
 * a future caller that forgets the gate still cannot rewrite someone's
 * config.yaml. Plus the two things the happy path owes the rest of the app —
 * the restart store gets marked, and a dashboard that is not running degrades
 * to "couldn't check" rather than to an error.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useOnboardingMemory } from './use-onboarding-memory'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'

const CONFIG_BODY = {
  config: { memory: { memory_enabled: true, provider: 'matrix-memory' } },
  providers: [],
  activeProvider: 'manifest',
}

const GATEWAY_BODY = {
  active: 'matrix-memory',
  providers: [
    { name: 'matrix-memory', status: 'ready' },
    { name: 'mem0', status: 'needs_config' },
  ],
}

const STATS_BODY = {
  db: { exists: true },
  counts: { working: 67, episodic: 3, triples: 0, fts: 0, total: 70 },
}

type FetchMock = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response)
}

function installFetchMock(overrides?: {
  gateway?: () => Promise<Response>
  stats?: () => Promise<Response>
  patch?: () => Promise<Response>
}) {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = String(input)
    if (url.startsWith('/api/dashboard-proxy/api/memory')) {
      return overrides?.gateway?.() ?? jsonResponse(GATEWAY_BODY)
    }
    if (url.startsWith('/api/memory/stats')) {
      return overrides?.stats?.() ?? jsonResponse(STATS_BODY)
    }
    if (url.startsWith('/api/claude-config')) {
      if (init?.method === 'PATCH') {
        return overrides?.patch?.() ?? jsonResponse({ ok: true })
      }
      return jsonResponse(CONFIG_BODY)
    }
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

describe('useOnboardingMemory', () => {
  beforeEach(() => {
    useGatewayRestartStore.getState().dismiss()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useGatewayRestartStore.getState().dismiss()
  })

  it('issues no request at all while the run is locked', async () => {
    const fetchMock = installFetchMock()
    const { result } = renderHook(
      () => useOnboardingMemory({ enabled: true, canWrite: false }),
      { wrapper },
    )
    await waitFor(() =>
      expect(result.current.activeProvider).toBe('matrix-memory'),
    )
    fetchMock.mockClear()

    await act(async () => {
      await result.current.select('mem0')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.touched).toBe(false)
    expect(result.current.needsRestart).toBe(false)
    expect(useGatewayRestartStore.getState().needsRestart).toBe(false)
  })

  it('writes the provider, marks the restart store, and reports the restart', async () => {
    const fetchMock = installFetchMock()
    const { result } = renderHook(
      () => useOnboardingMemory({ enabled: true, canWrite: true }),
      { wrapper },
    )
    await waitFor(() =>
      expect(result.current.activeProvider).toBe('matrix-memory'),
    )

    await act(async () => {
      await result.current.select('mem0')
    })

    const patched = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    )
    expect(patched?.[0]).toBe('/api/claude-config')
    // The API's CSRF guard is a Content-Type check.
    expect(patched?.[1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
    })
    expect(patched?.[1]?.body).toBe(
      JSON.stringify({
        config: { memory: { memory_enabled: true, provider: 'mem0' } },
      }),
    )

    expect(result.current.touched).toBe(true)
    // `agent_init.py` reads memory.provider once, at startup.
    expect(result.current.needsRestart).toBe(true)
    expect(result.current.selecting).toBeNull()
    expect(useGatewayRestartStore.getState()).toMatchObject({
      needsRestart: true,
      profileName: 'mem0',
    })
  })

  it('reads the readiness verdict and the store size', async () => {
    installFetchMock()
    const { result } = renderHook(
      () => useOnboardingMemory({ enabled: true, canWrite: true }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.stats).not.toBeNull())

    expect(result.current.stats).toEqual({ exists: true, total: 70 })
    const matrix = result.current.choices.find(
      (choice) => choice.id === 'matrix-memory',
    )
    expect(matrix?.status).toBe('ready')
    expect(matrix?.isActive).toBe(true)
  })

  it('degrades a dead dashboard to "unknown" rather than to an error', async () => {
    installFetchMock({
      gateway: () => Promise.reject(new Error('ECONNREFUSED')),
      stats: () => jsonResponse({ error: 'nope' }, false),
    })
    const { result } = renderHook(
      () => useOnboardingMemory({ enabled: true, canWrite: true }),
      { wrapper },
    )
    await waitFor(() =>
      expect(result.current.choices.length).toBeGreaterThan(0),
    )

    expect(result.current.error).toBeNull()
    expect(
      result.current.choices.every((choice) => choice.status === 'unknown'),
    ).toBe(true)
    expect(result.current.stats).toBeNull()
  })

  it('surfaces a failed write as `error` rather than throwing', async () => {
    installFetchMock({
      patch: () => jsonResponse({ error: 'config is read-only' }, false),
    })
    const { result } = renderHook(
      () => useOnboardingMemory({ enabled: true, canWrite: true }),
      { wrapper },
    )
    await waitFor(() =>
      expect(result.current.activeProvider).toBe('matrix-memory'),
    )

    await act(async () => {
      await expect(result.current.select('mem0')).resolves.toBeUndefined()
    })

    expect(result.current.error).toBe('config is read-only')
    expect(result.current.touched).toBe(false)
    expect(useGatewayRestartStore.getState().needsRestart).toBe(false)
  })

  it('fetches nothing until the step is enabled', async () => {
    const fetchMock = installFetchMock()
    renderHook(() => useOnboardingMemory({ enabled: false, canWrite: true }), {
      wrapper,
    })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
