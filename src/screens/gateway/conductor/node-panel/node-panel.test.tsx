// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import fixture from '../__fixtures__/node-runs-failed-bash.json'
import { NodePanel } from './node-panel'

const h = vi.hoisted(() => ({
  runStatus: 'failed',
  features: [] as Array<string>,
  nodeRuns: [] as Array<unknown>,
}))
vi.mock('@/styles/conductor-node-panel.css', () => ({}))
vi.mock('@/screens/workflows/approval-card.css', () => ({}))
vi.mock('@/components/prompt-kit/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}))
vi.mock('../use-run-dag', () => ({ useRunDag: () => ({ dag: null }) }))
vi.mock('@/screens/workflows/use-workflows', () => ({
  useWorkflowRun: () => ({
    isLoading: false,
    data: {
      run: {
        id: 'r',
        workflow_id: 'wf',
        status: h.runStatus,
        metadata: { pause: { captureResponse: true } },
      },
      nodeRuns: h.nodeRuns,
      phaseTransitions: [],
    },
  }),
  useWorkflowParsed: () => ({ data: { parsed: fixture.parsed } }),
  useWorkflowFeatures: () => ({
    isLoading: false,
    data: { features: h.features },
  }),
  useRunEvents: () => ({ data: { events: [] } }),
  useApproveRun: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))

afterEach(() => {
  cleanup()
  h.runStatus = 'failed'
  h.features = []
})

const base = {
  runId: 'r',
  tab: 'overview' as const,
  onTab: vi.fn(),
  onClose: vi.fn(),
  onSelectNode: vi.fn(),
  onAllNodeRuns: vi.fn(),
  events: [],
}

describe('NodePanel', () => {
  it('approval variant embeds the capture-labelled approval card', () => {
    h.runStatus = 'paused'
    h.nodeRuns = [
      {
        ...fixture.nodeRuns[0],
        status: 'paused',
        started_at: '2026-10-05T14:06:56Z',
        completed_at: null,
      },
    ]
    render(<NodePanel {...base} nodeId="approval-gate" />)
    expect(screen.getByLabelText('Node detail')).toBeTruthy()
    expect(
      screen.getByText('Reply · captured as approval-gate.output'),
    ).toBeTruthy()
    expect(screen.getByText('⏸ WAITING')).toBeTruthy()
  })

  it('failed variant shows the stderr tail, a gated RESUME and ALL NODE RUNS', () => {
    h.nodeRuns = fixture.nodeRuns
    const onAllNodeRuns = vi.fn()
    const { rerender } = render(
      <NodePanel
        {...base}
        tab="output"
        nodeId="apply"
        onAllNodeRuns={onAllNodeRuns}
      />,
    )
    expect(screen.getByText(/exit status 1/)).toBeTruthy()
    expect(screen.getByText(/STDERR TAIL/)).toBeTruthy()
    const resume = screen.getByRole('button', {
      name: 'RESUME RUN',
    })
    expect(resume.hasAttribute('disabled')).toBe(true)
    expect(resume.title).toBe('available after backend update')
    fireEvent.click(screen.getByRole('button', { name: 'ALL NODE RUNS' }))
    expect(onAllNodeRuns).toHaveBeenCalledWith('apply')

    h.features = ['retry_run']
    const onResume = vi.fn()
    rerender(
      <NodePanel {...base} tab="output" nodeId="apply" onResume={onResume} />,
    )
    const on = screen.getByRole('button', {
      name: 'RESUME RUN',
    })
    expect(on.hasAttribute('disabled')).toBe(false)
    fireEvent.click(on)
    expect(onResume).toHaveBeenCalledWith('r')
  })

  it('Esc closes the panel', () => {
    h.nodeRuns = fixture.nodeRuns
    const onClose = vi.fn()
    render(<NodePanel {...base} nodeId="apply" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
