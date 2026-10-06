// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowTable } from './workflow-table'
import type { WorkflowSummary } from './types'

afterEach(() => {
  cleanup()
})

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

function makeWf(partial: Partial<WorkflowSummary>): WorkflowSummary {
  return {
    id: 'test-wf',
    name: 'Test Workflow',
    description: 'A test workflow',
    source: 'bundled',
    tags: [],
    node_count: 3,
    last_used_at: null,
    version_tier: 'v1',
    has_loop: false,
    has_approval: false,
    required_inputs: [],
    optional_inputs: [],
    when_to_use: '',
    dag_depth: 1,
    max_parallelism: 1,
    run_count: 0,
    dag: [],
    dag_edges: [],
    yaml: 'nodes: []',
    node_types: ['prompt'],
    ...partial,
  }
}

describe('WorkflowTable (F2)', () => {
  it('toggles column sort and updates aria-sort attribute', () => {
    const w1 = makeWf({ id: 'w1', name: 'Alpha', node_count: 10 })
    const w2 = makeWf({ id: 'w2', name: 'Beta', node_count: 2 })

    renderWithClient(<WorkflowTable workflows={[w1, w2]} onSelect={vi.fn()} />)

    // Name column button
    const nameBtn = screen.getByRole('button', { name: /^NAME/i })
    fireEvent.click(nameBtn)

    // The header th should have aria-sort="ascending"
    const nameTh = nameBtn.closest('th')
    expect(nameTh?.getAttribute('aria-sort')).toBe('ascending')

    // Click again to toggle to descending
    fireEvent.click(nameBtn)
    expect(nameTh?.getAttribute('aria-sort')).toBe('descending')
  })

  it('selects all rows, shows bulk bar with counts, and clears selection', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1', source: 'user' }),
      makeWf({ id: 'w2', name: 'WF 2', source: 'bundled' }),
      makeWf({ id: 'w3', name: 'WF 3', source: 'user' }),
    ]

    renderWithClient(<WorkflowTable workflows={workflows} onSelect={vi.fn()} />)

    // Bulk bar not visible initially
    expect(screen.queryByRole('region', { name: /bulk actions/i })).toBeNull()

    // Click select all checkbox in th
    const selectAllCheckbox = screen.getByLabelText(/select all workflows/i)
    fireEvent.click(selectAllCheckbox)

    // Bulk bar appears with count 3
    const bulkBar = screen.getByRole('region', { name: /bulk actions/i })
    expect(bulkBar).toBeTruthy()
    expect(bulkBar.textContent).toContain('3 selected')
    expect(bulkBar.textContent).toContain('2 user · 1 factory')

    // Export and duplicate buttons reflect count
    expect(
      screen.getByRole('button', { name: /export yaml \(3\)/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /duplicate \(3\)/i }),
    ).toBeTruthy()

    // Click clear selection button
    const clearBtn = screen.getByRole('button', { name: /clear selection/i })
    fireEvent.click(clearBtn)

    // Bulk bar is removed
    expect(screen.queryByRole('region', { name: /bulk actions/i })).toBeNull()
  })

  it('does NOT contain any delete actions anywhere (deferred to F8)', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1', source: 'user' }),
      makeWf({ id: 'w2', name: 'WF 2', source: 'bundled' }),
    ]

    renderWithClient(<WorkflowTable workflows={workflows} onSelect={vi.fn()} />)

    // Select a row to show bulk bar
    const rowCheckboxes = screen.getAllByRole('checkbox')
    fireEvent.click(rowCheckboxes[1]) // First row checkbox

    // Verify no delete button exists
    expect(screen.queryByText(/delete/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})
