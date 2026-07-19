// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryMap } from './memory-map'

const GRAPH = {
  nodes: [
    { id: 'gist_a', kind: 'gist', label: 'a gist' },
    { id: 'fact_a_0', kind: 'fact', label: 'User has caught' },
    { id: 'entities/switchui.md', kind: 'wiki', label: 'switchui' },
  ],
  edges: [
    { source: 'gist_a', target: 'fact_a_0', edgeType: 'ctx', weight: 1, occurrences: 1, timestamp: null },
    { source: 'entities/switchui.md', target: 'gist_a', edgeType: 'references', weight: 1, occurrences: 1, timestamp: null },
  ],
  meta: { rawEdgeCount: 2, edgeCount: 2, nodeCount: 3, truncated: false, dbMissing: false, generatedAt: '2026-01-01T00:00:00.000Z' },
}

const roDisconnect = vi.fn()

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
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves
    renderMap()
    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
  })

  it('shows an error state when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })),
    )
    renderMap()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/boom/i))
  })

  it('shows an empty state when there are no nodes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ nodes: [], edges: [], meta: { ...GRAPH.meta, nodeCount: 0, edgeCount: 0, dbMissing: true } }),
      })),
    )
    renderMap()
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/no memory database/i))
  })

  it('renders nodes and stops the simulation + disconnects the observer on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => GRAPH })))
    const { container, unmount } = renderMap()
    await waitFor(() => expect(container.querySelector('.mm-svg')).toBeTruthy())
    await waitFor(() =>
      expect(container.querySelectorAll('g.mm-node').length).toBe(GRAPH.nodes.length),
    )
    expect(() => unmount()).not.toThrow()
    expect(roDisconnect).toHaveBeenCalled()
  })

  it('renders a static layout under prefers-reduced-motion', async () => {
    mockMatchMedia(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => GRAPH })))
    const { container } = renderMap()
    // reduced-motion path ticks synchronously, so nodes have finite positions immediately.
    await waitFor(() =>
      expect(container.querySelectorAll('g.mm-node').length).toBe(GRAPH.nodes.length),
    )
    const first = container.querySelector('g.mm-node') as SVGGElement
    expect(first.getAttribute('transform')).toMatch(/translate\([-\d.]+,[-\d.]+\)/)
  })
})
