// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ApprovalCard } from './approval-card'
import type { NodeRunRow } from './api-client'

const mutate = vi.hoisted(() => vi.fn())
vi.mock('./approval-card.css', () => ({}))
vi.mock('./use-workflows', () => ({
  useApproveRun: () => ({ mutate, isPending: false, isError: false }),
}))
afterEach(cleanup)

const nr = {
  id: 'n1',
  dag_node_id: 'gate',
  approval_message: 'ok?',
} as NodeRunRow

describe('ApprovalCard', () => {
  it('labels capture and sends reject with reply', () => {
    render(<ApprovalCard runId="r" nodeRun={nr} captureResponse />)
    expect(screen.getByText('Reply · captured as gate.output')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(mutate.mock.calls[0][0]).toEqual({
      node_run_id: 'n1',
      decision: 'rejected',
      response: 'no',
    })
  })
})
