// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  addUnloadedSourceCounts,
  classifySessionSource,
  sessionWindowFilter,
  useSessionWindowPages,
  visibleSourceProgress,
} from './sessions-feed'
import {
  chatQueryKeys,
  removeSessionFromCache,
  updateSessionWindowPages,
} from './chat-queries'
import type { ReactNode } from 'react'
import type { SessionFeedItem, SessionSource } from './sessions-feed-types'

function item(id: string, src: SessionSource, serverSource: string) {
  return { id, src, sourceMeta: { serverSource } } as unknown as SessionFeedItem
}

describe('addUnloadedSourceCounts', () => {
  it('maps server totals to chips, keeping loaded rows exact', () => {
    // 2 api_server rows loaded: one chat, one task (heuristic overlay).
    const items = [
      item('chat:a', 'chat', 'api_server'),
      item('chat:b', 'task', 'api_server'),
      item('chat:c', 'tg', 'telegram'),
    ]
    const counts = addUnloadedSourceCounts({ chat: 1, task: 1, tg: 1 }, items, {
      total: 20,
      bySource: { api_server: 5, telegram: 1, cli: 10, a2a_fleet: 0 },
    })
    // api_server: 3 unloaded -> chat. cli 10 -> cli. 4 rows of unlisted
    // sources (20 - 16) -> chat. Zero totals add nothing.
    expect(counts).toEqual({ chat: 8, task: 1, tg: 1, cli: 10 })
  })

  it('counts every loaded row, so archived ones still reduce the remainder', () => {
    // Loaded cli row is locally archived: absent from the filtered counts.
    const counts = addUnloadedSourceCounts({}, [item('chat:x', 'cli', 'cli')], {
      total: 3,
      bySource: { cli: 3 },
    })
    expect(counts).toEqual({ cli: 2 })
  })

  it('returns loaded counts untouched without server totals', () => {
    expect(addUnloadedSourceCounts({ tg: 2 }, [], null)).toEqual({ tg: 2 })
  })
})

describe('visibleSourceProgress', () => {
  const totals = {
    total: 30,
    bySource: { api_server: 10, cli: 15, telegram: 3 },
  }
  const items = [
    item('chat:a', 'api', 'api_server'),
    item('chat:c', 'cli', 'cli'),
    item('chat:l', 'chat', 'local'),
  ]

  it('counts a server source while any of its chips is visible', () => {
    // CHAT hidden, API still visible -> api_server (and other) stay in play.
    expect(visibleSourceProgress(items, totals, ['chat', 'tg'])).toEqual({
      loaded: 3,
      total: 27,
    })
  })

  it('drops a server source once every chip it maps to is hidden', () => {
    expect(
      visibleSourceProgress(items, totals, ['chat', 'api', 'task', 'tg']),
    ).toEqual({ loaded: 1, total: 15 })
  })
})

describe('kanban / unlisted sources', () => {
  it('classify into the CHAT chip (task only via the title heuristic)', () => {
    expect(classifySessionSource('kanban', 'k1', false)).toBe('chat')
    expect(classifySessionSource('local', 'l1', false)).toBe('chat')
    expect(classifySessionSource('webhook', 'w1', false)).toBe('chat')
    expect(classifySessionSource('kanban', 'k1', true)).toBe('task')
  })
})

describe('sessionWindowFilter', () => {
  it('an unfiltered window also skips the page the base windows cover', () => {
    expect(sessionWindowFilter(['chat'])).toEqual({
      filter: {},
      filterKey: '',
      startOffset: 200,
    })
  })

  it('nothing hidden continues the non-cron window after page one', () => {
    expect(sessionWindowFilter([])).toEqual({
      filter: { exclude_sources: 'cron' },
      filterKey: 'exclude_sources=cron',
      startOffset: 200,
    })
  })

  it('excludes only sources whose chips are all hidden', () => {
    const { filter, startOffset } = sessionWindowFilter([
      'tg',
      'cron',
      'chat',
      'api',
      'task',
      'a2a',
      'recovered',
    ])
    expect(filter.exclude_sources.split(',').sort()).toEqual([
      'a2a_fleet',
      'api_server',
      'cron',
      'kanban',
      'recovered',
      'telegram',
    ])
    expect(startOffset).toBe(0)
  })
})

function session(key: string, source: string) {
  return { key, friendlyId: key, source, updatedAt: 1 }
}

function stubPages(pages: Array<Array<ReturnType<typeof session>>>) {
  const fetchMock = vi.fn(async (url: string) => {
    const offset = Number(new URL(url, 'http://x').searchParams.get('offset'))
    const page = pages[Math.floor(offset / 200) - 1] ?? []
    return { ok: true, json: async () => ({ sessions: page }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return { queryClient, wrapper }
}

const fullPage = Array.from({ length: 200 }, (_, i) => session(`s${i}`, 'cli'))

describe('useSessionWindowPages', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads nothing until asked, then pages from offset 200 and stops at a short page', async () => {
    const fetchMock = stubPages([fullPage, [session('last', 'cli')]])
    const { wrapper } = setup()
    const { result } = renderHook(
      () => useSessionWindowPages('work', [], false),
      { wrapper },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(200))
    const first = new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams
    expect(first.get('offset')).toBe('200')
    expect(first.get('exclude_sources')).toBe('cron')
    expect(first.get('profile')).toBe('work')
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(201))
    expect(
      new URL(fetchMock.mock.calls[1][0], 'http://x').searchParams.get(
        'offset',
      ),
    ).toBe('400')
    expect(result.current.hasMore).toBe(false)
  })

  it('auto-loads a narrowed window from offset 0', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessions: [session('c1', 'cli')] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = setup()
    const { result } = renderHook(
      () =>
        useSessionWindowPages(
          'work',
          ['tg', 'cron', 'chat', 'api', 'task', 'a2a', 'recovered'],
          true,
        ),
      { wrapper },
    )
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    const params = new URL(
      (fetchMock.mock.calls[0] as unknown as [string])[0],
      'http://x',
    ).searchParams
    expect(params.get('offset')).toBe('0')
    expect(params.get('exclude_sources')).not.toContain('cli')
    expect(result.current.items[0].src).toBe('cli')
  })

  it('a rename reaches rows that live only in the extra pages', async () => {
    stubPages([[session('old', 'cli')]])
    const { wrapper, queryClient } = setup()
    const { result } = renderHook(
      () => useSessionWindowPages(null, [], false),
      { wrapper },
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() =>
      updateSessionWindowPages(queryClient, (rows) =>
        rows.map((row) => ({ ...row, title: 'Renamed' })),
      ),
    )
    await waitFor(() => expect(result.current.items[0].title).toBe('Renamed'))
  })

  it('a deleted session disappears from the extra pages', async () => {
    stubPages([[session('gone', 'cli'), session('kept', 'cli')]])
    const { wrapper, queryClient } = setup()
    const { result } = renderHook(
      () => useSessionWindowPages(null, [], false),
      { wrapper },
    )
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    act(() => removeSessionFromCache(queryClient, 'gone', 'gone'))
    await waitFor(() =>
      expect(result.current.items.map((i) => i.id)).toEqual(['chat:kept']),
    )
    expect(
      queryClient.getQueryData(
        chatQueryKeys.sessionWindow('active', 'exclude_sources=cron'),
      ),
    ).toEqual(
      expect.objectContaining({
        pages: [[expect.objectContaining({ key: 'kept' })]],
      }),
    )
  })
})
