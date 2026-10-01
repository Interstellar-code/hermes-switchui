// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryMap } from './memory-map'

const GRAPH = {
  nodes: [
    { id: 'gist_a', kind: 'gist', label: 'a gist' },
    { id: 'fact_a_0', kind: 'fact', label: 'User has caught' },
    { id: 'entity:SwitchUI', kind: 'entity', label: 'SwitchUI' },
    { id: 'wiki/x.md', kind: 'wiki', label: 'x' },
  ],
  edges: [
    {
      source: 'gist_a',
      target: 'fact_a_0',
      edgeType: 'ctx',
      weight: 1,
      occurrences: 1,
      timestamp: null,
    },
    {
      source: 'gist_a',
      target: 'entity:SwitchUI',
      edgeType: 'mentions',
      weight: 1,
      occurrences: 1,
      timestamp: null,
    },
    {
      source: 'fact_a_0',
      target: 'entity:SwitchUI',
      edgeType: 'about',
      weight: 1,
      occurrences: 1,
      timestamp: null,
    },
  ],
  meta: {
    rawEdgeCount: 3,
    edgeCount: 3,
    nodeCount: 4,
    truncated: false,
    dbMissing: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
  },
}

const roDisconnect = vi.fn()
let mockCtx: Record<string, ReturnType<typeof vi.fn>>

const okFetch = (body: unknown) =>
  vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))

function renderMap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryMap />
    </QueryClientProvider>,
  )
}

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: reduced && q.includes('reduce'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

beforeEach(() => {
  roDisconnect.mockClear()
  mockCtx = Object.fromEntries(
    [
      'save',
      'restore',
      'setTransform',
      'clearRect',
      'translate',
      'scale',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'arc',
      'rect',
      'fill',
      'fillText',
      'strokeText',
      'closePath',
    ].map((m) => [m, vi.fn()]),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    mockCtx as unknown as CanvasRenderingContext2D,
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = roDisconnect
    },
  )
  mockMatchMedia(false)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MemoryMap', () => {
  it('shows a loading state while fetching', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    renderMap()
    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
  })

  it('shows an error state when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'boom' }),
        }),
      ),
    )
    renderMap()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/boom/i),
    )
  })

  it('shows an empty state when there are no nodes', async () => {
    vi.stubGlobal(
      'fetch',
      okFetch({
        nodes: [],
        edges: [],
        meta: { ...GRAPH.meta, nodeCount: 0, edgeCount: 0, dbMissing: true },
      }),
    )
    renderMap()
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(
        /no memory database/i,
      ),
    )
  })

  it('renders a canvas, draws nodes, and cleans up on unmount', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    const { container, unmount } = renderMap()
    await waitFor(() =>
      expect(container.querySelector('canvas.mm-canvas')).toBeTruthy(),
    )
    await waitFor(() => expect(mockCtx.arc).toHaveBeenCalled()) // nodes drawn
    expect(() => unmount()).not.toThrow()
    expect(roDisconnect).toHaveBeenCalled()
  })

  it('draws a static layout under prefers-reduced-motion', async () => {
    mockMatchMedia(true)
    vi.stubGlobal('fetch', okFetch(GRAPH))
    const { container } = renderMap()
    await waitFor(() =>
      expect(container.querySelector('canvas.mm-canvas')).toBeTruthy(),
    )
    // reduced-motion ticks + draws synchronously in the effect
    await waitFor(() => expect(mockCtx.arc).toHaveBeenCalled())
  })

  it('exposes legend kind toggles, edge-type filters and a min-connections slider', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /filters/i })).toBeTruthy(),
    )
    // legend chips are the node-kind toggles; episodic is off by default
    for (const k of ['gist', 'working', 'fact', 'entity', 'episodic', 'wiki']) {
      const chip = screen.getByRole('button', { name: new RegExp(`^${k} \\(`) })
      expect(chip.getAttribute('aria-pressed')).toBe(
        k === 'episodic' ? 'false' : 'true',
      )
    }
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    for (const t of [
      'ctx',
      'references',
      'mentions',
      'about',
      'relates',
      'summarizes',
    ]) {
      expect(screen.getByRole('button', { name: t })).toBeTruthy()
    }
    expect(
      screen
        .getByRole('button', { name: 'mentions' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      screen.getByRole('slider', { name: /minimum connections/i }),
    ).toBeTruthy()
  })

  it('fetches full node text for the detail panel', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url.startsWith('/api/memory/graph/node')
              ? {
                  id: 'fact_a_0',
                  kind: 'fact',
                  label: 'User has caught',
                  text: 'User has caught\na very long full fact',
                  createdAt: '2026-02-03T04:05:00Z',
                  updatedAt: null,
                  source: { confidence: 0.9 },
                }
              : GRAPH,
          ),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderMap()
    const input = await screen.findByRole('combobox', {
      name: /search memory map/i,
    })
    fireEvent.change(input, { target: { value: 'caught' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const panel = await screen.findByRole('complementary', {
      name: /selected node/i,
    })
    await waitFor(() =>
      expect(panel.textContent).toMatch(/a very long full fact/),
    )
    expect(panel.textContent).toMatch(/2026-02-03 04:05/)
    expect(panel.textContent).toMatch(/confidence/)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/memory/graph/node?id=fact_a_0',
      expect.anything(),
    )
  })

  it('opens a detail panel with neighbours from a search hit, and Open in Wiki for wiki nodes', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    const input = await screen.findByRole('combobox', {
      name: /search memory map/i,
    })
    fireEvent.change(input, { target: { value: 'switch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const panel = await screen.findByRole('complementary', {
      name: /selected node/i,
    })
    expect(panel.textContent).toMatch(/SwitchUI/)
    expect(panel.textContent).toMatch(/a gist/) // neighbour listed
    expect(screen.queryByRole('button', { name: /open in wiki/i })).toBeNull()

    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.click(screen.getAllByRole('option', { name: /^x$/ })[0])
    expect(
      await screen.findByRole('button', { name: /open in wiki/i }),
    ).toBeTruthy()
  })

  it('arrow keys pick a result; Escape in search does not close the detail panel', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    const input = await screen.findByRole('combobox', {
      name: /search memory map/i,
    })
    // "a" matches several nodes; ArrowDown moves off the first
    fireEvent.change(input, { target: { value: 'a' } })
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const picked = screen.getAllByRole('option')[1]
    expect(picked.getAttribute('aria-selected')).toBe('true')
    const pickedText = picked.textContent
    fireEvent.keyDown(input, { key: 'Enter' })
    const panel = await screen.findByRole('complementary', {
      name: /selected node/i,
    })
    expect(panel.textContent).toContain(pickedText.trim())

    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')
    expect(
      screen.getByRole('complementary', { name: /selected node/i }),
    ).toBeTruthy()
  })

  it('re-renders (redraws) when an edge type is filtered off', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /filters/i })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    mockCtx.arc.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'mentions' }))
    await waitFor(() => expect(mockCtx.arc).toHaveBeenCalled())
  })
})
