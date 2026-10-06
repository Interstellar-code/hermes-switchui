// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RunDetailPanel } from './run-detail-panel'

const nodeRun = (over: Record<string, unknown>) => ({
  id: 'nr1',
  dag_node_id: 'approval',
  node_type: 'approval',
  status: 'paused',
  approval_message: '',
  ...over,
})
const approve = vi.hoisted(() => vi.fn())
let nodeRuns: Array<Record<string, unknown>> = []

vi.mock('@/styles/workflow-ui.css', () => ({}))
vi.mock('./use-workflow-events', () => ({
  useWorkflowEvents: () => ({ events: [] }),
}))
vi.mock('./run-definition-client', () => ({
  useRunDefinition: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('./use-workflows', () => ({
  useRunEvents: () => ({ data: { events: [] } }),
  useWorkflowFeatures: () => ({ data: { features: [] } }),
  useChildRuns: () => ({ data: undefined }),
  useWorkflowParsed: () => ({ data: undefined, isLoading: false }),
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveRun: () => ({ mutate: approve, isPending: false }),
  useWorkflowRun: () => ({
    data: {
      run: { id: 'run-1', status: 'paused', current_phase: 'Report' },
      nodeRuns,
      phaseTransitions: [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

afterEach(cleanup)

describe('RunDetailPanel approval controls', () => {
  it('shows Approve/Reject for a paused approval node with empty message', () => {
    nodeRuns = [nodeRun({})]
    render(<RunDetailPanel runId="run-1" onClose={() => {}} />)
    expect(screen.getByText('Approval required')).toBeTruthy()
    expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /reject/i })).toBeTruthy()
  })

  it('hides controls for a paused non-approval node without a message', () => {
    nodeRuns = [nodeRun({ node_type: 'bash', dag_node_id: 'b' })]
    render(<RunDetailPanel runId="run-1" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull()
  })

  it('sends the typed reply with Approve', () => {
    nodeRuns = [nodeRun({ approval_message: 'Reply "skip" or "1,3,7"' })]
    render(<RunDetailPanel runId="run-1" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/reply/i), {
      target: { value: '1,3,7' },
    })
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(approve.mock.calls[0][0]).toEqual({
      node_run_id: 'nr1',
      decision: 'approved',
      response: '1,3,7',
    })
  })
})

describe('RunDetailPanel inspector tabs', () => {
  it('renders the five tabs and switches with arrow keys', () => {
    nodeRuns = [nodeRun({ approval_message: 'ok?' })]
    render(<RunDetailPanel runId="run-1" onClose={() => {}} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent.replace(/\d+$/, ''))).toEqual([
      'OVERVIEW',
      'OUTPUT',
      'NODE RUNS',
      'EVENTS',
      'DEFINITION',
    ])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(
      screen.getByRole('tab', { name: 'OUTPUT' }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'OUTPUT' }), {
      key: 'End',
    })
    expect(
      screen
        .getByRole('tab', { name: 'DEFINITION' })
        .getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('degrades attempts without the node_attempts feature', () => {
    nodeRuns = [
      nodeRun({
        node_type: 'bash',
        dag_node_id: 'b',
        status: 'completed',
        retries: 2,
      }),
    ]
    render(<RunDetailPanel runId="run-1" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: /NODE RUNS/ }))
    fireEvent.click(screen.getByRole('button', { name: /Expand b details/ }))
    expect(screen.getByText('attempt 1 · retries not recorded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'OPEN LOG' })).toBeNull()
  })
})
