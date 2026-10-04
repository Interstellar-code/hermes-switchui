// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarListV2, isGroupCollapsed } from './sidebar-list-v2'
import type { SessionGroup } from '@/screens/chat/apply-filters-and-decorate'
import type { SessionFeedItem } from '@/screens/chat/sessions-feed-types'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'

const { deleteSessions, navigate, toast } = vi.hoisted(() => ({
  deleteSessions: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRouterState: () => '/',
  useNavigate: () => navigate,
}))
// Render every row: the real virtualizer measures DOM, which jsdom lacks.
vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 10,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 10,
        key: index,
      })),
    measure: vi.fn(),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}))
// Card internals are covered elsewhere; a plain link keeps this about the list.
vi.mock('./sidebar-card-v2', () => ({
  SidebarCardV2: ({ item }: { item: SessionFeedItem }) => (
    <a href={`/chat/${item.id}`} data-testid={`card-${item.id}`}>
      {item.title}
    </a>
  ),
}))
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => null,
}))
vi.mock('@/lib/projects-api', () => ({
  useSessionProjectMap: () => ({ data: undefined }),
  useBulkMoveSessions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateProject: () => ({}),
  useProjects: () => ({ data: undefined }),
  useUpdateProject: () => ({}),
  useArchiveProject: () => ({}),
  useRestoreProject: () => ({}),
  useDeleteProject: () => ({}),
}))
vi.mock('@/screens/chat/hooks/use-delete-session', () => ({
  useBulkDeleteSessions: () => ({ deleteSessions, progress: null }),
}))
vi.mock('@/components/ui/toast', () => ({ toast }))
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function item(id: string, title = id): SessionFeedItem {
  return {
    id: `chat:${id}`,
    src: 'chat',
    title,
    sub: null,
    tokens: null,
    when: 1,
    day: 'today',
    live: false,
    state: 'idle',
    badges: [],
    pinned: false,
    starred: false,
    archived: false,
    sourceMeta: {},
  }
}

const projectGroups: Array<SessionGroup> = [
  {
    key: 'project:p1',
    label: 'Alpha',
    kind: 'project',
    color: '#ff0000',
    items: [item('a1'), item('a2')],
  },
  {
    key: 'project:p2',
    label: 'Old',
    kind: 'project',
    color: null,
    archived: true,
    items: [item('o1')],
  },
  { key: 'unfiled', label: 'Unfiled', kind: 'unfiled', items: [item('u1')] },
]

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const q = <T extends Element>(sel: string) => container.querySelector<T>(sel)
const mount = (groups: Array<SessionGroup>) =>
  act(() => root.render(<SidebarListV2 groups={groups} />))
const click = (el: Element, init: MouseEventInit = {}) =>
  act(() => {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
    )
  })

beforeEach(() => {
  window.localStorage.clear()
  useSessionsSelectionStore.getState().exit()
  deleteSessions.mockReset()
  toast.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarListV2 — project folders', () => {
  it('renders project headers with dot, count, archived suffix, and Unfiled last', () => {
    mount(projectGroups)
    const alpha = q('[data-testid="group-header-project:p1"]')!
    expect(alpha.textContent).toContain('Alpha')
    expect(alpha.textContent).toContain('2')
    expect(
      alpha.querySelector<HTMLElement>('[data-testid="folder-dot"]')!.style
        .background,
    ).toBe('rgb(255, 0, 0)')
    expect(q('[data-testid="group-header-project:p2"]')!.textContent).toContain(
      'Old · ARCHIVED',
    )
    const headers = [
      ...container.querySelectorAll('[data-testid^="group-header-"]'),
    ]
    expect(headers.at(-1)!.getAttribute('data-testid')).toBe(
      'group-header-unfiled',
    )
    expect(
      q('[data-testid="group-header-unfiled"] [data-testid="folder-dot"]'),
    ).toBeNull()
  })

  it('stripes cards in project sections with the project colour', () => {
    mount(projectGroups)
    const stripe = q<HTMLElement>(
      '[data-testid="card-row-chat:a1"] [data-testid="folder-stripe"]',
    )!
    expect(stripe.style.background).toBe('rgb(255, 0, 0)')
    expect(
      q('[data-testid="card-row-chat:u1"] [data-testid="folder-stripe"]'),
    ).toBeNull()
  })

  it('collapses by group key', () => {
    mount(projectGroups)
    click(q('[data-testid="group-header-project:p1"] button')!)
    expect(q('[data-testid="card-chat:a1"]')).toBeNull()
    expect(
      JSON.parse(
        window.localStorage.getItem('hermes.sessions.groups.collapsed')!,
      ),
    ).toEqual({ 'project:p1': true })
  })

  it('honours legacy label-keyed collapse state for day groups', () => {
    window.localStorage.setItem(
      'hermes.sessions.groups.collapsed',
      JSON.stringify({ Today: true }),
    )
    mount([
      { key: 'day:Today', label: 'Today', kind: 'day', items: [item('t1')] },
      {
        key: 'day:Yesterday',
        label: 'Yesterday',
        kind: 'day',
        items: [item('y1')],
      },
    ])
    expect(q('[data-testid="card-chat:t1"]')).toBeNull()
    expect(q('[data-testid="card-chat:y1"]')).not.toBeNull()
  })
})

describe('SidebarListV2 — folder header menu', () => {
  const rightClick = (el: Element) =>
    act(() => {
      el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )
    })

  it('opens on right-click and ⋯ for project headers only', () => {
    mount(projectGroups)
    rightClick(q('[data-testid="group-header-unfiled"]')!)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    rightClick(q('[data-testid="group-header-project:p1"]')!)
    expect(
      document.querySelector('[role="menu"][aria-label="Folder Alpha"]'),
    ).not.toBeNull()
    expect(
      q('[data-testid="group-header-unfiled"] [aria-label^="Folder actions"]'),
    ).toBeNull()
    expect(q('button[aria-label="Folder actions for Alpha"]')).not.toBeNull()
  })
})

describe('isGroupCollapsed', () => {
  it('prefers the new key, falls back to the legacy label only for day/pinned', () => {
    const day = { key: 'day:Today', label: 'Today', kind: 'day' as const }
    expect(isGroupCollapsed({ Today: true }, day)).toBe(true)
    expect(isGroupCollapsed({ Today: true, 'day:Today': false }, day)).toBe(
      false,
    )
    const proj = { key: 'project:x', label: 'Today', kind: 'project' as const }
    expect(isGroupCollapsed({ Today: true }, proj)).toBe(false)
  })
})

describe('SidebarListV2 — select mode + bulk delete', () => {
  it('clicks toggle selection instead of navigating; header selects group; shift ranges', () => {
    mount(projectGroups)
    act(() => useSessionsSelectionStore.getState().enter())
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      q('[data-testid="card-chat:a1"]')!.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    expect(useSessionsSelectionStore.getState().selected).toEqual({
      'chat:a1': true,
    })
    // shift-click ranges over the visible order a1..o1
    click(q('[data-testid="card-chat:o1"]')!, { shiftKey: true })
    expect(Object.keys(useSessionsSelectionStore.getState().selected)).toEqual([
      'chat:a1',
      'chat:a2',
      'chat:o1',
    ])
    // header checkbox selects the whole Unfiled group
    click(q('input[aria-label="Select all in Unfiled"]')!)
    expect(useSessionsSelectionStore.getState().selected['chat:u1']).toBe(true)
    expect(q('[data-testid="sidebar-bulk-actions"]')!.textContent).toContain(
      '4 SELECTED',
    )
    // bulk bar replaces the UPDATES row
    expect(q('button[aria-label="Show unread updates"]')).toBeNull()
  })

  it('shift-click enters select mode outside it', () => {
    mount(projectGroups)
    click(q('[data-testid="card-chat:a2"]')!, { shiftKey: true })
    const s = useSessionsSelectionStore.getState()
    expect(s.active).toBe(true)
    expect(s.selected).toEqual({ 'chat:a2': true })
  })

  it('cmd/ctrl-click outside select mode is left to the browser', () => {
    mount(projectGroups)
    click(q('[data-testid="card-chat:a2"]')!, { metaKey: true })
    click(q('[data-testid="card-chat:a2"]')!, { ctrlKey: true })
    expect(useSessionsSelectionStore.getState().active).toBe(false)
  })

  it('Esc with the delete dialog open closes only the dialog', () => {
    mount(projectGroups)
    act(() => useSessionsSelectionStore.getState().setMany(['chat:a1'], true))
    click(
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'DELETE',
      )!,
    )
    expect(document.activeElement?.textContent).toBe('Cancel')
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useSessionsSelectionStore.getState().active).toBe(true)
  })

  it('Esc exits select mode', () => {
    mount(projectGroups)
    act(() => useSessionsSelectionStore.getState().setMany(['chat:a1'], true))
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(useSessionsSelectionStore.getState().active).toBe(false)
  })

  it('confirms with the exact count, then deletes the raw ids', async () => {
    deleteSessions.mockResolvedValue(['a2'])
    mount(projectGroups)
    act(() =>
      useSessionsSelectionStore
        .getState()
        .setMany(['chat:a1', 'chat:a2'], true),
    )
    const del = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'DELETE',
    )!
    click(del)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(
      'This permanently deletes 2 sessions and their messages.',
    )
    expect(deleteSessions).not.toHaveBeenCalled()
    const confirm = [...dialog.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete 2',
    )!
    await act(async () => confirm.click())
    expect(deleteSessions).toHaveBeenCalledWith(['a1', 'a2'], null)
    expect(toast).toHaveBeenCalledWith('Deleted 1 of 2; 1 failed', {
      type: 'warning',
    })
    expect(useSessionsSelectionStore.getState().active).toBe(false)
  })

  it('cancelling the confirm deletes nothing', () => {
    mount(projectGroups)
    act(() => useSessionsSelectionStore.getState().setMany(['chat:a1'], true))
    click(
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'DELETE',
      )!,
    )
    const cancel = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find((b) => b.textContent === 'Cancel')!
    click(cancel)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(deleteSessions).not.toHaveBeenCalled()
  })
})

describe('SidebarListV2 — folder server counts', () => {
  const countOf = (key: string) =>
    q<HTMLElement>(
      `[data-testid="group-header-${key}"] [data-testid="group-count"]`,
    )!

  it('shows "loaded / total" only when the server knows more than is loaded', () => {
    mount([
      { ...projectGroups[0], total: 41 },
      { ...projectGroups[1], total: 1 },
      projectGroups[2],
    ])
    const alpha = countOf('project:p1')
    expect(alpha.querySelector('[aria-hidden]')!.textContent).toBe('2 / 41')
    expect(alpha.querySelector('.sr-only')!.textContent).toBe('2 of 41 loaded')
    expect(alpha.getAttribute('title')).toBe('2 of 41 loaded')
    expect(countOf('project:p2').textContent).toBe('1')
    expect(countOf('project:p2').querySelector('.sr-only')).toBeNull()
    expect(countOf('unfiled').textContent).toBe('1')
  })

  it('an empty folder with a server total shows 0 / N and a Load button that pages more', () => {
    const onLoadMore = vi.fn()
    act(() =>
      root.render(
        <SidebarListV2
          groups={[{ ...projectGroups[0], items: [], total: 5 }]}
          loadMore={{ loaded: 50, total: 309, loading: false, onLoadMore }}
        />,
      ),
    )
    expect(countOf('project:p1').textContent).toContain('0 / 5')
    const load = q<HTMLButtonElement>(
      '[aria-label="Load older sessions (all folders)"]',
    )!
    expect(load.textContent).toBe('Load older')
    click(load)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    // Stays mounted while loading, busy and inert.
    act(() =>
      root.render(
        <SidebarListV2
          groups={[{ ...projectGroups[0], items: [], total: 5 }]}
          loadMore={{ loaded: 50, total: 309, loading: true, onLoadMore }}
        />,
      ),
    )
    const busy = q<HTMLButtonElement>(
      '[aria-label="Load older sessions (all folders)"]',
    )!
    expect(busy.getAttribute('aria-busy')).toBe('true')
    click(busy)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
