// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SidebarShellV2 } from './sidebar-shell-v2'

const { useSessionsFeed, applyFiltersAndDecorate } = vi.hoisted(() => ({
  useSessionsFeed: vi.fn(),
  applyFiltersAndDecorate: vi.fn(),
}))

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
      leftPanel: 'sessions',
      setLeftPanel: vi.fn(),
      sources: ['chat'],
      query: 'needle',
      dateRange: { from: null, to: null },
      sort: 'recent',
      updatesOnly: false,
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
  )
})
