// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { ConductorLayout } from './conductor-layout'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

// ── router: a tiny URL store so ?run= / ?node= round-trips are observable ──
const url = vi.hoisted(() => {
  let search: Record<string, unknown> = {}
  const subs = new Set<() => void>()
  return {
    get: () => search,
    set: (next: Record<string, unknown>) => {
      search = Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== undefined),
      )
      subs.forEach((f) => f())
    },
    subscribe: (f: () => void) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    navigate: vi.fn(),
  }
})
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => useSyncExternalStore(url.subscribe, url.get),
  useNavigate: () => url.navigate,
}))

const h = vi.hoisted(() => ({
  missions: [] as Array<{ id: string; status: string; createdAt: number }>,
}))
const NODES = ['plan', 'build', 'ship']

vi.mock('./use-conductor-queries', () => ({
  useConductorMissions: () => ({ data: h.missions }),
  useConductorScheduled: () => ({ data: undefined }),
  useAbortMission: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeRun: () => ({ resume: vi.fn(), isPending: false }),
}))
vi.mock('./use-run-dag', () => ({
  useRunDag: (runId: string | null) => ({
    run: runId ? { id: runId, workflow_id: 'wf', status: 'completed' } : null,
    workflowId: runId ? 'wf' : null,
    dag: runId
      ? {
          nodes: NODES.map((id) => ({ id, status: 'completed', type: 'bash' })),
        }
      : null,
  }),
}))
vi.mock('@/screens/workflows/use-workflows', () => ({
  useWorkflowRun: (runId: string | null) => ({
    isLoading: false,
    data: runId
      ? {
          run: {
            id: runId,
            workflow_id: 'wf',
            status: 'failed',
            started_at: '2026-10-05T14:00:00Z',
            completed_at: '2026-10-05T14:01:00Z',
            metadata: {},
          },
          nodeRuns: [
            {
              id: `${runId}-nr`,
              workflow_run_id: runId,
              dag_node_id: 'build',
              node_type: 'bash',
              status: 'failed',
              error: 'boom',
            },
          ],
          phaseTransitions: [],
        }
      : undefined,
  }),
  useWorkflowParsed: () => ({ data: undefined, isLoading: false }),
  useWorkflowFeatures: () => ({ isLoading: false, data: { features: [] } }),
  useChildRuns: () => ({ data: undefined }),
  useRunEvents: () => ({ data: { events: [] } }),
  useApproveRun: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useLaunchWorkflowRun: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/components/prompt-kit/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}))
// Canvas stand-in: one focusable card per node, like flow-node's `.dn`.
vi.mock('./mission-canvas', () => ({
  MissionCanvas: ({ onNodeSelect }: { onNodeSelect: (id: string) => void }) => (
    <div>
      {NODES.map((id) => (
        <div
          key={id}
          className="dn"
          data-node-id={id}
          tabIndex={0}
          onClick={() => onNodeSelect(id)}
        >
          {id}
        </div>
      ))}
    </div>
  ),
}))
const stub = vi.hoisted(() => () => null)
vi.mock('./mission-timeline', () => ({ MissionTimeline: stub }))
vi.mock('./now-playing-strip', () => ({ NowPlayingStrip: stub }))
vi.mock('./approval-banner', () => ({ ApprovalBanner: stub }))
vi.mock('./conductor-top-bar', () => ({ ConductorTopBar: stub }))
vi.mock('./mission-rail', () => ({ MissionRail: stub }))
vi.mock('./conductor-idle', () => ({ ConductorIdle: stub }))
vi.mock('./agents-panel', () => ({ AgentsPanel: stub }))
vi.mock('../../workflows/launch-wizard', () => ({ LaunchDialog: stub }))

// ── EventSource: count constructions ──
const opened: Array<string> = []
class FakeEventSource {
  constructor(src: string) {
    opened.push(src)
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
  onopen = null
  onerror = null
  onmessage = null
}

beforeEach(() => {
  opened.length = 0
  vi.stubGlobal('EventSource', FakeEventSource)
  // jsdom has no CSS.escape; ids here need no escaping.
  vi.stubGlobal('CSS', { escape: (v: string) => v })
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => {
    f()
    return 0
  })
  url.navigate.mockImplementation(
    (o: { search: (s: Record<string, unknown>) => Record<string, unknown> }) =>
      url.set(o.search(url.get())),
  )
  url.set({})
  h.missions = []
  useConductorUIStore.setState({
    selectedRunId: null,
    drawerRunId: null,
    selectedNode: null,
    nodePanelTab: 'overview',
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ConductorLayout />
    </QueryClientProvider>,
  )
}
const st = () => useConductorUIStore.getState()
const panelNode = () =>
  screen.queryByLabelText('Node detail')?.querySelector('.cnp-nt')
    ?.textContent ?? null

describe('ConductorLayout', () => {
  it('opens exactly one EventSource with the panel and the drawer open', async () => {
    useConductorUIStore.setState({
      selectedRunId: 'r1',
      drawerRunId: 'r1',
      selectedNode: { runId: 'r1', nodeId: 'build' },
    })
    mount()
    await waitFor(() => expect(panelNode()).toBe('build'))
    expect(screen.getByText('OPEN NODE')).toBeTruthy() // drawer is open
    expect(opened).toEqual(['/api/workflow-events?runId=r1'])
  })

  it('?node= deep link wins over a pre-focused other run', async () => {
    useConductorUIStore.setState({ selectedRunId: 'r1' })
    url.set({ run: 'r2', node: 'ship' })
    mount()
    await waitFor(() => expect(panelNode()).toBe('ship'))
    expect(st().selectedRunId).toBe('r2')
    expect(st().selectedNode).toEqual({ runId: 'r2', nodeId: 'ship' })
    expect(url.get()).toEqual({ run: 'r2', node: 'ship' })
  })

  it('drawer OPEN NODE on a run other than the focused one docks the node', async () => {
    h.missions = [{ id: 'r1', status: 'live', createdAt: 1 }]
    useConductorUIStore.setState({ drawerRunId: 'r2' })
    mount()
    // Layout (auto-focused r1) + inspector's own (r2 is not the focused run).
    expect([...opened].sort()).toEqual([
      '/api/workflow-events?runId=r1',
      '/api/workflow-events?runId=r2',
    ])
    fireEvent.click(screen.getByText('OPEN NODE'))
    await waitFor(() => expect(panelNode()).toBe('build'))
    expect(st().selectedRunId).toBe('r2')
    expect(st().drawerRunId).toBeNull()
    expect(url.get()).toEqual({ run: 'r2', node: 'build' })
  })

  it('changing the run clears the panel', async () => {
    useConductorUIStore.setState({ selectedRunId: 'r1' })
    mount()
    fireEvent.click(screen.getByText('plan'))
    await waitFor(() => expect(panelNode()).toBe('plan'))
    expect(url.get()).toEqual({ run: 'r1', node: 'plan' })
    act(() => st().setSelectedRunId('r2'))
    await waitFor(() => expect(url.get()).toEqual({ run: 'r2' }))
    expect(panelNode()).toBeNull()
  })

  it('auto-focus moving to another run hides a stale selection', async () => {
    h.missions = [{ id: 'r1', status: 'live', createdAt: 1 }]
    const view = mount()
    fireEvent.click(screen.getByText('ship'))
    await waitFor(() => expect(panelNode()).toBe('ship'))
    h.missions = [
      { id: 'r1', status: 'done', createdAt: 1 },
      { id: 'r3', status: 'live', createdAt: 2 },
    ]
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ConductorLayout />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(panelNode()).toBeNull())
  })

  it('returns focus to the node card on close', async () => {
    useConductorUIStore.setState({ selectedRunId: 'r1' })
    mount()
    fireEvent.click(screen.getByText('build'))
    await waitFor(() => expect(panelNode()).toBe('build'))
    fireEvent.click(screen.getByRole('button', { name: 'Close node panel' }))
    expect(panelNode()).toBeNull()
    expect(document.activeElement?.getAttribute('data-node-id')).toBe('build')
  })

  it('a node not on the canvas shows a notice instead of nothing', async () => {
    useConductorUIStore.setState({ selectedRunId: 'r1' })
    url.set({ run: 'r1', node: 'ghost' })
    mount()
    expect((await screen.findByRole('status')).textContent).toMatch(
      /“ghost” is not shown on the canvas/,
    )
    expect(panelNode()).toBeNull()
  })
})
