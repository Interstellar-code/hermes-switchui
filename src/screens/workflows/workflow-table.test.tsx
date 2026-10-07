// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowTable } from './workflow-table'
import type { ReactNode } from 'react'
import type { WorkflowSummary } from './types'
// Router Link stub: Conductor links must not need a router context (hoisted).
vi.mock('@tanstack/react-router', async () => {
  const React = await import('react')
  return {
    Link: (props: { to?: string; children?: ReactNode }) =>
      React.createElement('a', { href: props.to ?? '#' }, props.children),
  }
})

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

// tsc needs the input cast; eslint's separate tsconfig calls it unnecessary —
// the double cast satisfies both.
function checkboxState(el: HTMLElement): {
  indeterminate: boolean
  checked: boolean
} {
  const input = el as unknown as HTMLInputElement
  return { indeterminate: input.indeterminate, checked: input.checked }
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

    // Export reflects the count; DUPLICATE is single-select only
    expect(
      screen.getByRole('button', { name: /export yaml \(3\)/i }),
    ).toBeTruthy()
    const dupBtn = screen.getByRole('button', {
      name: /duplicate selected workflow/i,
    })
    expect(dupBtn.hasAttribute('disabled')).toBe(true)

    // Click clear selection button
    const clearBtn = screen.getByRole('button', { name: /clear selection/i })
    fireEvent.click(clearBtn)

    // Bulk bar is removed
    expect(screen.queryByRole('region', { name: /bulk actions/i })).toBeNull()
  })

  it('prunes the selection when the filtered list shrinks under it', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1' }),
      makeWf({ id: 'w2', name: 'WF 2' }),
    ]
    const { rerender } = renderWithClient(
      <WorkflowTable workflows={workflows} onSelect={vi.fn()} />,
    )
    fireEvent.click(screen.getByLabelText('Select WF 1'))
    fireEvent.click(screen.getByLabelText('Select WF 2'))
    expect(
      screen.getByRole('region', { name: /bulk actions/i }).textContent,
    ).toContain('2 selected')

    // filter removes WF 2 → selection drops to 1 without any click
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WorkflowTable workflows={[workflows[0]]} onSelect={vi.fn()} />
      </QueryClientProvider>,
    )
    const bulk = screen.getByRole('region', { name: /bulk actions/i })
    expect(bulk.textContent).toContain('1 selected')
    expect(bulk.textContent).not.toContain('2 selected')
  })

  it('marks the select-all box indeterminate on partial selection', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1' }),
      makeWf({ id: 'w2', name: 'WF 2' }),
      makeWf({ id: 'w3', name: 'WF 3' }),
    ]
    renderWithClient(<WorkflowTable workflows={workflows} onSelect={vi.fn()} />)
    const selectAll = screen.getByLabelText(/select all workflows/i)
    expect(checkboxState(selectAll).indeterminate).toBe(false)

    fireEvent.click(screen.getByLabelText('Select WF 2'))
    expect(checkboxState(selectAll).indeterminate).toBe(true)
    expect(checkboxState(selectAll).checked).toBe(false)

    fireEvent.click(screen.getByLabelText('Select WF 1'))
    fireEvent.click(screen.getByLabelText('Select WF 3'))
    expect(checkboxState(selectAll).indeterminate).toBe(false)
    expect(checkboxState(selectAll).checked).toBe(true)
  })

  it('export creates a real download: appended anchor, delayed revoke', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1', yaml: 'nodes: []' }),
    ]
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })
    const clickSpy = vi.fn()
    const realAppend = document.body.appendChild.bind(document.body)
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    appendSpy.mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) {
        node.click = clickSpy
      }
      return realAppend(node)
    })

    try {
      renderWithClient(
        <WorkflowTable workflows={workflows} onSelect={vi.fn()} />,
      )
      fireEvent.click(screen.getByLabelText('Select WF 1'))
      fireEvent.click(
        screen.getByRole('button', { name: /export yaml \(1\)/i }),
      )

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(clickSpy).toHaveBeenCalledTimes(1)
      // revoked only after a delay, not synchronously with the click
      expect(revokeObjectURL).not.toHaveBeenCalled()
    } finally {
      appendSpy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('renders no invented validity or run state', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1', run_count: 4, last_used_at: null }),
    ]
    renderWithClient(<WorkflowTable workflows={workflows} onSelect={vi.fn()} />)
    // VALID column header stays, but every row shows "—" (no invented data)
    expect(screen.queryByText(/✓ valid/i)).toBeNull()
    expect(screen.queryByText(/running · ok/i)).toBeNull()
    expect(screen.queryByText(/✓/)).toBeNull()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
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

  // QA1 F1-2/F2-1: LAST RUN is "—" when the API ships no run data —
  // "never" is only for an explicit 0.
  it('shows an em dash LAST RUN when run_count is unknown, "never" only at 0 (QA1 F1-2)', () => {
    const unknown = makeWf({ id: 'w1', name: 'Unknown Runs' })
    delete (unknown as Partial<WorkflowSummary>).run_count
    const zero = makeWf({ id: 'w2', name: 'Zero Runs', run_count: 0 })
    const three = makeWf({ id: 'w3', name: 'Three Runs', run_count: 3 })

    renderWithClient(
      <WorkflowTable workflows={[unknown, zero, three]} onSelect={vi.fn()} />,
    )

    const rows = screen.getAllByRole('row')
    // Row 1 (after header): unknown → em dash, not "never"
    expect(rows[1].textContent).toContain('—')
    expect(rows[1].textContent).not.toMatch(/never/)
    // Row 2: explicit 0 → "never"
    expect(rows[2].textContent).toMatch(/never/)
    // Row 3: real count
    expect(rows[3].textContent).toMatch(/3 runs/)
  })

  // QA1 F1-3/F2-1: VER is "—" for a null version, not "v1".
  it('shows an em dash VER for a null version (QA1 F1-3)', () => {
    renderWithClient(
      <WorkflowTable
        workflows={[
          makeWf({ id: 'w1', name: 'No Version' }),
          makeWf({ id: 'w2', name: 'Versioned', version: '4' }),
        ]}
        onSelect={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('row')
    expect(rows[1].textContent).not.toContain('v1')
    expect(rows[1].textContent).toContain('—')
    expect(rows[2].textContent).toContain('v4')
  })
})
