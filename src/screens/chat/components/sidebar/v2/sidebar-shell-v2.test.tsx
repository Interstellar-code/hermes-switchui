// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarShellV2 } from './sidebar-shell-v2'
import type * as SessionsFeedModule from '@/screens/chat/sessions-feed'

afterEach(() => cleanup())

const {
  useSessionsFeed,
  applyFiltersAndDecorate,
  useSessionProjectMap,
  useSessionSourceTotals,
  useSessionWindowPages,
  filterState,
  captured,
  folderLoad,
} = vi.hoisted(() => {
  const rec = (): Record<string, any> => ({})
  return {
    useSessionsFeed: vi.fn(),
    applyFiltersAndDecorate: vi.fn(),
    useSessionProjectMap: vi.fn(),
    useSessionSourceTotals: vi.fn(),
    useSessionWindowPages: vi.fn(),
    filterState: rec(),
    captured: { chips: rec(), list: rec() },
    folderLoad: vi.fn(),
  }
})
const folderMap = { version: 'v', projects: [], sessions: {} }

vi.mock('@/lib/projects-api', () => ({
  useSessionProjectMap,
  useProjects: () => ({ data: undefined }),
  useProjectGitStatus: () => ({ data: undefined }),
}))
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => 'work',
}))
vi.mock('./sidebar-folders-v2', () => ({ SidebarGroupToggleV2: () => null }))

vi.mock('@/screens/chat/sessions-feed', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionsFeedModule>()
  return {
    useSessionsFeed,
    useSessionSourceTotals,
    useSessionWindowPages,
    useFolderPages: () => ({
      items: [],
      loading: new Set(),
      exhausted: new Set(),
      load: folderLoad,
    }),
    addUnloadedSourceCounts: actual.addUnloadedSourceCounts,
    mergeSessionFeedItems: actual.mergeSessionFeedItems,
    visibleSourceProgress: actual.visibleSourceProgress,
    useProfileSessionTotals: () => ({ totals: [], loading: false }),
  }
})
vi.mock('@/screens/chat/apply-filters-and-decorate', () => ({
  applyFiltersAndDecorate,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/',
}))
vi.mock('@/stores/sessions-filter-store', () => ({
  useSessionsFilterStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) => selector(filterState),
}))
vi.mock('@/stores/sessions-local-store', () => ({
  useSessionsLocalStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
      pinned: [],
      starred: [],
      archived: [],
      lastSeenUpdate: {},
      seenUpdatesInitialized: false,
      initializeSeenUpdates: vi.fn(),
      markSessionSeen: vi.fn(),
      markSessionsSeen: vi.fn(),
    }),
  isSessionUpdateUnseen: vi.fn(() => false),
}))
vi.mock('@/stores/session-flags-migration', () => ({
  useBackendFlagsMigration: vi.fn(),
}))
vi.mock('./sidebar-header-v2', () => ({ SidebarHeaderV2: () => null }))
vi.mock('./sidebar-list-v2', () => ({
  SidebarListV2: (props: Record<string, unknown>) => {
    captured.list = props
    return null
  },
}))
vi.mock('./sidebar-rail-v2', () => ({ SidebarRailV2: () => null }))
vi.mock('./sidebar-search-v2', () => ({ SidebarSearchV2: () => null }))
vi.mock('./sidebar-source-chips-v2', () => ({
  SidebarSourceChipsV2: (props: Record<string, unknown>) => {
    captured.chips = props
    return null
  },
}))

const loadMoreFn = vi.fn()

beforeEach(() => {
  Object.assign(filterState, {
    collapsed: false,
    setCollapsed: vi.fn(),
    sidebarWidth: 480,
    setSidebarWidth: vi.fn(),
    leftPanel: 'sessions',
    setLeftPanel: vi.fn(),
    sources: ['chat'],
    query: 'needle',
    dateRange: { from: null, to: null },
    sort: 'recent',
    updatesOnly: false,
    groupBy: 'project',
  })
  useSessionSourceTotals.mockReturnValue(null)
  useSessionWindowPages.mockReturnValue({
    items: [],
    hasMore: true,
    loading: false,
    loadMore: loadMoreFn,
  })
  useSessionProjectMap.mockReturnValue({ data: folderMap })
  useSessionsFeed.mockReturnValue({
    items: [{ id: 'chat:a' }, { id: 'task:b' }],
    loading: false,
    sources: [],
  })
  applyFiltersAndDecorate.mockReturnValue({
    groups: [],
    totalCount: 0,
    sourceCounts: {},
  })
})

it('passes the raw merged feed to the filtering owner', () => {
  render(<SidebarShellV2 />)
  expect(useSessionsFeed).toHaveBeenCalledWith({ raw: true, query: 'needle' })
  expect(applyFiltersAndDecorate).toHaveBeenCalledWith(
    [{ id: 'chat:a' }, { id: 'task:b' }],
    expect.objectContaining({
      sources: ['chat'],
      query: 'needle',
      updatesOnly: false,
    }),
    {
      pinned: [],
      starred: [],
      archived: [],
      lastSeenUpdate: {},
      seenUpdatesInitialized: false,
    },
    { groupBy: 'project', map: folderMap, withTotals: false },
  )
})

it('folder totals only when nothing narrows the view (no search, no hidden chip)', () => {
  const grouping = () => applyFiltersAndDecorate.mock.calls.at(-1)?.[3]
  Object.assign(filterState, { query: '', sources: ['chat'] })
  render(<SidebarShellV2 />)
  expect(grouping()).toMatchObject({ withTotals: false })
  cleanup()
  Object.assign(filterState, { query: '', sources: [] })
  render(<SidebarShellV2 />)
  expect(grouping()).toMatchObject({ withTotals: true })
})

it('renders the panel at the persisted width with a resize separator', () => {
  const { container } = render(<SidebarShellV2 />)
  const panel = container.querySelector<HTMLElement>(
    '[data-testid="sessions-panel"]',
  )
  expect(panel?.style.width).toBe('480px')
  expect(
    container
      .querySelector('[role="separator"]')
      ?.getAttribute('aria-valuenow'),
  ).toBe('480')
})

it('fetches folders for the browsed profile only in project mode', () => {
  render(<SidebarShellV2 />)
  expect(useSessionProjectMap).toHaveBeenCalledWith('work', true)
})

function feedItem(id: string, src: string, serverSource: string) {
  return { id, src, when: 1, live: false, sourceMeta: { serverSource } }
}

describe('server source totals', () => {
  beforeEach(() => {
    Object.assign(filterState, { sources: [], query: '' })
    useSessionsFeed.mockReturnValue({
      items: [feedItem('chat:t1', 'tg', 'telegram')],
      loading: false,
      sources: [],
    })
    applyFiltersAndDecorate.mockReturnValue({
      groups: [],
      totalCount: 1,
      sourceCounts: { tg: 1 },
    })
    useSessionSourceTotals.mockReturnValue({
      total: 268,
      bySource: { telegram: 3, cli: 265 },
    })
  })

  it('chips show server totals when no filter narrows the count', () => {
    render(<SidebarShellV2 />)
    expect(captured.chips.sourceCounts).toEqual({ tg: 3, cli: 265 })
    expect(captured.list.loadMore).toEqual(
      expect.objectContaining({ loaded: 1, total: 268 }),
    )
  })

  it('chips fall back to loaded counts while a search is active', () => {
    filterState.query = 'needle'
    render(<SidebarShellV2 />)
    expect(captured.chips.sourceCounts).toEqual({ tg: 1 })
  })

  it('a narrowed selection with unloaded rows auto-loads its window', () => {
    filterState.sources = ['tg']
    render(<SidebarShellV2 />)
    expect(useSessionWindowPages).toHaveBeenLastCalledWith('work', ['tg'], true)
  })

  it('does not auto-load when nothing is hidden', () => {
    render(<SidebarShellV2 />)
    expect(useSessionWindowPages).toHaveBeenLastCalledWith('work', [], false)
  })

  it('merges window pages into the feed, base rows winning, deduped', () => {
    useSessionWindowPages.mockReturnValue({
      items: [
        { ...feedItem('chat:t1', 'tg', 'telegram'), title: 'stale' },
        feedItem('chat:c1', 'cli', 'cli'),
      ],
      hasMore: true,
      loading: false,
      loadMore: loadMoreFn,
    })
    render(<SidebarShellV2 />)
    const merged = applyFiltersAndDecorate.mock.lastCall?.[0] as Array<{
      id: string
      title?: string
    }>
    expect(merged.map((i) => i.id).sort()).toEqual(['chat:c1', 'chat:t1'])
    expect(merged.find((i) => i.id === 'chat:t1')?.title).toBeUndefined()
  })

  it('debounces source changes before re-keying the window', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<SidebarShellV2 />)
      filterState.sources = ['tg']
      rerender(<SidebarShellV2 />)
      expect(useSessionWindowPages).toHaveBeenLastCalledWith('work', [], false)
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(useSessionWindowPages).toHaveBeenLastCalledWith(
        'work',
        ['tg'],
        true,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('hiding CHAT keeps api_server rows in play for auto-load', () => {
    filterState.sources = ['chat']
    useSessionsFeed.mockReturnValue({
      items: [feedItem('chat:a', 'chat', 'api_server')],
      loading: false,
      sources: [],
    })
    useSessionSourceTotals.mockReturnValue({
      total: 5,
      bySource: { api_server: 5 },
    })
    render(<SidebarShellV2 />)
    expect(useSessionWindowPages).toHaveBeenLastCalledWith(
      'work',
      ['chat'],
      true,
    )
    expect(captured.list.loadMore).toEqual(
      expect.objectContaining({ loaded: 1, total: 5 }),
    )
  })

  it('hides Load more once everything visible is loaded', () => {
    useSessionSourceTotals.mockReturnValue({
      total: 1,
      bySource: { telegram: 1 },
    })
    render(<SidebarShellV2 />)
    expect(captured.list.loadMore).toBeUndefined()
  })
})

it('per-folder load asks for listable ids of that folder not yet loaded', () => {
  useSessionProjectMap.mockReturnValue({
    data: {
      version: 'v',
      projects: [{ id: 'p1', name: 'Alpha', board_slug: null }],
      // `seg` is a bound compression segment: filed, but not a listed row.
      sessions: { a: 'p1', seg: 'p1', tip: 'p1', other: 'p2' },
      listable: ['a', 'tip', 'other'],
    },
  })
  render(<SidebarShellV2 />)
  const folders = captured.list.folders as {
    onLoad: (projectId: string) => void
  }
  act(() => folders.onLoad('p1'))
  // `a` is loaded (feed item chat:a); `seg` is not listable; `other` is another folder.
  expect(folderLoad).toHaveBeenCalledWith('p1', ['tip'])
})

it('toggles the archived view state', () => {
  filterState.setState = vi.fn()
  const { getByTestId } = render(<SidebarShellV2 />)
  const toggle = getByTestId('archived-view-toggle')
  expect(toggle).toBeTruthy()
  fireEvent.click(toggle)
  expect(filterState.setState).toHaveBeenCalledWith('archived')
})
