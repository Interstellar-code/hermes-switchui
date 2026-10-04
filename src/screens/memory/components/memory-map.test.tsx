// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryMap } from './memory-map'

// Canvas colours resolve to the token name, so draws can be asserted by token.
vi.mock('./map/palette', () => ({
  resolveCssColor: (_el: unknown, name: string) => name,
}))

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
      'strokeRect',
      'drawImage',
      'setLineDash',
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
  localStorage.removeItem('memory-map-node-limit')
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
      expect(
        screen.getByRole('slider', { name: /minimum connections/i }),
      ).toBeTruthy(),
    )
    // legend chips are the node-kind toggles; episodic is off by default
    for (const k of ['gist', 'working', 'fact', 'entity', 'episodic', 'wiki']) {
      const chip = screen.getByRole('button', { name: new RegExp(`^${k} \\(`) })
      expect(chip.getAttribute('aria-pressed')).toBe(
        k === 'episodic' ? 'false' : 'true',
      )
    }
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
    ).toBe('true') // mentions is on by default: it is the connective tissue
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
      '/api/memory/graph/node?id=fact_a_0&profile=hermes-switch',
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
      expect(
        screen.getByRole('slider', { name: /minimum connections/i }),
      ).toBeTruthy(),
    )
    mockCtx.arc.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'mentions' }))
    await waitFor(() => expect(mockCtx.arc).toHaveBeenCalled())
  })

  it('node-limit select persists to localStorage and restores "All"', async () => {
    localStorage.setItem('memory-map-node-limit', 'all')
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    const select = await screen.findByRole('combobox', {
      name: /maximum nodes shown/i,
    })
    expect((select as HTMLSelectElement).value).toBe('all')
    fireEvent.change(select, { target: { value: '500' } })
    expect(localStorage.getItem('memory-map-node-limit')).toBe('500')
  })

  it('falls back to the default node limit on an invalid stored value', async () => {
    localStorage.setItem('memory-map-node-limit', 'garbage')
    vi.stubGlobal('fetch', okFetch(GRAPH))
    renderMap()
    const select = await screen.findByRole('combobox', {
      name: /maximum nodes shown/i,
    })
    expect((select as HTMLSelectElement).value).toBe('2000')
  })

  describe('renderer', () => {
    // a 6-clique → one real cluster (slot 0); the lone gist falls into Other
    const ids = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5']
    const CLIQUE = {
      nodes: [
        ...ids.map((id) => ({ id, kind: 'fact', label: id })),
        { id: 'g', kind: 'gist', label: 'g' },
      ],
      edges: [
        ...ids.flatMap((a, i) =>
          ids.slice(i + 1).map((b) => ({
            source: a,
            target: b,
            edgeType: 'relates',
            weight: 1,
            occurrences: 1,
            timestamp: '2026-01-0' + (i + 1),
          })),
        ),
      ],
      meta: { ...GRAPH.meta, nodeCount: 7, edgeCount: 15, rawEdgeCount: 15 },
    }
    function trackFills() {
      const fills: Array<string> = []
      Object.defineProperty(mockCtx, 'fillStyle', {
        configurable: true,
        get: () => fills.at(-1),
        set: (v: string) => fills.push(v),
      })
      return fills
    }

    it('colours by cluster by default and switches palette with colour-by', async () => {
      const fills = trackFills()
      vi.stubGlobal('fetch', okFetch(CLIQUE))
      renderMap()
      await waitFor(() => expect(fills).toContain('--mm-cluster-0'))
      expect(fills.filter((f) => f.startsWith('--mm-'))).not.toContain(
        '--mm-fact',
      )

      fills.length = 0
      fireEvent.click(screen.getByRole('radio', { name: 'Kind' }))
      await waitFor(() => expect(fills).toContain('--mm-fact'))
      expect(fills).not.toContain('--mm-cluster-0')

      fills.length = 0
      fireEvent.click(screen.getByRole('radio', { name: 'Age' }))
      await waitFor(() =>
        expect(fills.some((f) => f.startsWith('--mm-age-'))).toBe(true),
      )
    })

    it('lists real clusters in the rail and renders the minimap + zoom dock', async () => {
      vi.stubGlobal('fetch', okFetch(CLIQUE))
      const { container } = renderMap()
      await screen.findByRole('button', { name: /^Cluster .* \(6\)$/ })
      expect(container.querySelector('canvas.mm-minimap')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Fit to screen' })).toBeTruthy()
      // viewport rect drawn on the minimap
      await waitFor(() => expect(mockCtx.strokeRect).toHaveBeenCalled())
    })

    it('info pill shows shown/total, junk and an edges-trimmed explainer', async () => {
      vi.stubGlobal(
        'fetch',
        okFetch({
          ...GRAPH,
          meta: {
            ...GRAPH.meta,
            rawEdgeCount: 10,
            truncated: true,
            junkFacts: 7,
          },
        }),
      )
      renderMap()
      const pill = await screen.findByRole('note')
      expect(pill.textContent).toMatch(/4 of\s*\/?\s*4 shown/)
      expect(pill.textContent).toMatch(/7 junk hidden/)
      expect(
        screen.getByRole('button', { name: /edges trimmed: 7 edges cut/i }),
      ).toBeTruthy()
    })
  })

  describe('focus mode', () => {
    async function enterFocusOn(q: string) {
      vi.stubGlobal('fetch', okFetch(GRAPH))
      const view = renderMap()
      const input = await screen.findByRole('combobox', {
        name: /search memory map/i,
      })
      fireEvent.change(input, { target: { value: q } })
      fireEvent.keyDown(input, { key: 'Enter' })
      const panel = await screen.findByRole('complementary', {
        name: /selected node/i,
      })
      fireEvent.click(screen.getByRole('button', { name: 'FOCUS' }))
      const bar = await screen.findByRole('group', { name: /focus mode/i })
      return { ...view, panel, bar }
    }

    it('enters from the inspector: breadcrumb, 2 hops, rail hidden, legend counts', async () => {
      const { container, bar } = await enterFocusOn('switch')
      expect(container.querySelector('.mm-wrap')!.className).toMatch(/is-focus/)
      const crumb = screen.getByRole('navigation', { name: /focus path/i })
      expect(crumb.textContent).toMatch(/All memory/)
      expect(crumb.textContent).toMatch(/SwitchUI$/)
      expect(
        within(bar)
          .getByRole('button', { name: '2 hops' })
          .getAttribute('aria-pressed'),
      ).toBe('true')
      // keyboard lands on the bar's back button
      expect(document.activeElement?.textContent).toMatch(/back to map/i)
      const legend = screen.getByLabelText(/edge types in view/i)
      // SwitchUI: mentions (gist) + about (fact) direct; ctx gist-fact at hop 2
      expect(legend.textContent).toMatch(/2 direct/)
      expect(legend.textContent).toMatch(/0 at 2 hops/)
      expect(bar.textContent).toMatch(/esc · back to map/i)
    })

    it('depth and edge-type controls update the ego network', async () => {
      const { bar } = await enterFocusOn('switch')
      const legend = screen.getByLabelText(/edge types in view/i)
      // types toggle: mentions off leaves SwitchUI's fact (about) direct,
      // and the gist one more hop away over ctx
      const mentions = within(bar).getByRole('button', { name: 'mentions' })
      expect(mentions.getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(mentions)
      await waitFor(() => expect(legend.textContent).toMatch(/1 direct/))
      expect(legend.textContent).toMatch(/1 at 2 hops/)
      expect(mentions.getAttribute('aria-pressed')).toBe('false')
      expect(
        within(bar)
          .getByRole('button', { name: 'all' })
          .getAttribute('aria-pressed'),
      ).toBe('false')
      fireEvent.click(within(bar).getByRole('button', { name: '1 hop' }))
      await waitFor(() => expect(legend.textContent).not.toMatch(/2 hops/))
      fireEvent.click(within(bar).getByRole('button', { name: 'all' }))
      await waitFor(() => expect(legend.textContent).toMatch(/2 direct/))
    })

    it('Esc order: inspector first, then focus; selection survives exit', async () => {
      const { container, panel } = await enterFocusOn('switch')
      // Escape inside the inspector closes it, focus mode stays
      fireEvent.keyDown(panel, { key: 'Escape' })
      expect(
        screen.queryByRole('complementary', { name: /selected node/i }),
      ).toBeNull()
      expect(screen.getByRole('group', { name: /focus mode/i })).toBeTruthy()
      // next Escape (from the bar) leaves focus mode
      fireEvent.keyDown(screen.getByRole('group', { name: /focus mode/i }), {
        key: 'Escape',
      })
      expect(screen.queryByRole('group', { name: /focus mode/i })).toBeNull()
      expect(container.querySelector('.mm-wrap')!.className).not.toMatch(
        /is-focus/,
      )
    })

    it('breadcrumb cluster exits focus and highlights that cluster', async () => {
      await enterFocusOn('switch')
      const crumb = screen.getByRole('navigation', { name: /focus path/i })
      // the 4-node fixture is too small for named clusters: "Other"
      fireEvent.click(within(crumb).getByRole('button', { name: 'Other' }))
      expect(screen.queryByRole('group', { name: /focus mode/i })).toBeNull()
      const rail = screen.getByRole('complementary', { name: /map controls/i })
      expect(
        within(rail)
          .getByRole('button', { name: /^Cluster Other/ })
          .getAttribute('aria-pressed'),
      ).toBe('true')
    })

    it('inspector FOCUS while focused re-centres and keeps the trail', async () => {
      const { panel } = await enterFocusOn('switch')
      // jump the selection to another node via its inspector chip
      fireEvent.change(
        screen.getByRole('combobox', { name: /search memory map/i }),
        { target: { value: 'caught' } },
      )
      fireEvent.keyDown(
        screen.getByRole('combobox', { name: /search memory map/i }),
        { key: 'Enter' },
      )
      await waitFor(() => expect(panel.textContent).toMatch(/caught/))
      fireEvent.click(within(panel).getByRole('button', { name: 'FOCUS' }))
      const crumb = screen.getByRole('navigation', { name: /focus path/i })
      await waitFor(() =>
        expect(
          within(crumb).getByRole('button', { name: 'SwitchUI' }),
        ).toBeTruthy(),
      )
      expect(crumb.textContent).toMatch(/caught$/)
    })

    it('back button exits and keeps the selected node and map filters', async () => {
      await enterFocusOn('switch')
      fireEvent.click(screen.getByRole('button', { name: /back to map/i }))
      expect(screen.queryByRole('group', { name: /focus mode/i })).toBeNull()
      expect(
        screen.getByRole('complementary', { name: /selected node/i }),
      ).toBeTruthy()
      // rail filters untouched
      expect(
        screen
          .getByRole('button', { name: 'mentions' })
          .getAttribute('aria-pressed'),
      ).toBe('true')
    })
  })
})
