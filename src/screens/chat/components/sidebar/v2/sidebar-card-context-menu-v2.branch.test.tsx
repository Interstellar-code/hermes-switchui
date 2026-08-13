// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarCardContextMenuV2 } from './sidebar-card-context-menu-v2'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'

/**
 * "Branch" exposes the gateway's session fork, which was reachable only from
 * tests until now. Two things it must not get wrong: it has to confirm first
 * (the source session is closed as `end_reason: "branched"`, which "Branch"
 * does not imply on its own), and it has to navigate to the CHILD, not stay on
 * the session that was just closed.
 */

const navigate = vi.hoisted(() => vi.fn())
const forkSession = vi.hoisted(() => vi.fn(async () => 'fork-key'))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouterState: () => '/chat/session-1',
}))

vi.mock('@/screens/chat/hooks/use-fork-session', () => ({
  useForkSession: () => ({ forkSession, forking: false, error: null }),
}))

vi.mock('@/screens/chat/hooks/use-delete-session', () => ({
  useDeleteSession: () => ({
    deleteSession: vi.fn(),
    deleting: false,
    error: null,
  }),
}))

vi.mock('@/screens/chat/hooks/use-rename-session', () => ({
  useRenameSession: () => ({
    renameSession: vi.fn(),
    renaming: false,
    error: null,
  }),
}))

vi.mock('@/stores/sessions-local-store', () => ({
  useSessionsLocalStore: (selector: (s: unknown) => unknown) =>
    selector({
      pinned: [],
      starred: [],
      archived: [],
      togglePinned: vi.fn(),
      toggleStarred: vi.fn(),
      toggleArchived: vi.fn(),
    }),
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

function open(item: SessionFeedItem = makeItem()) {
  return render(
    <SidebarCardContextMenuV2
      item={item}
      position={{ x: 10, y: 10 }}
      onClose={vi.fn()}
    />,
  )
}

beforeEach(() => {
  navigate.mockClear()
  forkSession.mockClear()
  forkSession.mockResolvedValue('fork-key')
})

afterEach(cleanup)

describe('SidebarCardContextMenuV2 — Branch', () => {
  it('offers Branch alongside Rename and Delete for chat-backed sessions', () => {
    open()
    expect(screen.getByRole('menuitem', { name: /Branch/ })).toBeTruthy()
  })

  it('hides Branch for items with no gateway session behind them', () => {
    open(makeItem({ id: 'file:x', src: 'file' as SessionFeedItem['src'] }))
    expect(screen.queryByRole('menuitem', { name: /Branch/ })).toBeNull()
  })

  it('confirms before forking, and says the original is closed', () => {
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Branch/ }))

    expect(screen.getByText(/marked closed/)).toBeTruthy()
    expect(forkSession).not.toHaveBeenCalled()
  })

  it('forks the raw session id and navigates to the new branch', async () => {
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Branch/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }))

    // 'chat:session-1' -> 'session-1'; the namespace prefix is a UI concern.
    await waitFor(() => expect(forkSession).toHaveBeenCalledWith('session-1'))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/chat/$sessionKey',
        params: { sessionKey: 'fork-key' },
      }),
    )
  })

  it('stays put when the fork fails', async () => {
    forkSession.mockRejectedValue(new Error('gateway said no'))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Branch/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }))

    await waitFor(() => expect(forkSession).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
  })
})
