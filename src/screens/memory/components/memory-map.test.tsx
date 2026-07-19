// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
    { source: 'gist_a', target: 'fact_a_0', edgeType: 'ctx', weight: 1, occurrences: 1, timestamp: null },
    { source: 'gist_a', target: 'entity:SwitchUI', edgeType: 'mentions', weight: 1, occurrences: 1, timestamp: null },
    { source: 'fact_a_0', target: 'entity:SwitchUI', edgeType: 'about', weight: 1, occurrences: 1, timestamp: null },
  ],
  meta: { rawEdgeCount: 3, edgeCount: 3, nodeCount: 4, truncated: false, dbMissing: false, generatedAt: '2026-01-01T00:00:00.000Z' },
}

const roDisconnect = vi.fn()
let mockCtx: Record<string, ReturnType<typeof vi.fn>>

const okFetch = (body: unknown) =>
  vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))

function renderMap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
      'save', 'restore', 'setTransform', 'clearRect', 'translate', 'scale',
      'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'rect', 'fill', 'fillText',
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
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderMap()
    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
  })

  it('shows an error state when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) }),
    ))
    renderMap()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/boom/i))
  })

  it('shows an empty state when there are no nodes', async () => {
    vi.stubGlobal('fetch', okFetch({ nodes: [], edges: [], meta: { ...GRAPH.meta, nodeCount: 0, edgeCount: 0, dbMissing: true } }))
    renderMap()
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no memory database/i))
  })

  it('renders a canvas, draws nodes, and cleans up on unmount', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    const { container, unmount } = renderMap()
    await waitFor(() => expect(container.querySelector('canvas.mm-canvas')).toBeTruthy())
    await waitFor(() => expect(mockCtx.arc).toHaveBeenCalled()) // nodes drawn
    expect(() => unmount()).not.toThrow()
    expect(roDisconnect).toHaveBeenCalled()
  })

  it('draws a static layout under prefers-reduced-motion', async () => {
    mockMatchMedia(true)
    vi.stubGlobal('fetch', okFetch(GRAPH))
    const { container } = renderMap()
    await waitFor(() => expect(container.querySelector('canvas.mm-canvas')).toBeTruthy())
    // reduced-motion ticks + draws synchronously in the effect
    await waitFor(() => expect(mockCtx.arc).toHaveBeenCalled())
  })

  it('renders the edge-type toggle controls', async () => {
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    await waitFor(() => expect(screen.getByRole('button', { name: 'mentions' })).toBeTruthy())
    for (const t of ['ctx', 'references', 'mentions', 'about', 'relates', 'summarizes']) {
      expect(screen.getByRole('button', { name: t })).toBeTruthy()
    }
  })
})
