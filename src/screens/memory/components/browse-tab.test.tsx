// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowseTab } from './browse-tab'
import { useBrowseFocusStore } from '@/stores/memory-screen-store'

type Item = { id: string; type: string; text: string; createdAt: string | null }
type Page = { items: Array<Item>; nextCursor: string | null }

const item = (id: string, type = 'gist'): Item => ({
  id,
  type,
  text: `text ${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
})

let browseCalls: Array<URLSearchParams>

function mockFetch(pageFor: (p: URLSearchParams) => Page) {
  browseCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/memory/browse') {
        browseCalls.push(u.searchParams)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pageFor(u.searchParams)),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            db: { exists: true },
            counts: { working: 1, episodic: 0, triples: 0, fts: 1, total: 1 },
          }),
      })
    }),
  )
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BrowseTab />
    </QueryClientProvider>,
  )
}

const lastCall = () => browseCalls[browseCalls.length - 1]

beforeEach(() => useBrowseFocusStore.setState({ focus: null }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BrowseTab', () => {
  it('load more appends the next page without duplicates', async () => {
    mockFetch((p) =>
      p.get('cursor')
        ? { items: [item('b'), item('c')], nextCursor: null } // 'b' repeats
        : { items: [item('a'), item('b')], nextCursor: 'CUR' },
    )
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await screen.findByText('text c')
    expect(lastCall().get('cursor')).toBe('CUR')
    expect(
      screen.getAllByText(/^text [abc]$/).map((n) => n.textContent),
    ).toEqual(['text a', 'text b', 'text c'])
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('empty state offers Clear filters that resets type + search', async () => {
    mockFetch((p) =>
      p.get('type')
        ? { items: [], nextCursor: null }
        : { items: [item('a')], nextCursor: null },
    )
    renderTab()
    await screen.findByText('text a')
    fireEvent.click(screen.getByRole('button', { name: 'Facts' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    )
    await screen.findByText('text a')
    expect(lastCall().get('type')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('applies a focus hand-off while mounted, then clears it', async () => {
    mockFetch(() => ({ items: [item('a')], nextCursor: null }))
    renderTab()
    await screen.findByText('text a')
    act(() =>
      useBrowseFocusStore.getState().setFocus({ type: 'fact', q: 'fox' }),
    )
    await waitFor(() => expect(lastCall().get('type')).toBe('fact'))
    expect(lastCall().get('q')).toBe('fox')
    expect(useBrowseFocusStore.getState().focus).toBeNull()
  })

  it('ignores an unknown focus type', async () => {
    mockFetch(() => ({ items: [item('a')], nextCursor: null }))
    useBrowseFocusStore.setState({ focus: { type: 'bogus', q: '' } })
    renderTab()
    await screen.findByText('text a')
    expect(lastCall().get('type')).toBeNull()
  })
})
