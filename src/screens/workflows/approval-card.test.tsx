// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ApprovalCard } from './approval-card'
import type { NodeRunRow } from './api-client'

const mutate = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  error: null as Error | null,
}))
vi.mock('./approval-card.css', () => ({}))
vi.mock('./use-workflows', () => ({
  useApproveRun: () => ({ mutate, ...state }),
}))
afterEach(() => {
  cleanup()
  mutate.mockReset()
  Object.assign(state, { isPending: false, isError: false, error: null })
})

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

  it('sends approve with the typed reply', () => {
    render(<ApprovalCard runId="r" nodeRun={nr} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1,3' } })
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(mutate.mock.calls[0][0]).toEqual({
      node_run_id: 'n1',
      decision: 'approved',
      response: '1,3',
    })
  })

  it('disables controls while pending', () => {
    state.isPending = true
    render(<ApprovalCard runId="r" nodeRun={nr} />)
    for (const b of screen.getAllByRole('button')) {
      expect((b as HTMLButtonElement).disabled).toBe(true)
      expect(b.textContent).toBe('Sending…')
    }
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').disabled).toBe(true)
  })

  it('announces errors', () => {
    Object.assign(state, { isError: true, error: new Error('boom') })
    render(<ApprovalCard runId="r" nodeRun={nr} />)
    expect(screen.getByRole('alert').textContent).toBe('boom')
  })
})
