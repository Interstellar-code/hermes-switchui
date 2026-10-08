// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  resetBackendFlagsMigrationForTest,
  runBackendFlagsMigration,
} from './session-flags-migration'
import { useSessionsLocalStore } from './sessions-local-store'
import type { ReactNode } from 'react'
import { useUpdateSessionFlags } from '@/screens/chat/sessions-feed'

describe('runBackendFlagsMigration', () => {
  afterEach(() => resetBackendFlagsMigrationForTest())
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
    useSessionsLocalStore.setState({
      archived: ['chat:a1', 'chat:a2', 'chat:a3', 'task:t1'],
      pinned: ['chat:p1', 'chat:p2', 'cron:c1'],
      starred: ['chat:s1'],
      backendFlagsMigrated: false,
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('PATCHes chat: ids, removes success/404, keeps failures, ignores non-chat/starred, marks done', async () => {
    vi.mocked(global.fetch).mockImplementation(async (url, opts) => {
      const body = JSON.parse(opts?.body as string)
      if (body.sessionKey === 'a1') return new Response(null, { status: 200 })
      if (body.sessionKey === 'a2')
        return new Response(
          '{"ok":false,"code":"session_not_found","error":"Session not found"}',
          { status: 404 },
        )
      if (body.sessionKey === 'a3') return new Response(null, { status: 500 })
      if (body.sessionKey === 'p1') return new Response(null, { status: 200 })
      if (body.sessionKey === 'p2') return new Response(null, { status: 500 })
      return new Response(null, { status: 200 })
    })

    const res = await runBackendFlagsMigration()

    expect(res.migrated).toBe(2) // a1, p1
    expect(res.gone).toBe(1) // a2
    expect(res.failed).toBe(2) // a3, p2

    const state = useSessionsLocalStore.getState()
    // success and 404 removed, failure kept, non-chat kept
    expect(state.archived).toEqual(['chat:a3', 'task:t1'])
    expect(state.pinned).toEqual(['chat:p2', 'cron:c1'])
    expect(state.starred).toEqual(['chat:s1'])
    expect(state.backendFlagsMigrated).toBe(false) // failed ones keep it false
  })

  it('second run is a no-op if flag is true', async () => {
    useSessionsLocalStore.setState({ backendFlagsMigrated: true })
    const res = await runBackendFlagsMigration()
    expect(res.migrated).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('marks migrated true when there are no failures', async () => {
    vi.mocked(global.fetch).mockImplementation(
      async () => new Response(null, { status: 200 }),
    )
    await runBackendFlagsMigration()
    expect(useSessionsLocalStore.getState().backendFlagsMigrated).toBe(true)
  })

  it('a backend unarchive clears the overlay mark, so the migration never re-archives it', async () => {
    useSessionsLocalStore.setState({
      archived: ['chat:x'],
      pinned: [],
      backendFlagsMigrated: false,
    })
    const bodies: Array<Record<string, unknown>> = []
    vi.mocked(global.fetch).mockImplementation((_url, opts) => {
      if (opts?.method === 'PATCH') bodies.push(JSON.parse(String(opts.body)))
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, sessions: [] }), {
          status: 200,
        }),
      )
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useUpdateSessionFlags(), { wrapper })

    await act(() =>
      result.current.updateSessionFlagsAsync({
        sessionKey: 'x',
        archived: false,
      }),
    )
    await waitFor(() =>
      expect(useSessionsLocalStore.getState().archived).not.toContain('chat:x'),
    )
    bodies.length = 0

    await runBackendFlagsMigration()

    expect(
      bodies.filter((b) => b.sessionKey === 'x' && b.archived === true),
    ).toEqual([])
  })
})
