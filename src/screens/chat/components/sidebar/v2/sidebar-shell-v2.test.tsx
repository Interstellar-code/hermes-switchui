// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SidebarShellV2 } from './sidebar-shell-v2'

const { useSessionsFeed, applyFiltersAndDecorate, useSessionProjectMap } =
  vi.hoisted(() => ({
    useSessionsFeed: vi.fn(),
    applyFiltersAndDecorate: vi.fn(),
    useSessionProjectMap: vi.fn(),
  }))
const folderMap = { version: 'v', projects: [], sessions: {} }

vi.mock('@/lib/projects-api', () => ({ useSessionProjectMap }))
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => 'work',
}))
vi.mock('./sidebar-folders-v2', () => ({ SidebarGroupToggleV2: () => null }))

vi.mock('@/screens/chat/sessions-feed', () => ({
  useSessionsFeed,
  useProfileSessionTotals: () => ({ totals: [], loading: false }),
}))
vi.mock('@/screens/chat/apply-filters-and-decorate', () => ({
  applyFiltersAndDecorate,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/',
}))
vi.mock('@/stores/sessions-filter-store', () => ({
  useSessionsFilterStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
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
    }),
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
vi.mock('./sidebar-header-v2', () => ({ SidebarHeaderV2: () => null }))
vi.mock('./sidebar-list-v2', () => ({ SidebarListV2: () => null }))
vi.mock('./sidebar-rail-v2', () => ({ SidebarRailV2: () => null }))
vi.mock('./sidebar-search-v2', () => ({ SidebarSearchV2: () => null }))
vi.mock('./sidebar-source-chips-v2', () => ({
  SidebarSourceChipsV2: () => null,
}))

beforeEach(() => {
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
    { groupBy: 'project', map: folderMap },
  )
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
