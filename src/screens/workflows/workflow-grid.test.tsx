// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowGrid, cleanDescription } from './workflow-grid'
import type { ReactNode } from 'react'
import type { WorkflowSummary } from './types'

// Router Link stub: Conductor links must not need a router context.
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

  it('shows "No workflows yet" on a fresh install (hasAnyWorkflows=false)', () => {
    renderWithClient(
      <WorkflowGrid
        workflows={[]}
        onSelect={vi.fn()}
        hasAnyWorkflows={false}
      />,
    )
    expect(
      screen.getByRole('heading', { name: /no workflows yet/i }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('heading', { name: /no workflows match/i }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: /new workflow/i })).toBeTruthy()
  })

  it('counts hidden subgraphs from the unfiltered list, not the filtered one', () => {
    const w = makeWf({ id: 'w1', name: 'Only One' })
    renderWithClient(
      <WorkflowGrid workflows={[w]} onSelect={vi.fn()} subgraphCount={2} />,
    )
    expect(screen.getByText(/\+2 subgraphs hidden/i)).toBeTruthy()
  })

  it('EDIT opens the graph editor (onEdit) while OPEN selects the detail page', () => {
    const w = makeWf({ id: 'w1', name: 'Dual Buttons' })
    const onSelect = vi.fn()
    const onEdit = vi.fn()
    renderWithClient(
      <WorkflowGrid workflows={[w]} onSelect={onSelect} onEdit={onEdit} />,
    )

    const editBtn = screen.getAllByRole('button', {
      name: /Edit Dual Buttons/i,
    })
    fireEvent.click(editBtn[editBtn.length - 1])
    expect(onEdit).toHaveBeenCalledWith('w1')
    expect(onSelect).not.toHaveBeenCalled()

    const openBtns = screen.getAllByRole('button', { name: /^OPEN$/i })
    fireEvent.click(openBtns[openBtns.length - 1])
    expect(onSelect).toHaveBeenCalledWith('w1')
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('renders no invented validity or last-run state on cards', () => {
    const w = makeWf({ id: 'w1', name: 'Honest Card', run_count: 3 })
    renderWithClient(<WorkflowGrid workflows={[w]} onSelect={vi.fn()} />)
    expect(screen.queryByText(/✓ valid/i)).toBeNull()
    expect(screen.queryByText(/last run ✓/i)).toBeNull()
    expect(screen.queryByText(/✓/)).toBeNull()
    expect(screen.getByText(/3 runs · Conductor →/i)).toBeTruthy()
  })

  // QA1 F1-2: the list API ships no run data — the card must show "—",
  // never an invented "never run" (or "0 runs").
  it('shows an em dash for run data when the API omits run_count (QA1 F1-2)', () => {
    const w = makeWf({ id: 'w1', name: 'Unknown Runs' })
    delete (w as Partial<WorkflowSummary>).run_count
    renderWithClient(<WorkflowGrid workflows={[w]} onSelect={vi.fn()} />)
    expect(screen.queryByText(/never run/i)).toBeNull()
    expect(screen.queryByText(/0 runs/i)).toBeNull()
    expect(screen.getAllByText(/^—$/).length).toBeGreaterThan(0)
  })

  it('shows "never run" only when the API explicitly says 0 runs (QA1 F1-2)', () => {
    const w = makeWf({ id: 'w1', name: 'Zero Runs', run_count: 0 })
    renderWithClient(<WorkflowGrid workflows={[w]} onSelect={vi.fn()} />)
    expect(screen.getByText(/never run/i)).toBeTruthy()
  })

  // QA1 F1-3: a null version is unknown, not v1.
  it('shows an em dash version for null and the real version otherwise (QA1 F1-3)', () => {
    renderWithClient(
      <WorkflowGrid
        workflows={[
          makeWf({ id: 'w1', name: 'No Version' }),
          makeWf({ id: 'w2', name: 'Versioned', version: '2' }),
        ]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/— · edited /i)).toBeTruthy()
    expect(screen.queryByText(/v1 · edited /i)).toBeNull()
    expect(screen.getByText(/v2 · edited /i)).toBeTruthy()
  })

  // QA1 F1-6: user_modified must not relabel a user-source row as MODIFIED.
  it('labels the real origin: USER wins over user_modified (QA1 F1-6)', () => {
    renderWithClient(
      <WorkflowGrid
        workflows={[
          makeWf({
            id: 'w1',
            name: 'User Modified',
            source: 'user',
            user_modified: 1,
          }),
          makeWf({ id: 'w2', name: 'Project One', source: 'project' }),
          makeWf({
            id: 'w3',
            name: 'Tweaked Factory',
            source: 'bundled',
            user_modified: 1,
          }),
        ]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByText('USER').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PROJECT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('MODIFIED').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('FACTORY')).toHaveLength(0)
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
