// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

import { useSessionToolUsage } from './use-session-tool-usage'
import type { ReactNode } from 'react'

const fetchMock = vi.hoisted(() => vi.fn())

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

function render(sessionKey: string, enabled: boolean) {
  return renderHook(() => useSessionToolUsage({ sessionKey, enabled }), {
    wrapper,
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('useSessionToolUsage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        entries: [
          {
            callId: 'old-1',
            name: 'skill_view',
            args: { name: 'a' },
            isError: false,
          },
        ],
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('issues no request when the loaded history is not capped', async () => {
    const { result } = render('s1', false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.entries).toEqual([])
  })

  it('issues no request for the draft session key', async () => {
    render('new', true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the whole-session entries when the history is capped', async () => {
    const { result } = render('s1', true)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(result.current.entries[0].callId).toBe('old-1')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/sessions/s1/tool-usage')
    expect(result.current.error).toBeNull()
  })

  it('surfaces a route error message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: 'boom' }, 500))
    const { result } = render('s1', true)
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.entries).toEqual([])
  })
})
