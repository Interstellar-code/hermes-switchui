// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarListV2 } from './sidebar-list-v2'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRouterState: () => '/',
}))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}))

describe('SidebarListV2 attention actions', () => {
  it('only highlights updates and enables mark read when updates are pending', () => {
    const { rerender } = render(<SidebarListV2 groups={[]} />)
    const updates = screen.getByRole('button', { name: 'Show unread updates' })
    const markRead = screen.getByRole('button', { name: 'Mark all updates as read' })

    expect(updates.classList.contains('attention-pulse')).toBe(false)
    expect(markRead.hasAttribute('disabled')).toBe(true)

    rerender(<SidebarListV2 groups={[]} hasPendingUpdates />)

    expect(updates.classList.contains('attention-pulse')).toBe(true)
    expect(markRead.hasAttribute('disabled')).toBe(false)
  })
})

describe('SidebarListV2 load more', () => {
  it('shows loaded of total and calls onLoadMore; absent when not passed', () => {
    const onLoadMore = vi.fn()
    const { rerender } = render(
      <SidebarListV2
        groups={[]}
        loadMore={{ loaded: 200, total: 853, loading: false, onLoadMore }}
      />,
    )
    expect(screen.getByText('Loaded 200 of 853')).toBeTruthy()
    screen.getByRole('button', { name: 'Load more' }).click()
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    rerender(
      <SidebarListV2
        groups={[]}
        loadMore={{ loaded: 200, total: 853, loading: true, onLoadMore }}
      />,
    )
    const busy = screen.getByRole('button', { name: 'Loading…' })
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    busy.click()
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    rerender(<SidebarListV2 groups={[]} />)
    expect(screen.queryByTestId('sessions-load-more')).toBeNull()
  })
})
