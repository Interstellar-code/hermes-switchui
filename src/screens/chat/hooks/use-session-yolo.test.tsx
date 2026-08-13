// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchSessionYolo,
  isRealSessionKey,
  sessionYoloUrl,
  useSessionYolo,
} from './use-session-yolo'
import type { ReactNode } from 'react'
import { setSessionProfile } from '@/lib/session-scope'

/**
 * The bypass is process-resident in the gateway (`tools/approval._session_yolo`
 * is a plain module-level set) and deliberately not persisted, so a restart
 * clears it with no event. Every test here is about the same property: this
 * hook must never assert a state it did not just read.
 */

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function stub(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Wait for the hook's FIRST read to land, not merely to be issued.
 *
 * `waitFor(() => expect(fetch).toHaveBeenCalled())` resolves on the call, so a
 * test that then swaps the mock and writes can have the original read's
 * promise settle *after* the mutation's `setQueryData` and stomp it — a real
 * race, but a race in the test, not the hook. Awaiting the mock's own returned
 * promise removes it.
 */
async function settleFirstRead(fetchMock: ReturnType<typeof stub>) {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await act(async () => {
    await fetchMock.mock.results[0]?.value
  })
  await flush()
}

beforeEach(() => {
  setSessionProfile(null)
})

afterEach(() => {
  cleanup()
  setSessionProfile(null)
  vi.unstubAllGlobals()
})

describe('isRealSessionKey', () => {
  it.each([['new'], ['main'], [''], ['   ']])(
    'rejects the route sentinel %s — there is no gateway session to key on',
    (value) => {
      expect(isRealSessionKey(value)).toBe(false)
    },
  )

  it('accepts a real session id', () => {
    expect(isRealSessionKey('eeae0db1-e5a6-4c0d-9a48-73329bdc5ca6')).toBe(true)
  })
})

describe('sessionYoloUrl', () => {
  it('carries the profile and encodes the key', () => {
    expect(sessionYoloUrl('a/b', 'neo')).toBe(
      '/api/sessions/a%2Fb/yolo?profile=neo',
    )
  })
})

describe('fetchSessionYolo', () => {
  it('reads the gateway state', async () => {
    stub({ ok: true, enabled: true })
    await expect(fetchSessionYolo('sess-1', null)).resolves.toEqual({
      enabled: true,
      unsupported: false,
    })
  })

  it('surfaces `unsupported` for a gateway with no bypass endpoint', async () => {
    stub({ ok: true, enabled: false, unsupported: true })
    await expect(fetchSessionYolo('sess-1', null)).resolves.toEqual({
      enabled: false,
      unsupported: true,
    })
  })

  it('THROWS on a failed read rather than returning enabled:false', async () => {
    stub({ ok: false, error: 'gateway down' }, false, 502)
    await expect(fetchSessionYolo('sess-1', null)).rejects.toThrow(
      /gateway down/,
    )
  })
})

describe('useSessionYolo', () => {
  it('does not call the gateway for a route sentinel, and reports itself unavailable', async () => {
    const fetchMock = stub({ ok: true, enabled: false })
    const { result } = renderHook(() => useSessionYolo('new'), { wrapper })
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.available).toBe(false)
  })

  it('reports the read state', async () => {
    stub({ ok: true, enabled: true })
    const { result } = renderHook(() => useSessionYolo('sess-1'), { wrapper })

    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(result.current.unknown).toBe(false)
  })

  it('reports `unknown` — not off — when the read fails', async () => {
    stub({ ok: false, error: 'boom' }, false, 500)
    const { result } = renderHook(() => useSessionYolo('sess-1'), { wrapper })

    await waitFor(() => expect(result.current.unknown).toBe(true))
    expect(result.current.enabled).toBe(false)
  })

  it('writes an explicit value, never a toggle, and adopts the gateway echo', async () => {
    const fetchMock = stub({ ok: true, enabled: false })
    const { result } = renderHook(() => useSessionYolo('sess-1'), { wrapper })
    await settleFirstRead(fetchMock)

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, enabled: true, previous: false }),
      text: () => Promise.resolve(''),
    })
    await act(async () => {
      await result.current.setEnabled(true)
    })

    const write = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(write[0]).toBe('/api/sessions/sess-1/yolo')
    expect(write[1].method).toBe('POST')
    // Explicit — a toggle would race the state this UI read seconds ago.
    expect(JSON.parse(String(write[1].body))).toEqual({ enabled: true })
    expect(result.current.enabled).toBe(true)
  })

  it('carries the ambient profile into the write body', async () => {
    setSessionProfile('neo')
    const fetchMock = stub({ ok: true, enabled: false })
    const { result } = renderHook(() => useSessionYolo('sess-1'), { wrapper })
    await settleFirstRead(fetchMock)

    await act(async () => {
      await result.current.setEnabled(true)
    })

    const write = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(JSON.parse(String(write[1].body))).toMatchObject({ profile: 'neo' })
  })

  it('surfaces a failed write and re-reads instead of claiming the new state', async () => {
    const fetchMock = stub({ ok: true, enabled: false })
    const { result } = renderHook(() => useSessionYolo('sess-1'), { wrapper })
    await settleFirstRead(fetchMock)

    fetchMock.mockResolvedValue({
      ok: false,
      status: 501,
      json: () =>
        Promise.resolve({ ok: false, error: 'no bypass on this build' }),
      text: () =>
        Promise.resolve(JSON.stringify({ error: 'no bypass on this build' })),
    })
    await act(async () => {
      await result.current.setEnabled(true)
    })

    expect(result.current.error).toMatch(/no bypass on this build/)
    expect(result.current.enabled).toBe(false)
  })
})
