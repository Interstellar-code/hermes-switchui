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
