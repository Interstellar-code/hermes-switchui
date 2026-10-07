// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WorkflowsTopBar, computeWorkflowStats } from './workflows-top-bar'
import type { WorkflowSummary } from './types'

let mockFeatures:
  | { features: Array<string>; schedulerAlive: boolean; profile: string | null }
  | undefined = undefined

vi.mock('./use-workflows', () => ({
  useWorkflowFeatures: () => ({ data: mockFeatures }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockFeatures = undefined
})

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
    ...partial,
  }
}

describe('computeWorkflowStats', () => {
  it('computes correct numbers for user, project, factory, approval, and 7d', () => {
    const now = Date.now()
    const fiveDaysAgo = now - 5 * 24 * 3600 * 1000
    const tenDaysAgo = now - 10 * 24 * 3600 * 1000

    const workflows: Array<WorkflowSummary> = [
      makeWf({
        id: 'w1',
        source: 'user',
        has_approval: true,
        updated_at: fiveDaysAgo,
      }),
      makeWf({
        id: 'w2',
        source: 'user',
        has_approval: false,
        updated_at: tenDaysAgo,
      }),
      makeWf({
        id: 'w3',
        source: 'project',
        has_approval: true,
        updated_at: fiveDaysAgo,
      }),
      makeWf({
        id: 'w4',
        source: 'bundled',
        has_approval: false,
        updated_at: tenDaysAgo,
      }),
      makeWf({
        id: 'w5',
        source: 'bundled',
        has_approval: true,
        updated_at: fiveDaysAgo,
      }),
    ]

    const stats = computeWorkflowStats(workflows)

    expect(stats.total).toBe(5)
    expect(stats.user).toBe(2)
    expect(stats.project).toBe(1)
    expect(stats.factory).toBe(2)
    expect(stats.withApproval).toBe(3)
    expect(stats.edited7d).toBe(3)
  })
})

describe('WorkflowsTopBar', () => {
  it('renders the real stat categories and numbers', () => {
    const now = Date.now()
    const workflows: Array<WorkflowSummary> = [
      makeWf({ id: 'w1', source: 'user', has_approval: true, updated_at: now }),
      makeWf({ id: 'w2', source: 'bundled', updated_at: now }),
      makeWf({ id: 'w3', source: 'project', updated_at: now }),
    ]

    render(<WorkflowsTopBar workflows={workflows} />)

    expect(screen.getAllByText('WORKFLOWS').length).toBeGreaterThan(0)
    expect(screen.getByText('USER')).toBeTruthy()
    expect(screen.getByText('PROJECT')).toBeTruthy()
    expect(screen.getByText('FACTORY')).toBeTruthy()
    expect(screen.getByText('WITH APPROVAL')).toBeTruthy()
    expect(screen.getByText('EDITED 7D')).toBeTruthy()
    // YAML ERRORS stat removed: no batch validation data exists
    expect(screen.queryByText('YAML ERRORS')).toBeNull()

    const statRegion = screen.getByRole('region', {
      name: /workflow statistics/i,
    })
    expect(statRegion.textContent).toContain('3') // total
    expect(statRegion.textContent).toContain('1') // user
  })

  it('hides the scheduler pill while the feature probe is unknown', () => {
    mockFeatures = undefined
    render(<WorkflowsTopBar workflows={[]} />)
    expect(screen.queryByText(/scheduler/)).toBeNull()
  })

  it('shows scheduler ok / down from real feature data, with profile', () => {
    mockFeatures = {
      features: ['validate'],
      schedulerAlive: true,
      profile: 'hermes-switch',
    }
    const { unmount } = render(<WorkflowsTopBar workflows={[]} />)
    expect(screen.getByText(/hermes-switch · scheduler ok/)).toBeTruthy()
    unmount()

    mockFeatures = {
      features: [],
      schedulerAlive: false,
      profile: null,
    }
    render(<WorkflowsTopBar workflows={[]} />)
    expect(screen.getByText(/scheduler down/)).toBeTruthy()
  })

  it('shows — for every stat while the engine is down instead of zeros', () => {
    render(<WorkflowsTopBar workflows={[]} engineDown />)
    const statRegion = screen.getByRole('region', {
      name: /workflow statistics/i,
    })
    const values = statRegion.querySelectorAll('.v')
    expect(values.length).toBe(6)
    for (const v of values) {
      expect(v.textContent).toBe('—')
    }
  })
})
