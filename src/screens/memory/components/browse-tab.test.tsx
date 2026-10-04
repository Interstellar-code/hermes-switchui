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

type Item = {
  id: string
  type: string
  text: string
  createdAt: string | null
  dupCount?: number
  entities?: Array<string>
  junk?: boolean
}
type Page = { items: Array<Item>; nextCursor: string | null }

const item = (id: string, type = 'gist'): Item => ({
  id,
  type,
  text: `text ${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const ACTIVITY = {
  days: Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    count: i % 5,
    byType: { gist: 0, fact: 0, episodic: 0, working: 0 },
  })),
  totals: { gist: 10, fact: 5, entity: 3, wiki: 0, episodic: 2, working: 1 },
  junkFacts: 7,
}

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
      if (u.pathname === '/api/memory/activity') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(ACTIVITY),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
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

// jsdom lacks pointer capture
Element.prototype.setPointerCapture = vi.fn()

function dragSpark(from: number, to: number) {
  const svg = screen.getByRole('application', { name: /Writes per day/ })
  // jsdom has no layout: 30 days across 300px → 10px per day
  svg.getBoundingClientRect = () =>
    ({
      left: 0,
      width: 300,
      top: 0,
      height: 54,
      right: 300,
      bottom: 54,
    }) as DOMRect
  fireEvent.pointerDown(svg, { clientX: from * 10 + 5, pointerId: 1 })
  fireEvent.pointerMove(svg, { clientX: to * 10 + 5, pointerId: 1 })
  fireEvent.pointerUp(svg, { clientX: to * 10 + 5, pointerId: 1 })
  return svg
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
    fireEvent.click(screen.getByRole('button', { name: /^Facts/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    )
    await screen.findByText('text a')
    expect(lastCall().get('type')).toBeNull()
    expect(
      screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed'),
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

  it('dragging issues one browse request on release, in local days; Esc/Clear reset', async () => {
    mockFetch(() => ({ items: [item('a')], nextCursor: null }))
    renderTab()
    await screen.findByText('text a')
    const before = browseCalls.length
    const svg = screen.getByRole('application', { name: /Writes per day/ })
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 300,
        top: 0,
        height: 54,
        right: 300,
        bottom: 54,
      }) as DOMRect
    fireEvent.pointerDown(svg, { clientX: 25, pointerId: 1 })
    fireEvent.pointerMove(svg, { clientX: 35, pointerId: 1 })
    fireEvent.pointerMove(svg, { clientX: 45, pointerId: 1 })
    expect(browseCalls.length).toBe(before) // draft only
    expect(screen.getByText(/showing .*9 writes/)).toBeTruthy()
    fireEvent.pointerUp(svg, { clientX: 45, pointerId: 1 })
    await waitFor(() => expect(lastCall().get('since')).not.toBeNull())
    expect(browseCalls.length).toBe(before + 1)
    expect(lastCall().get('since')).toBe(new Date(2026, 8, 3).toISOString())
    expect(lastCall().get('until')).toBe(new Date(2026, 8, 6).toISOString())
    fireEvent.keyDown(svg, { key: 'Escape' })
    await waitFor(() => expect(lastCall().get('since')).toBeNull())
    dragSpark(0, 0)
    fireEvent.click(await screen.findByRole('button', { name: 'Clear range' }))
    await waitFor(() => expect(lastCall().get('since')).toBeNull())
  })

  it('kind chips show counts from /activity', async () => {
    mockFetch(() => ({ items: [item('a')], nextCursor: null }))
    renderTab()
    expect(
      await screen.findByRole('button', { name: /^All\s*21$/ }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Facts\s*5$/ })).toBeTruthy()
  })

  it('fold and junk toggles change the query; junk count shown', async () => {
    mockFetch(() => ({ items: [item('a')], nextCursor: null }))
    renderTab()
    await screen.findByText('text a')
    expect(lastCall().get('fold')).toBeNull()
    fireEvent.click(screen.getByLabelText('Fold duplicates'))
    await waitFor(() => expect(lastCall().get('fold')).toBe('0'))
    fireEvent.click(screen.getByLabelText(/Hide junk \(7\)/))
    await waitFor(() => expect(lastCall().get('junk')).toBe('0'))
  })

  it('groups rows by day and renders dup badge, entities and junk tag', async () => {
    mockFetch(() => ({
      items: [
        { ...item('a', 'fact'), dupCount: 3, entities: ['SwitchUI'] },
        { ...item('b', 'fact'), junk: true },
        { ...item('c'), createdAt: '2025-12-24T12:00:00.000Z' },
      ],
      nextCursor: null,
    }))
    renderTab()
    await screen.findByText('text a')
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2)
    expect(screen.getByText('×3')).toBeTruthy()
    expect(screen.getByText('SwitchUI')).toBeTruthy()
    expect(screen.getByText('junk')).toBeTruthy()
  })
})
