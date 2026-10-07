// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowLibrary } from './workflow-library'
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

describe('WorkflowLibrary filter rail', () => {
  it('filters by origin when origin option clicked', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'f1', name: 'Factory 1', source: 'bundled' }),
      makeWf({ id: 'u1', name: 'User 1', source: 'user' }),
      makeWf({ id: 'p1', name: 'Project 1', source: 'project' }),
    ]
    const onFilteredChange = vi.fn()

    renderWithClient(
      <WorkflowLibrary
        selectedId={null}
        onSelectWorkflow={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onFilteredChange={onFilteredChange}
        workflows={workflows}
      />,
    )

    // Initially receives all 3
    expect(onFilteredChange).toHaveBeenLastCalledWith(workflows)

    // Click 'User' origin filter
    const userBtn = screen.getByRole('button', { name: /User\s*1/i })
    fireEvent.click(userBtn)

    expect(onFilteredChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'u1' }),
    ])
  })

  it('filters by node type chip', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'Prompt WF', node_types: ['prompt'] }),
      makeWf({ id: 'w2', name: 'Bash WF', node_types: ['bash'] }),
    ]
    const onFilteredChange = vi.fn()

    renderWithClient(
      <WorkflowLibrary
        selectedId={null}
        onSelectWorkflow={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onFilteredChange={onFilteredChange}
        workflows={workflows}
      />,
    )

    // Click 'bash' chip
    const bashChip = screen.getByRole('button', { name: /bash\s*1/i })
    fireEvent.click(bashChip)

    expect(onFilteredChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'w2' }),
    ])
  })

  it('focuses search input when / key is pressed', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1' }),
    ]

    renderWithClient(
      <WorkflowLibrary
        selectedId={null}
        onSelectWorkflow={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        workflows={workflows}
      />,
    )

    const searchInput = screen.getByRole('searchbox')
    expect(document.activeElement).not.toBe(searchInput)

    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(searchInput)
  })

  it('ignores / with modifiers, while typing, or with a dialog open', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'WF 1' }),
    ]

    renderWithClient(
      <WorkflowLibrary
        selectedId={null}
        onSelectWorkflow={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        workflows={workflows}
      />,
    )

    const searchInput = screen.getByRole('searchbox')

    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    fireEvent.keyDown(window, { key: '/', metaKey: true })
    fireEvent.keyDown(window, { key: '/', altKey: true })
    expect(document.activeElement).not.toBe(searchInput)

    // typing in another input: '/' must type, not steal focus
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(other)
    other.remove()

    // a dialog on top: '/' must not steal focus
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    searchInput.blur()
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).not.toBe(searchInput)
    dialog.remove()
  })

  it('resets every filter when clearKey bumps (grid CLEAR ALL FILTERS)', () => {
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', name: 'User WF', source: 'user' }),
      makeWf({ id: 'w2', name: 'Factory WF', source: 'bundled' }),
    ]
    const onFilteredChange = vi.fn()

    const { rerender } = renderWithClient(
      <WorkflowLibrary
        selectedId={null}
        onSelectWorkflow={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onFilteredChange={onFilteredChange}
        workflows={workflows}
        clearKey={0}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /User\s*1/i }))
    expect(onFilteredChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'w1' }),
    ])

    rerender(
      <WorkflowLibrary
        selectedId={null}
        onSelectWorkflow={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onFilteredChange={onFilteredChange}
        workflows={workflows}
        clearKey={1}
      />,
    )
    expect(onFilteredChange).toHaveBeenLastCalledWith(workflows)
  })
})
