// @vitest-environment jsdom
/**
 * The Archived folder at the bottom of the sidebar list. Real component, real
 * QueryClient, real `useUpdateSessionFlags` — the only stub is `fetch`, the
 * network edge, plus the router's `Link`/`useRouterState` (a card navigates and
 * jsdom has no router). Everything the user can do here is exercised through
 * the components that will do it in the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { SidebarArchivedFolderV2 } from './sidebar-archived-folder-v2'
import type { ReactNode } from 'react'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/' } }),
}))

type Row = Record<string, unknown>

let rows: Array<Row> = []
const urls: Array<string> = []
const patchBodies: Array<Row> = []

const PAGE_SIZE = 200

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function archivedOf(url: string): boolean {
  return new URL(url, 'http://x').searchParams.get('archived') === 'only'
}

function page(url: string, all: Array<Row>): Array<Row> {
  const params = new URL(url, 'http://x').searchParams
  const offset = Number(params.get('offset') ?? 0)
  return all.slice(offset, offset + Number(params.get('limit') ?? PAGE_SIZE))
}

function respond(input: unknown, init?: RequestInit): Response {
  const url = String(input)
  urls.push(url)
  if (init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)) as Row
    patchBodies.push(body)
    const key = String(body.sessionKey ?? '')
    rows = rows.map((row) =>
      row.key === key ? { ...row, archived: body.archived ? 1 : 0 } : row,
    )
    return json({ ok: true })
  }
  if (url.startsWith('/api/sessions')) {
    const only = archivedOf(url)
    const live = rows.filter((row) => Boolean(row.archived) === only)
    return json({ sessions: only ? page(url, live) : live })
  }
  if (url.startsWith('/api/session-folders'))
    return json({ version: 'v', projects: [], sessions: {} })
  return json({})
}

beforeEach(() => {
  rows = []
  urls.length = 0
  patchBodies.length = 0
  window.localStorage.clear()
  useSessionsLocalStore.setState({
    archived: [],
    pinned: [],
    starred: [],
    backendFlagsMigrated: true,
  })
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) =>
    Promise.resolve(respond(input, init)),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderFolder() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarArchivedFolderV2 />
    </QueryClientProvider>,
  )
}

function toggle(): HTMLElement {
  return screen.getByTestId('archived-folder-toggle')
}

function expand(): void {
  fireEvent.click(toggle())
}

const settled = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
const archivedRequests = () => urls.filter(archivedOf)
const row = (key: string, extra: Row = {}): Row => ({
  key,
  friendlyId: key,
  title: key,
  updatedAt: Date.now(),
  ...extra,
})

describe('Archived folder', () => {
  it('starts collapsed and costs no archived=only request while closed', async () => {
    renderFolder()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('archived-folder')).toBeTruthy()
    expect(screen.queryByTestId('archived-folder-body')).toBeNull()

    await settled()
    expect(archivedRequests()).toHaveLength(0)
  })

  it('fetches archived=only and renders the rows once expanded', async () => {
    rows = [row('arch-1', { archived: 1 }), row('arch-2', { archived: 1 })]
    renderFolder()
    expand()

    await waitFor(() =>
      expect(screen.getByTestId('archived-row-chat:arch-2')).toBeTruthy(),
    )
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(archivedRequests().length).toBeGreaterThan(0)
    expect(screen.getByTestId('archived-folder-count').textContent).toBe('2')
  })

  it('asks for the next page on Load more', async () => {
    rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
      row(`arch-${i}`, { archived: 1 }),
    )
    renderFolder()
    expand()
    await waitFor(() =>
      expect(
        screen.getByTestId(`archived-row-chat:arch-${PAGE_SIZE - 1}`),
      ).toBeTruthy(),
    )
    expect(archivedRequests()[0]).toContain(`offset=0`)

    fireEvent.click(screen.getByTestId('archived-folder-load-more'))

    await waitFor(() =>
      expect(
        screen.getByTestId(`archived-row-chat:arch-${PAGE_SIZE}`),
      ).toBeTruthy(),
    )
    expect(
      archivedRequests().some((u) => u.includes(`offset=${PAGE_SIZE}`)),
    ).toBe(true)
    // A short last page ends the pager.
    expect(screen.queryByTestId('archived-folder-load-more')).toBeNull()
  })

  it('shows an empty state when nothing is archived', async () => {
    rows = [row('live-1')]
    renderFolder()
    expand()

    await waitFor(() =>
      expect(screen.getByTestId('archived-folder-empty').textContent).toContain(
        'No archived chats',
      ),
    )
    expect(screen.queryByTestId('archived-folder-load-more')).toBeNull()
  })

  it('remembers being open, and being closed again, across remounts', () => {
    const first = renderFolder()
    expand()
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(window.localStorage.getItem('switchui:sidebar-archived-open')).toBe(
      '1',
    )

    first.unmount()
    renderFolder()
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    cleanup()
    renderFolder()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('unarchives a row from its menu and the row leaves the folder', async () => {
    rows = [row('arch-1', { archived: 1 }), row('arch-2', { archived: 1 })]
    renderFolder()
    expand()
    await waitFor(() =>
      expect(screen.getByTestId('archived-row-chat:arch-1')).toBeTruthy(),
    )

    fireEvent.contextMenu(screen.getByTestId('session-card-chat:arch-1'))
    // The menu item's accessible name carries its icon glyph ("⊞Unarchive").
    fireEvent.click(await screen.findByRole('menuitem', { name: /Unarchive/ }))

    await waitFor(() =>
      expect(patchBodies).toEqual([
        expect.objectContaining({ sessionKey: 'arch-1', archived: false }),
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByTestId('archived-row-chat:arch-1')).toBeNull(),
    )
    expect(screen.getByTestId('archived-row-chat:arch-2')).toBeTruthy()
    expect(screen.getByTestId('archived-folder-count').textContent).toBe('1')
  })
})
