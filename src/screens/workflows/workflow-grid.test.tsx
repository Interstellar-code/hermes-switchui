// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowGrid, cleanDescription } from './workflow-grid'
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
    node_types: ['prompt', 'bash'],
    ...partial,
  }
}

describe('cleanDescription', () => {
  it('strips leading "Use when:" and whitespace', () => {
    expect(cleanDescription('Use when: doing a complete review')).toBe(
      'doing a complete review',
    )
    expect(cleanDescription('Use when doing a task')).toBe('doing a task')
    expect(cleanDescription('Already clean description')).toBe(
      'Already clean description',
    )
    expect(cleanDescription('')).toBe('')
    expect(cleanDescription(null)).toBe('')
  })
})

describe('WorkflowGrid', () => {
  it('renders loadError alert and calls onRetry when clicked', () => {
    const onRetry = vi.fn()
    const onSelect = vi.fn()

    renderWithClient(
      <WorkflowGrid
        workflows={[]}
        onSelect={onSelect}
        loadError="Workflow engine unavailable"
        onRetry={onRetry}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('Workflow engine unavailable')
    expect(screen.queryByText(/no workflows match/i)).toBeNull()

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders empty message when no loadError and workflows list is empty', () => {
    renderWithClient(<WorkflowGrid workflows={[]} onSelect={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByRole('heading', { name: /no workflows match/i }),
    ).toBeTruthy()
  })

  it('sorts by recently edited by default and renders stripped descriptions', () => {
    const now = Date.now()
    const w1 = makeWf({
      id: 'w1',
      name: 'Alpha Older',
      description: 'Use when: inspecting older things',
      updated_at: now - 100_000,
    })
    const w2 = makeWf({
      id: 'w2',
      name: 'Beta Newer',
      description: 'Use when: building newer things',
      updated_at: now,
    })

    const onSelect = vi.fn()
    renderWithClient(<WorkflowGrid workflows={[w1, w2]} onSelect={onSelect} />)

    // Check sort select default value
    const sortSelect =
      screen.getByLabelText<HTMLSelectElement>(/sort workflows/i)
    expect(sortSelect.value).toBe('recent')

    // Check that descriptions are stripped of "Use when:"
    expect(screen.getByText('inspecting older things')).toBeTruthy()
    expect(screen.getByText('building newer things')).toBeTruthy()
    expect(screen.queryByText(/^Use when:/)).toBeNull()

    // Test clicking EDIT calls onSelect
    const editButtons = screen.getAllByRole('button', { name: /^edit /i })
    fireEvent.click(editButtons[0])
    expect(onSelect).toHaveBeenCalled()
  })
})
