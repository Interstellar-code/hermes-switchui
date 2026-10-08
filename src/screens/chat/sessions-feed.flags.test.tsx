// @vitest-environment jsdom
/**
 * Backend archive/pin flags in the sidebar feed. Only `fetch` (the network
 * edge) is stubbed; the hooks, query cache and local overlay store are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react'
import {
  archivedSessionsKey,
  chatFeedListKey,
  invalidateSessionLists,
  useArchivedSessionPages,
  useChatSessionsFeed,
  useUpdateSessionFlags,
} from './sessions-feed'
import { useChatSessions } from './hooks/use-chat-sessions'
import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/toast'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'

type Row = Record<string, unknown>

let listRows: Array<Row> = []
let patchStatus = 200
const urls: Array<string> = []
const patchBodies: Array<Row> = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function respond(input: unknown, init?: RequestInit): Response {
  const url = String(input)
  urls.push(url)
  if (init?.method === 'PATCH') {
    patchBodies.push(JSON.parse(String(init.body)))
    return patchStatus === 200
      ? json({ ok: true })
      : json({ ok: false, error: 'boom' }, patchStatus)
  }
  if (url.startsWith('/api/connection-status'))
    return json({ capabilities: { sessions: true } })
  if (url.startsWith('/api/sessions')) {
    const archivedOnly = url.includes('archived=only')
    return json({
      sessions: listRows.filter(
        (row) => Boolean(row.archived) === archivedOnly,
      ),
    })
  }
  return json({})
}

beforeEach(() => {
  listRows = []
  patchStatus = 200
  urls.length = 0
  patchBodies.length = 0
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) =>
    Promise.resolve(respond(input, init)),
  )
  useSessionsLocalStore.setState({
    archived: [],
    pinned: [],
    starred: [],
    backendFlagsMigrated: true,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

const row = (key: string, extra: Row = {}): Row => ({
  key,
  friendlyId: key,
  title: key,
  updatedAt: Date.now(),
  ...extra,
})

describe('sidebar feed flags', () => {
  it('maps backend pinned (0/1) onto feed items', async () => {
    listRows = [row('p1', { pinned: 1 }), row('n1', { pinned: 0 })]
    const { wrapper } = setup()
    const { result } = renderHook(() => useChatSessionsFeed(true), { wrapper })

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    const byKey = new Map(result.current.items.map((i) => [i.id, i]))
    expect(byKey.get('chat:p1')?.pinned).toBe(true)
    expect(byKey.get('chat:n1')?.pinned).toBe(false)
  })

  it('keeps pins when useChatSessions shares the QueryClient and lists refetch', async () => {
    listRows = [row('s1', { pinned: 1 })]
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(
      () => ({
        feed: useChatSessionsFeed(true),
        chat: useChatSessions({ activeFriendlyId: 'new', isNewChat: true }),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.feed.items).toHaveLength(1))
    expect(result.current.feed.items[0].pinned).toBe(true)

    const before = urls.length
    act(() => invalidateSessionLists(queryClient))
    await waitFor(() => expect(urls.length).toBeGreaterThan(before))
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))

    expect(result.current.feed.items[0].pinned).toBe(true)
    expect(queryClient.getQueryData(chatFeedListKey())).toBeDefined()
  })
})

describe('Archived view pages', () => {
  it('fetch archived=only and list those rows as archived', async () => {
    listRows = [row('live-1'), row('arch-1', { archived: 1, pinned: 1 })]
    const { wrapper } = setup()
    const { result } = renderHook(() => useArchivedSessionPages(null, true), {
      wrapper,
    })

    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(urls.some((u) => u.includes('archived=only'))).toBe(true)
    const [item] = result.current.items
    expect(item.id).toBe('chat:arch-1')
    expect(item.state).toBe('archived')
    expect(item.archived).toBe(true)
    expect(item.pinned).toBe(true)
  })

  it('stays idle until the Archived view is on', async () => {
    const { queryClient, wrapper } = setup()
    renderHook(() => useArchivedSessionPages(null, false), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(urls.some((u) => u.includes('archived=only'))).toBe(false)
    expect(queryClient.getQueryData(archivedSessionsKey(null))).toBeUndefined()
  })
})

describe('useUpdateSessionFlags', () => {
  it('rolls back the cache and the overlay mark, and toasts, when the PATCH fails', async () => {
    patchStatus = 500
    useSessionsLocalStore.setState({ archived: ['chat:s1'] })
    const { queryClient, wrapper } = setup()
    render(<Toaster />)
    queryClient.setQueryData(chatFeedListKey(), [row('s1', { archived: true })])
    const { result } = renderHook(() => useUpdateSessionFlags(), { wrapper })

    await act(async () => {
      await result.current
        .updateSessionFlagsAsync({ sessionKey: 's1', archived: false })
        .catch(() => {})
    })

    const rows = queryClient.getQueryData<Array<Row>>(chatFeedListKey())
    expect(rows?.[0].archived).toBe(true)
    expect(useSessionsLocalStore.getState().archived).toEqual(['chat:s1'])
    await waitFor(() =>
      expect(document.body.textContent).toContain("Couldn't update session"),
    )
  })

  it('flips the cached row optimistically and clears the overlay on success', async () => {
    useSessionsLocalStore.setState({ pinned: ['chat:s1'] })
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(chatFeedListKey(), [row('s1', { pinned: true })])
    const { result } = renderHook(() => useUpdateSessionFlags(), { wrapper })

    await act(() =>
      result.current.updateSessionFlagsAsync({
        sessionKey: 's1',
        pinned: false,
      }),
    )

    expect(patchBodies).toEqual([{ sessionKey: 's1', pinned: false }])
    expect(useSessionsLocalStore.getState().pinned).toEqual([])
  })
})
