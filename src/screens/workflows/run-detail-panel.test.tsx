// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunDetailPanel } from './run-detail-panel'

const nodeRun = (over: Record<string, unknown>) => ({
  id: 'nr1',
  dag_node_id: 'approval',
  node_type: 'approval',
  status: 'paused',
  approval_message: '',
  ...over,
})
let nodeRuns: Array<Record<string, unknown>> = []

vi.mock('@/styles/workflow-ui.css', () => ({}))
vi.mock('./use-workflow-events', () => ({
  useWorkflowEvents: () => ({ events: [] }),
}))
vi.mock('./use-workflows', () => ({
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveRun: () => ({ mutate: vi.fn(), isPending: false }),
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
})
