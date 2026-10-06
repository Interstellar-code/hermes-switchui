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
})
