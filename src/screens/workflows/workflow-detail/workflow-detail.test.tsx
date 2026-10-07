// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkflowEngineUnavailableError } from '../api-client'
import { WorkflowDetail } from './workflow-detail'
import type { ReactNode } from 'react'
import type { WorkflowDefinitionRow } from '../api-client'
import type { ParsedWorkflow } from '../types'

const mockDefinition: WorkflowDefinitionRow = {
  id: 'youtube-catalog-intake',
  name: 'YouTube catalog intake',
  description: 'YouTube roundup catalog ingestion.',
  source: 'user',
  scope_path: '~/.hermes/profiles/hermes-switch',
  yaml: `name: YouTube catalog intake\ndescription: YouTube roundup catalog ingestion.\nrequired_inputs:\n  - video_url\nnodes:\n  - id: resolve-input\n    bash: echo 1\n`,
  checksum: '271ad435c4b123456789',
  version: '2',
  tags: JSON.stringify(['catalog', 'youtube']),
  created_at: 1700000000,
  updated_at: 1700001000,
  node_count: 1,
  run_count: 6,
  last_used_at: null,
  required_inputs: ['video_url'],
  optional_inputs: [],
}

const mockParsed: ParsedWorkflow = {
  name: 'YouTube catalog intake',
  description: 'YouTube roundup catalog ingestion.',
  nodes: [
    {
      id: 'resolve-input',
      label: 'resolve-input',
      type: 'bash',
      phase: 'discover',
      depends_on: null,
    },
  ],
  edges: [],
  has_loop: false,
  has_approval: false,
  required_inputs: ['video_url'],
  optional_inputs: [],
  node_count: 1,
}

let mockWorkflowData: {
  definition: WorkflowDefinitionRow
  parsed: ParsedWorkflow
} | null = {
  definition: mockDefinition,
  parsed: mockParsed,
}
let mockIsLoading = false
let mockError: Error | null = null
let mockFeatures: Array<string> = []
let mockValidationResult: unknown = null
let mockValidationError: Error | null = null
let mockVersions: Array<unknown> | null = null
let mockVersionsLoading = false
let mockVersionDetail: unknown = null

const deleteMutateMock = vi.fn()
const resetMutateMock = vi.fn()
const duplicateMutateMock = vi.fn()

// QA1 F3-3: the detail must validate WITHOUT its own id — recording calls
// lets tests assert the second hook argument is undefined.
const validateCalls: Array<Array<unknown>> = []

vi.mock('../use-workflows', () => ({
  parseTags: (raw: string | null) => {
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : []
    } catch {
      return []
    }
  },
  useWorkflowParsed: () => ({
    data: mockWorkflowData,
    isLoading: mockIsLoading,
    error: mockError,
    refetch: vi.fn(),
  }),
  useWorkflowFeatures: () => ({
    data: {
      features: mockFeatures,
      schedulerAlive: true,
      profile: 'hermes-switch',
    },
  }),
  useValidateWorkflowDefinition: (...args: Array<unknown>) => {
    validateCalls.push(args)
    return {
      data: mockValidationResult,
      isLoading: false,
      error: mockValidationError,
    }
  },
  useWorkflowDefinitionVersions: () => ({
    data: mockVersions,
    isLoading: mockVersionsLoading,
    error: null,
  }),
  useWorkflowDefinitionVersion: () => ({
    data: mockVersionDetail,
    isLoading: false,
  }),
  useDeleteWorkflowDefinition: () => ({
    mutate: deleteMutateMock,
    isPending: false,
  }),
  useResetWorkflowDefinitionToFactory: () => ({
    mutate: resetMutateMock,
    isPending: false,
  }),
  useUpsertWorkflowDefinition: () => ({
    mutate: duplicateMutateMock,
    isPending: false,
  }),
}))

// Router Link stub: detail Conductor links must not need a router context.
vi.mock('@tanstack/react-router', async () => {
  const React = await import('react')
  return {
    Link: (props: { to?: string; children?: ReactNode; className?: string }) =>
      React.createElement('a', { href: props.to ?? '#' }, props.children),
  }
})

let lastFlowCanvasProps: Record<string, unknown> | null = null
vi.mock('@/screens/gateway/conductor/mission-canvas', async () => {
  const React = await import('react')
  return {
    FlowCanvas: (props: Record<string, unknown>) => {
      lastFlowCanvasProps = props
      return React.createElement(
        'div',
        { 'data-testid': 'flow-canvas' },
        `FlowCanvas for ${String(props['workflowId'])}`,
      )
    },
    graphLoading: React.createElement('div', null, 'Loading graph…'),
  }
})

vi.mock('@/screens/gateway/conductor/use-conductor-queries', () => ({
  useConductorScheduled: () => ({
    data: {
      schedulerAlive: true,
      profile: 'hermes-switch',
      scheduled: [
        {
          id: 'sched-1',
          workflowId: 'youtube-catalog-intake',
          cron: '0 9 * * 1',
          scheduleLabel: 'cron 0 9 * * 1',
          nextRunAt: 1750000000000,
          enabled: true,
        },
      ],
    },
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockWorkflowData = { definition: mockDefinition, parsed: mockParsed }
  mockIsLoading = false
  mockError = null
  mockFeatures = []
  mockValidationResult = null
  mockValidationError = null
  mockVersions = null
  mockVersionsLoading = false
  mockVersionDetail = null
  lastFlowCanvasProps = null
  validateCalls.length = 0
})

describe('WorkflowDetail', () => {
  it('renders default tabs; SCHEDULES only with the cron_schedule feature', () => {
    mockFeatures = []
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: /^OVERVIEW/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^GRAPH/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^INPUTS/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^YAML/i })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /^VERSIONS/i })).toBeNull()
    // no cron_schedule feature → tab hidden (never invented)
    expect(screen.queryByRole('tab', { name: /^SCHEDULES/i })).toBeNull()
  })

  it('switches tabs when clicked', () => {
    mockFeatures = ['cron_schedule']
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    // Switch to YAML
    fireEvent.click(screen.getByRole('tab', { name: /^YAML/i }))
    expect(screen.getByText(/COPY YAML/i)).toBeTruthy()

    // Switch to INPUTS
    fireEvent.click(screen.getByRole('tab', { name: /^INPUTS/i }))
    expect(screen.getByText('DECLARED WORKFLOW INPUTS (1)')).toBeTruthy()
    expect(screen.getByText('video_url')).toBeTruthy()

    // Switch to SCHEDULES
    fireEvent.click(screen.getByRole('tab', { name: /^SCHEDULES/i }))
    expect(
      screen.getByText(/SCHEDULES FOR YOUTUBE-CATALOG-INTAKE/i),
    ).toBeTruthy()
    expect(screen.getByText('sched-1')).toBeTruthy()
  })

  it('shows run count from def.run_count (not an unbounded run query)', () => {
    mockWorkflowData = {
      definition: { ...mockDefinition, run_count: 6 },
      parsed: mockParsed,
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    expect(screen.getAllByText(/6 runs in Conductor/).length).toBeGreaterThan(0)
  })

  it('renders the graph tab read-only: neutral FlowCanvas, no layout store writes', () => {
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    // overview canvas
    expect(lastFlowCanvasProps?.['neutral']).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: /^GRAPH/i }))
    expect(lastFlowCanvasProps?.['neutral']).toBe(true)
  })

  it('shows validation unavailable when the engine validate call errors', () => {
    mockFeatures = ['validate']
    mockValidationError = new Error('boom')
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/Validation unavailable — the workflow engine/i),
    ).toBeTruthy()
    // the fake ✓ rows are gone
    expect(screen.queryByText(/parses · schema ok/i)).toBeNull()
    expect(screen.queryByText(/all resolve/i)).toBeNull()
  })

  it('delete failure surfaces an error and the dialog closes (no silent state)', () => {
    mockWorkflowData = {
      definition: { ...mockDefinition, source: 'user' },
      parsed: mockParsed,
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /DELETE/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete workflow' }))
    expect(deleteMutateMock).toHaveBeenCalledTimes(1)

    const opts = deleteMutateMock.mock.calls[0][1] as {
      onError: (e: Error & { serverError?: string }) => void
    }
    act(() => {
      opts.onError(
        Object.assign(new Error('nope'), { serverError: 'engine down' }),
      )
    })
    expect(screen.getByText(/Delete failed — engine down/i)).toBeTruthy()
    expect(screen.queryByText('Delete workflow?')).toBeNull()
  })

  it('shows DELETE for user workflow and requires confirmation before deletion', () => {
    mockWorkflowData = {
      definition: { ...mockDefinition, source: 'user' },
      parsed: mockParsed,
    }

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    const deleteBtn = screen.getByRole('button', { name: /DELETE/i })
    expect(deleteBtn).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^RESET$/i })).toBeNull()

    // Click DELETE opens confirmation dialog
    fireEvent.click(deleteBtn)
    expect(screen.getByText('Delete workflow?')).toBeTruthy()
    expect(deleteMutateMock).not.toHaveBeenCalled()

    // Confirm in dialog
    const confirmBtn = screen.getByRole('button', { name: 'Delete workflow' })
    fireEvent.click(confirmBtn)
    expect(deleteMutateMock).toHaveBeenCalledWith(
      'youtube-catalog-intake',
      expect.any(Object),
    )
  })

  it('shows RESET instead of DELETE for factory (bundled) workflows and enables it when modified', () => {
    mockWorkflowData = {
      definition: {
        ...mockDefinition,
        source: 'bundled',
        user_modified: 1,
      },
      parsed: mockParsed,
    }

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    const resetBtn = screen.getByRole('button', { name: /^RESET$/i })
    expect(resetBtn).toBeTruthy()
    expect(screen.queryByRole('button', { name: /DELETE/i })).toBeNull()
    expect(resetBtn.hasAttribute('disabled')).toBe(false)

    // Click RESET opens confirmation dialog
    fireEvent.click(resetBtn)
    expect(screen.getByText('Reset to factory default?')).toBeTruthy()
    expect(resetMutateMock).not.toHaveBeenCalled()

    // Confirm in dialog
    const confirmBtn = screen.getByRole('button', { name: 'Reset workflow' })
    fireEvent.click(confirmBtn)
    expect(resetMutateMock).toHaveBeenCalledWith(
      'youtube-catalog-intake',
      expect.any(Object),
    )
  })

  it('disables RESET button if factory workflow has not been modified', () => {
    mockWorkflowData = {
      definition: {
        ...mockDefinition,
        source: 'bundled',
        user_modified: 0,
      },
      parsed: mockParsed,
    }

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    const resetBtn = screen.getByRole('button', { name: /^RESET$/i })
    expect(resetBtn).toBeTruthy()
    expect(resetBtn.hasAttribute('disabled')).toBe(true)
  })

  it('hides VERSIONS tab and validation card without their backend features', () => {
    mockFeatures = []
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.queryByRole('tab', { name: /^VERSIONS/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'VALIDATION' })).toBeNull()
  })

  it('shows VERSIONS tab and validation card when features are listed', () => {
    mockFeatures = ['definition_versions', 'validate']
    mockValidationResult = {
      ok: false,
      errors: [
        {
          code: 'cycle',
          line: 12,
          message: 'Cycle detected: step-1 -> step-2 -> step-1',
        },
      ],
      warnings: [
        {
          code: 'risky_shell',
          line: 5,
          message: 'Bash node uses unrestricted shell access',
        },
      ],
      id_available: true,
    }

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    // VERSIONS tab is now visible
    expect(screen.getByRole('tab', { name: /^VERSIONS/i })).toBeTruthy()

    // VALIDATION card is now visible with errors & warnings listed
    expect(screen.getByRole('heading', { name: 'VALIDATION' })).toBeTruthy()
    expect(screen.getByText(/1 error\(s\)/i)).toBeTruthy()
    expect(
      screen.getByText('Cycle detected: step-1 -> step-2 -> step-1'),
    ).toBeTruthy()
    expect(
      screen.getByText('Bash node uses unrestricted shell access'),
    ).toBeTruthy()
  })

  it('renders loading state when isLoading is true', () => {
    mockIsLoading = true
    mockWorkflowData = null

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.getByText(/LOADING WORKFLOW…/i)).toBeTruthy()
  })

  it('renders not-found state when 404 occurs', () => {
    mockWorkflowData = null
    const notFoundError = new Error('getWorkflowDefinitionParsed failed (404)')
    Object.assign(notFoundError, { status: 404 })
    mockError = notFoundError

    render(
      <WorkflowDetail
        workflowId="non-existent-wf"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.getByText('WORKFLOW NOT FOUND')).toBeTruthy()
    expect(screen.getByText('non-existent-wf')).toBeTruthy()
  })

  it('renders engine-down state when workflow engine is unavailable', () => {
    mockWorkflowData = null
    mockError = new WorkflowEngineUnavailableError(
      'Workflow engine unavailable',
    )

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.getByText('WORKFLOW ENGINE DOWN')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Retry connection/i }),
    ).toBeTruthy()
  })

  it('triggers EDIT GRAPH and RUN callbacks', () => {
    const onEditGraph = vi.fn()
    const onOpenLaunchWizard = vi.fn()

    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={onEditGraph}
        onOpenLaunchWizard={onOpenLaunchWizard}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /EDIT GRAPH/i }))
    expect(onEditGraph).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /RUN…/i }))
    expect(onOpenLaunchWizard).toHaveBeenCalledWith('youtube-catalog-intake')
  })
})

describe('WorkflowDetail VERSIONS (definition_versions feature)', () => {
  const VERSIONS = [
    {
      checksum: '271ad435c4b123456789',
      version: null,
      saved_at: 1700001000,
      source: 'save',
      node_count: 1,
      size_bytes: 120,
      in_use_by_runs: 2,
    },
    {
      checksum: 'd0f8062d1a2b3c4d5e6f',
      version: null,
      saved_at: 1699999000,
      source: 'import',
      node_count: 1,
      size_bytes: 90,
      in_use_by_runs: 0,
    },
  ]

  it('renders the real versions list with count, source chips and CURRENT marker', () => {
    mockFeatures = ['definition_versions']
    mockVersions = VERSIONS
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.getByText('2')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^VERSIONS/i }))

    expect(screen.getByText('271ad435')).toBeTruthy()
    expect(screen.getByText('d0f8062d')).toBeTruthy()
    expect(screen.getByText('CURRENT')).toBeTruthy()
    expect(screen.getByText('SAVE')).toBeTruthy()
    expect(screen.getByText('IMPORT')).toBeTruthy()
    expect(screen.getByText('in use by 2')).toBeTruthy()
    expect(screen.queryByText('DIFF')).toBeNull()
    expect(screen.queryByText('DIFF CURRENT')).toBeNull()
  })

  it('VIEW opens that version’s YAML read-only; BACK returns to the list', () => {
    mockFeatures = ['definition_versions']
    mockVersions = VERSIONS
    mockVersionDetail = {
      ...VERSIONS[0],
      yaml: 'name: YouTube catalog intake\nnodes:\n  - id: resolve-input\n    bash: echo 1\n',
      parsed: { id: 'youtube-catalog-intake', nodes: [] },
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: /^VERSIONS/i }))
    const viewButtons = screen.getAllByRole('button', { name: 'VIEW' })
    fireEvent.click(viewButtons[0])

    expect(screen.getByText(/read-only/)).toBeTruthy()
    expect(screen.getByText(/resolve-input/)).toBeTruthy()
    expect(screen.getByText(/in use by 2 runs · CURRENT/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /← ALL VERSIONS/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /← ALL VERSIONS/i }))
    expect(screen.getByText('271ad435')).toBeTruthy()
  })

  it('shows an empty-state message when there are no snapshots', () => {
    mockFeatures = ['definition_versions']
    mockVersions = []
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: /^VERSIONS/i }))
    expect(screen.getByText(/No stored versions yet/i)).toBeTruthy()
  })

  it('renders validation issues with null line/col without a line marker', () => {
    mockFeatures = ['validate']
    mockValidationResult = {
      ok: false,
      errors: [
        {
          code: 'cycle',
          line: null,
          col: null,
          message: 'cycle: a -> b -> a',
        },
      ],
      warnings: [],
      id_available: null,
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )

    expect(screen.getByText('cycle: a -> b -> a')).toBeTruthy()
    expect(screen.queryByText('(L')).toBeNull()
  })

  // QA1 F3-3: the detail used to validate WITH its own id, so every saved
  // workflow collided with itself and showed a false id_taken error.
  it('validates the definition without passing its own id (QA1 F3-3)', () => {
    mockFeatures = ['validate']
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    expect(validateCalls.length).toBeGreaterThan(0)
    for (const args of validateCalls) {
      expect(args[1]).toBeUndefined()
    }
    expect(validateCalls[0][0]).toBe(mockDefinition.yaml)
  })

  // QA1 F3-4: no run data from the API → "— runs", never an invented 0.
  it('renders an em dash run count when the definition has no run_count (QA1 F3-4)', () => {
    const { run_count: _omit, ...noRuns } = mockDefinition
    mockWorkflowData = {
      definition: noRuns as WorkflowDefinitionRow,
      parsed: mockParsed,
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    const links = screen.getAllByRole('link', { name: /runs in Conductor/i })
    expect(links.some((l) => /— runs/.test(l.textContent))).toBe(true)
    expect(links.some((l) => /0 runs/.test(l.textContent))).toBe(false)
  })

  it('renders the real run count when the API provides one (QA1 F3-4)', () => {
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    const links = screen.getAllByRole('link', { name: /runs in Conductor/i })
    expect(links.some((l) => /6 runs/.test(l.textContent))).toBe(true)
  })

  // QA1 F3-5: a project-source workflow showed a USER chip; the header must
  // show the real origin.
  it('labels a project-source workflow PROJECT, not USER (QA1 F3-5)', () => {
    mockWorkflowData = {
      definition: { ...mockDefinition, source: 'project' },
      parsed: mockParsed,
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    expect(screen.getByText('PROJECT')).toBeTruthy()
    expect(screen.queryByText('USER')).toBeNull()
  })

  // QA1 F1-3/F3-5: a null version is unknown, not v1.
  it('renders an em dash version chip for a null version (QA1 F1-3)', () => {
    mockWorkflowData = {
      definition: { ...mockDefinition, version: null },
      parsed: mockParsed,
    }
    render(
      <WorkflowDetail
        workflowId="youtube-catalog-intake"
        onBack={vi.fn()}
        onEditGraph={vi.fn()}
      />,
    )
    expect(screen.getAllByText(/^—$/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/^v1$/)).toHaveLength(0)
  })
})
