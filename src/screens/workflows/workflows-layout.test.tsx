// @vitest-environment jsdom
// Layout + the REAL graph editor inside a real TanStack router. Back/Forward
// tests use the browser history (jsdom): TanStack's memory history never runs
// blockers for BACK/FORWARD/GO, so it cannot exercise the leave guard.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { WorkflowsLayout } from './workflows-layout'
import type { RouterHistory } from '@tanstack/react-router'
import type { WorkflowSummary } from './types'
import type * as ApiClientModule from './api-client'
import type * as UseWorkflowsModule from './use-workflows'

const DEF_YAML = `name: A
nodes:
  - id: fetch
    bash: echo fetch
`

// Network only; the editor, its history and its router guard are real.
vi.mock('./api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return {
    ...actual,
    getWorkflowDefinitionParsed: vi.fn((id: string) =>
      Promise.resolve({
        definition: {
          id,
          name: id,
          description: null,
          source: 'user',
          scope_path: null,
          yaml: DEF_YAML,
          checksum: 'c1',
          version: '1',
          tags: null,
          created_at: 0,
          updated_at: 0,
          node_count: 1,
          run_count: 0,
          last_used_at: null,
        },
        parsed: null,
      }),
    ),
    getWorkflowFeatures: vi.fn(() =>
      Promise.resolve({ features: [], schedulerAlive: true, profile: 'p' }),
    ),
  }
})
vi.mock('./use-workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof UseWorkflowsModule>()),
  useWorkflowDefinitions: () => ({
    data: [] as Array<WorkflowSummary>,
    error: null,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/screens/gateway/conductor/mission-canvas', () => ({
  FlowCanvas: () => <div data-testid="flow-canvas" />,
  graphLoading: null,
}))

// Child screens are stubbed down to the callbacks the layout wires.
vi.mock('./workflow-library', () => ({
  WorkflowLibrary: ({
    onSelectWorkflow,
  }: {
    onSelectWorkflow: (id: string) => void
  }) => (
    <button type="button" onClick={() => onSelectWorkflow('wf-b')}>
      LIBRARY WF-B
    </button>
  ),
}))
vi.mock('./workflows-top-bar', () => ({
  WorkflowsTopBar: () => null,
}))
vi.mock('./workflow-grid', () => ({
  WorkflowGrid: ({
    onSelect,
    onEdit,
  }: {
    onSelect: (id: string) => void
    onEdit: (id: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSelect('wf-a')}>
        OPEN WF-A
      </button>
      <button type="button" onClick={() => onEdit('wf-a')}>
        EDIT WF-A
      </button>
    </div>
  ),
}))
vi.mock('./workflow-detail', () => ({
  WorkflowDetail: ({
    workflowId,
    onEditGraph,
  }: {
    workflowId: string
    onEditGraph: () => void
  }) => (
    <div data-testid={`detail-${workflowId}`}>
      <button type="button" onClick={onEditGraph}>
        EDIT GRAPH
      </button>
    </div>
  ),
}))
vi.mock('./launch-wizard', () => ({
  LaunchWizard: ({ workflowId }: { workflowId: string | null }) =>
    workflowId ? <div data-testid={`wizard-${workflowId}`} /> : null,
}))
vi.mock('./run-detail-panel', () => ({
  RunDetailPanel: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      CLOSE RUN
    </button>
  ),
}))

let history: RouterHistory | null = null

afterEach(() => {
  cleanup()
  history?.destroy()
  history = null
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

function renderApp(url: string, kind: 'browser' | 'memory' = 'browser') {
  if (kind === 'browser') {
    window.history.replaceState(null, '', url)
    history = createBrowserHistory()
  } else {
    history = createMemoryHistory({ initialEntries: [url] })
  }
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/workflows',
      component: WorkflowsLayout,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/conductor',
      component: () => <div data-testid="conductor" />,
    }),
  ])
  const router = createRouter({ routeTree, history })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const wf = () => new URLSearchParams(window.location.search).get('wf')

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })

/** Opens the real editor from the detail page and makes one edit. */
async function editAndDirty() {
  fireEvent.click(await screen.findByRole('button', { name: 'EDIT GRAPH' }))
  fireEvent.click(await screen.findByRole('button', { name: /Add bash node/i }))
  expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)
}

describe('WorkflowsLayout URL ⇄ view (real router)', () => {
  it('reads ?wf= on initial mount and restores browse mode on Back', async () => {
    renderApp('/workflows')
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WF-A' }))
    expect(await screen.findByTestId('detail-wf-a')).toBeTruthy()
    expect(wf()).toBe('wf-a')

    window.history.back()
    await waitFor(() => expect(wf()).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('detail-wf-a')).toBeNull())
  })

  it('Back that leaves the route with a dirty editor + Cancel keeps editing, draft intact', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const router = renderApp('/conductor')
    await screen.findByTestId('conductor')
    await act(() =>
      router.navigate({ to: '/workflows', search: { wf: 'wf-a' } as never }),
    )
    await editAndDirty()

    window.history.back()
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/workflows')
    expect(wf()).toBe('wf-a')
    expect(screen.queryByTestId('conductor')).toBeNull()
    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)

    // confirm → Back leaves for real
    confirmSpy.mockReturnValue(true)
    window.history.back()
    expect(await screen.findByTestId('conductor')).toBeTruthy()
    expect(confirmSpy).toHaveBeenCalledTimes(2)
  })

  it('Back within the route with a dirty editor confirms exactly once', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const router = renderApp('/workflows?run=r1')
    fireEvent.click(await screen.findByRole('button', { name: 'EDIT WF-A' }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Add bash node/i }),
    )
    expect(new URLSearchParams(window.location.search).get('run')).toBe('r1')
    expect(wf()).toBe('wf-a')

    // Blocked, not performed-then-undone: the router never starts for ?run=r1.
    const started: Array<string> = []
    const unsubscribe = router.subscribe('onBeforeNavigate', (e) => {
      started.push(e.toLocation.href)
    })
    window.history.back()
    await settle()
    unsubscribe()
    expect(started.filter((href) => !href.includes('wf=wf-a'))).toEqual([])
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(wf()).toBe('wf-a')
    expect(new URLSearchParams(window.location.search).get('run')).toBe('r1')
    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)

    confirmSpy.mockReturnValue(true)
    window.history.back()
    await waitFor(() => expect(wf()).toBeNull())
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(new URLSearchParams(window.location.search).get('run')).toBe('r1')
    expect(screen.queryByText(/UNSAVED/)).toBeNull()
  })

  it('closing the run panel keeps a dirty editor without a confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp('/workflows?run=r1&wf=wf-a')
    await editAndDirty()
    fireEvent.click(screen.getByRole('button', { name: 'CLOSE RUN' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'CLOSE RUN' })).toBeNull(),
    )
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(wf()).toBe('wf-a')
    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)
  })

  it('keeps the launch wizard open across a selection change', async () => {
    const router = renderApp('/workflows?wizard=wf-a', 'memory')
    expect(await screen.findByTestId('wizard-wf-a')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'LIBRARY WF-B' }))
    expect(await screen.findByTestId('detail-wf-b')).toBeTruthy()
    expect(screen.getByTestId('wizard-wf-a')).toBeTruthy()
    expect(router.state.location.search).toEqual({
      wizard: 'wf-a',
      wf: 'wf-b',
    })
  })

  it('a cancelled Forward onto the last entry leaves later Back/Forward working', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp('/workflows')
    fireEvent.click(await screen.findByRole('button', { name: 'OPEN WF-A' }))
    fireEvent.click(await screen.findByRole('button', { name: 'LIBRARY WF-B' }))
    expect(await screen.findByTestId('detail-wf-b')).toBeTruthy()
    window.history.back()
    expect(await screen.findByTestId('detail-wf-a')).toBeTruthy()
    await editAndDirty()

    // Forward to the last entry (wf-b), Cancel → back on wf-a, still editing
    window.history.forward()
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(wf()).toBe('wf-a')
    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)

    // later Forward and Back are not swallowed
    confirmSpy.mockReturnValue(true)
    window.history.forward()
    await waitFor(() => expect(wf()).toBe('wf-b'))
    expect(await screen.findByTestId('detail-wf-b')).toBeTruthy()
    window.history.back()
    await waitFor(() => expect(wf()).toBe('wf-a'))
    expect(await screen.findByTestId('detail-wf-a')).toBeTruthy()
    window.history.back()
    await waitFor(() => expect(wf()).toBeNull())
    expect(confirmSpy).toHaveBeenCalledTimes(2)
  })

  it('collapses the library rail while editing the graph and restores on exit', async () => {
    renderApp('/workflows?wf=wf-a')
    await screen.findByTestId('detail-wf-a')
    const libraryAside = document.querySelector('aside.wf-library')
    const wfBody = document.querySelector('.wf-body')
    expect(libraryAside?.classList.contains('is-collapsed')).toBe(false)
    expect(wfBody?.classList.contains('wf-body--rail-collapsed')).toBe(false)

    fireEvent.click(await screen.findByRole('button', { name: 'EDIT GRAPH' }))
    expect(libraryAside?.classList.contains('is-collapsed')).toBe(true)
    expect(wfBody?.classList.contains('wf-body--rail-collapsed')).toBe(true)

    // Exiting graph restores rail state
    fireEvent.click(await screen.findByRole('button', { name: '← WORKFLOW' }))
    expect(libraryAside?.classList.contains('is-collapsed')).toBe(false)
    expect(wfBody?.classList.contains('wf-body--rail-collapsed')).toBe(false)
  })
})
