// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarCardV2 } from './sidebar-card-v2'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    onClick,
    'aria-busy': ariaBusy,
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href="#" onClick={onClick} aria-busy={ariaBusy}>
      {children}
    </a>
  ),
}))

vi.mock('./sidebar-card-context-menu-v2', () => ({
  SidebarCardContextMenuV2: () => null,
}))

function makeItem(overrides: Partial<SessionFeedItem> = {}): SessionFeedItem {
  return {
    id: 'chat:session-1',
    src: 'chat',
    title: 'Session',
    sub: null,
    tokens: null,
    when: Date.now(),
    day: 'today',
    live: false,
    state: 'idle',
    badges: [],
    pinned: false,
    starred: false,
    archived: false,
    sourceMeta: {},
    ...overrides,
  }
}

describe('SidebarCardV2 attention markers', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(cleanup)

  it('pulses an inactive live session', () => {
    render(<SidebarCardV2 item={makeItem({ live: true, state: 'live' })} />)

    expect(
      screen
        .getByTestId('session-live-chat:session-1')
        .classList.contains('session-attention-pulse'),
    ).toBe(true)
    expect(screen.queryByTestId('session-updated-chat:session-1')).toBeNull()
  })

  it('shows a steady marker for a completed unseen update', () => {
    render(<SidebarCardV2 item={makeItem({ hasUnseenUpdate: true })} />)

    expect(
      screen
        .getByTestId('session-updated-chat:session-1')
        .classList.contains('session-attention-pulse'),
    ).toBe(false)
    expect(screen.queryByTestId('session-live-chat:session-1')).toBeNull()
  })

  it('clears the marker when the session is opened', () => {
    const item = makeItem({ hasUnseenUpdate: true })
    const { rerender } = render(<SidebarCardV2 item={item} />)

    rerender(
      <SidebarCardV2 item={{ ...item, hasUnseenUpdate: false }} isActive />,
    )

    expect(screen.queryByTestId('session-updated-chat:session-1')).toBeNull()
  })

  it('shows immediate feedback while opening a session', () => {
    render(<SidebarCardV2 item={makeItem()} />)

    fireEvent.click(screen.getByText('Session'))

    expect(screen.getByText('Opening…')).toBeTruthy()
    expect(screen.getByRole('link').getAttribute('aria-busy')).toBe('true')
  })


  it('does not show opening feedback for the already active session', () => {
    render(<SidebarCardV2 item={makeItem()} isActive />)

    fireEvent.click(screen.getByText('Session'))

    expect(screen.queryByText('Opening…')).toBeNull()
    expect(screen.getByRole('link').getAttribute('aria-busy')).toBeNull()
  })
})
