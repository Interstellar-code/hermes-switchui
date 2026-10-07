// @vitest-environment jsdom
// graph-editor.test.tsx — F4 component tests. Only the network layer
// (api-client functions) and the React Flow canvas shell are mocked; the
// yaml-model, history reducer, panels and editor logic are the real code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { WorkflowGraphEditor } from './graph-editor'
import { readGraph } from './yaml-model'
import type { WorkflowDefinitionRow } from '../api-client'
import type { ParsedWorkflow } from '../types'
import type * as ApiClientModule from '../api-client'

const DEF_YAML = `name: YouTube catalog intake
description: YouTube roundup catalog ingestion.
nodes:
  - id: resolve-input
    bash: yt-dlp --flat-playlist
  - id: extract
    prompt: Extract the metadata
    depends_on: [resolve-input]
`

const mockDefinition: WorkflowDefinitionRow = {
  id: 'youtube-catalog-intake',
  name: 'YouTube catalog intake',
  description: 'YouTube roundup catalog ingestion.',
  source: 'user',
  scope_path: null,
  yaml: DEF_YAML,
  checksum: 'cksum-1',
  version: '2',
  tags: null,
  created_at: 1700000000,
  updated_at: 1700001000,
  node_count: 2,
  run_count: 6,
  last_used_at: null,
}

const mockParsed: ParsedWorkflow = {
  name: 'YouTube catalog intake',
  description: 'YouTube roundup catalog ingestion.',
  nodes: [
    {
      id: 'resolve-input',
      label: 'resolve-input',
      type: 'bash',
      depends_on: [],
    },
    {
      id: 'extract',
      label: 'extract',
      type: 'prompt',
      depends_on: ['resolve-input'],
    },
  ],
  edges: [],
  has_loop: false,
  has_approval: false,
  required_inputs: [],
  optional_inputs: [],
  node_count: 2,
}

const mockUpsert = vi.fn()
const mockValidate = vi.fn()

vi.mock('../api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return {
    ...actual,
    getWorkflowDefinitionParsed: vi.fn(() =>
      Promise.resolve({
        definition: mockDefinition,
        parsed: mockParsed,
      }),
    ),
    getWorkflowFeatures: vi.fn(() =>
      Promise.resolve({
        features: [] as Array<string>,
        schedulerAlive: true,
        profile: 'hermes-switch',
      }),
    ),
    validateWorkflowDefinition: (...args: Array<unknown>) =>
      mockValidate(...args),
    upsertWorkflowDefinition: (...args: Array<unknown>) => mockUpsert(...args),
  }
})

// Canvas shell stub: renders the dag and drives the real editable callbacks.
const connectSpy = vi.fn()
vi.mock('@/screens/gateway/conductor/mission-canvas', async () => {
  const React = await import('react')
  return {
    FlowCanvas: (props: {
      dag: { nodes: Array<{ id: string }>; edges: Array<[string, string]> }
      editable?: boolean
      onConnect?: (c: { source: string; target: string }) => void
      onDelete?: (d: {
        nodeIds: Array<string>
        edges: Array<{ source: string; target: string }>
      }) => void
      onDropNode?: (t: string, p: { x: number; y: number }) => void
      onSelectionChange?: (ids: Array<string>) => void
    }) => (
      <div
        data-testid="flow-canvas"
        data-editable={props.editable ? 'yes' : 'no'}
      >
        <ul>
          {props.dag.nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                data-testid={`select-${n.id}`}
                aria-label={`canvas select ${n.id}`}
                onClick={() => props.onSelectionChange?.([n.id])}
              >
                {n.id}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          data-testid="stub-connect"
          onClick={() => {
            const nodes = props.dag.nodes
            const source = nodes[nodes.length - 1].id
            const target = nodes[0].id
            connectSpy(source, target)
            props.onConnect?.({ source, target })
          }}
        >
          CONNECT LAST→FIRST
        </button>
        <button
          type="button"
          data-testid="stub-delete-node"
          onClick={() => {
            const nodes = props.dag.nodes
            props.onDelete?.({
              nodeIds: [nodes[nodes.length - 1].id],
              edges: [],
            })
          }}
        >
          DELETE LAST NODE
        </button>
        <button
          type="button"
          data-testid="stub-delete-edge"
          onClick={() => {
            if (props.dag.edges.length === 0) return
            const [src, dst] = props.dag.edges[0]
            props.onDelete?.({
              nodeIds: [],
              edges: [{ source: src, target: dst }],
            })
          }}
        >
          DELETE FIRST EDGE
        </button>
        <button
          type="button"
          data-testid="stub-drop"
          onClick={() => props.onDropNode?.('approval', { x: 100, y: 100 })}
        >
          DROP APPROVAL
        </button>
      </div>
    ),
    graphLoading: React.createElement('div', null, 'Loading graph…'),
  }
})

function renderEditor(
  props: Partial<Parameters<typeof WorkflowGraphEditor>[0]> = {},
) {
  const onExit = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  // The editor's useBlocker needs a router in context.
  const router = createRouter({
    routeTree: createRootRoute({}),
    history: createMemoryHistory({ initialEntries: ['/workflows'] }),
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <WorkflowGraphEditor
          workflowId="youtube-catalog-intake"
          onExit={onExit}
          {...props}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  )
  return { ...utils, onExit, client }
}

function mirrorYaml(container: HTMLElement): string {
  return container.querySelector('.wge-mirror-code')?.textContent ?? ''
}

function mirrorGraph(container: HTMLElement) {
  return readGraph(mirrorYaml(container))!
}

function selectedPanelId(container: HTMLElement): string {
  return container.querySelector('.wge-cfg-id')?.textContent ?? ''
}

function openMirror() {
  fireEvent.click(screen.getByRole('button', { name: /YAML MIRROR/i }))
}

async function renderReady(props = {}) {
  const utils = renderEditor(props)
  // Fake timers stall RTL polling; flush microtasks + the query promise.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  expect(screen.getByText('GRAPH · EDITING')).toBeTruthy()
  return utils
}

describe('WorkflowGraphEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(async () => {
    vi.useRealTimers()
    cleanup()
    vi.clearAllMocks()
    mockValidate.mockReset()
    mockUpsert.mockReset()
    const { getWorkflowFeatures } = await import('../api-client')
    ;(getWorkflowFeatures as ReturnType<typeof vi.fn>).mockResolvedValue({
      features: [] as Array<string>,
      schedulerAlive: true,
      profile: 'hermes-switch',
    })
  })

  it('renders the palette, toolbar and canvas once the definition loads', async () => {
    const { container } = await renderReady()
    expect(screen.getByLabelText('Node palette')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Add approval node/i }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /^SAVE$/i })).toBeTruthy()
    expect(container.querySelector('[data-editable="yes"]')).toBeTruthy()
    // client lint of the pristine definition: valid
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(screen.getByText(/VALID · no errors/i)).toBeTruthy()
  })

  it('adds a node from the palette, marks unsaved changes and selects it', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Add approval node/i }))

    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)
    expect(selectedPanelId(container)).toBe('approval-node')
    openMirror()
    expect(mirrorYaml(container)).toContain('message: Approve to continue')
    // lossless: untouched parts survive
    expect(mirrorYaml(container)).toContain('yt-dlp --flat-playlist')
  })

  it('adds a node with A after the selected node and wires depends_on', async () => {
    const { container } = await renderReady()
    fireEvent.click(
      screen.getByRole('button', { name: 'canvas select extract' }),
    )
    fireEvent.keyDown(window, { key: 'a' })

    expect(selectedPanelId(container)).toBe('prompt-node')
    openMirror()
    const graph = mirrorGraph(container)
    expect(graph.nodes.map((n) => n.id)).toContain('prompt-node')
    expect(graph.nodes.find((n) => n.id === 'prompt-node')!.dependsOn).toEqual([
      'extract',
    ])
  })

  it('connect wires depends_on, delete edge removes it', async () => {
    const { container } = await renderReady()
    // stub connects LAST→FIRST: resolve-input gains depends_on: [extract]
    fireEvent.click(screen.getByTestId('stub-connect'))
    openMirror()
    expect(
      mirrorGraph(container).nodes.find((n) => n.id === 'resolve-input')!
        .dependsOn,
    ).toEqual(['extract'])

    // now remove that edge (it became the first depends_on edge)
    fireEvent.click(screen.getByTestId('stub-delete-edge'))
    expect(
      mirrorGraph(container).nodes.find((n) => n.id === 'resolve-input')!
        .dependsOn,
    ).toEqual([])
  })

  it('deletes the selected node and scrubs dangling references', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByTestId('stub-delete-node'))
    openMirror()
    const graph = mirrorGraph(container)
    expect(graph.nodes.map((n) => n.id)).toEqual(['resolve-input'])
    expect(graph.nodes[0].dependsOn).toEqual([])
  })

  it('survives deleting every node: empty canvas, palette re-adds, lint flags it', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByTestId('stub-delete-node'))
    fireEvent.click(screen.getByTestId('stub-delete-node'))
    expect(
      screen.getByText(/No nodes in the draft — add one from the palette/i),
    ).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    // client lint: no_nodes is an error → save blocked
    const save = screen.getByRole('button', { name: /^SAVE$/i })
    expect(save.hasAttribute('disabled')).toBe(true)

    // palette still works on the empty draft (nodes list recreated)
    fireEvent.click(screen.getByRole('button', { name: /Add prompt node/i }))
    openMirror()
    expect(mirrorYaml(container)).toContain('id: prompt-node')
    expect(selectedPanelId(container)).toBe('prompt-node')
  })

  it('undo and redo restore previous drafts (toolbar + Cmd+Z)', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    openMirror()
    expect(mirrorYaml(container)).toContain('id: bash-node')

    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirrorYaml(container)).not.toContain('id: bash-node')
    expect(screen.queryByText(/UNSAVED/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Redo/i }))
    expect(mirrorYaml(container)).toContain('id: bash-node')

    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(mirrorYaml(container)).not.toContain('id: bash-node')
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })
    expect(mirrorYaml(container)).toContain('id: bash-node')
  })

  it('disables save while the client lint reports errors (cycle)', async () => {
    await renderReady()
    // CONNECT LAST→FIRST creates resolve-input → extract on top of the
    // existing extract → resolve-input: a cycle the client lint flags.
    fireEvent.click(screen.getByTestId('stub-connect'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(screen.getByText(/1 ERROR/i)).toBeTruthy()
    const save = screen.getByRole('button', { name: /^SAVE$/i })
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(save.getAttribute('title')).toContain('Fix 1 error')
  })

  it('shows engine validation issues with null line/col and blocks save', async () => {
    const { getWorkflowFeatures } = await import('../api-client')
    ;(getWorkflowFeatures as ReturnType<typeof vi.fn>).mockResolvedValue({
      features: ['validate'],
      schedulerAlive: true,
      profile: 'p',
    })
    mockValidate.mockResolvedValue({
      ok: false,
      errors: [
        {
          line: null,
          col: null,
          code: 'cycle',
          message: 'Cycle in depends_on',
          node_id: 'extract',
        },
      ],
      warnings: [
        {
          line: 3,
          col: 1,
          code: 'risky_shell',
          message: 'sudo',
          node_id: 'resolve-input',
        },
      ],
      id_available: null,
    })

    const { container } = await renderReady()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(mockValidate).toHaveBeenCalledWith(DEF_YAML, undefined)
    expect(screen.getByText(/1 ERROR · 1 WARNING/i)).toBeTruthy()
    expect(screen.getByText(/Cycle in depends_on/i)).toBeTruthy()
    const save = screen.getByRole('button', { name: /^SAVE$/i })
    expect(save.hasAttribute('disabled')).toBe(true)
    // clicking the node ref in the panel focuses the node
    fireEvent.click(screen.getByRole('button', { name: 'extract' }))
    expect(selectedPanelId(container)).toBe('extract')
  })

  it('saves with expected_checksum and exits to the detail page', async () => {
    const { onExit } = await renderReady()
    mockUpsert.mockResolvedValue({
      definition: { ...mockDefinition, version: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))

    const save = screen.getByRole('button', { name: /^SAVE$/i })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    expect(save.hasAttribute('disabled')).toBe(false)
    await act(async () => {
      fireEvent.click(save)
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      id: 'youtube-catalog-intake',
      expected_checksum: 'cksum-1',
    })
    const savedYaml = mockUpsert.mock.calls[0][0]!.yaml as string
    expect(savedYaml).toContain('id: bash-node')
    expect(savedYaml).toContain('yt-dlp --flat-playlist')
  })

  it('409 conflict offers reload and overwrite (overwrite drops expected_checksum)', async () => {
    const { onExit } = await renderReady()
    let call = 0
    mockUpsert.mockImplementation((input: { expected_checksum?: string }) => {
      call += 1
      if (call === 1) {
        return Promise.reject(
          Object.assign(new Error('checksum mismatch'), {
            status: 409,
            code: 'conflict',
            serverError: 'Definition changed elsewhere',
          }),
        )
      }
      expect(input.expected_checksum).toBeUndefined()
      return Promise.resolve({
        definition: { ...mockDefinition, version: '3' },
      })
    })
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^SAVE$/i }))
      await vi.advanceTimersByTimeAsync(20)
    })

    expect(
      screen.getByRole('alertdialog', { name: /CHANGED ELSEWHERE/i }),
    ).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /OVERWRITE/i }))
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
  })

  it('refetch with a new checksum while dirty does not move baseline: save still sends original checksum and hits 409 path', async () => {
    const { client, onExit } = await renderReady()
    // Make draft dirty
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))

    // Someone else saves: the server now holds cksum-2. A real background
    // refetch brings that checksum into the query cache while we are dirty.
    const { getWorkflowDefinitionParsed } = await import('../api-client')
    const fetchDef = getWorkflowDefinitionParsed as ReturnType<typeof vi.fn>
    fetchDef.mockResolvedValue({
      definition: { ...mockDefinition, checksum: 'cksum-2' },
      parsed: mockParsed,
    })
    const callsBefore = fetchDef.mock.calls.length
    await act(async () => {
      await client.invalidateQueries()
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(fetchDef.mock.calls.length).toBeGreaterThan(callsBefore)

    // Server: compare-and-swap on the checksum it currently holds.
    mockUpsert.mockImplementation((input: { expected_checksum?: string }) =>
      input.expected_checksum === 'cksum-2'
        ? Promise.resolve({ definition: { ...mockDefinition, version: '3' } })
        : Promise.reject(
            Object.assign(new Error('checksum mismatch'), {
              status: 409,
              code: 'conflict',
              serverError: 'Definition changed elsewhere',
            }),
          ),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^SAVE$/i }))
      await vi.advanceTimersByTimeAsync(20)
    })

    // The draft was based on cksum-1: the save must hit the conflict path,
    // not silently overwrite with the refetched checksum.
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      expected_checksum: 'cksum-1',
    })
    expect(onExit).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: /CHANGED ELSEWHERE/i }),
    ).toBeTruthy()
    expect(screen.getByText(/the other change will be lost/i)).toBeTruthy()
  })

  it('blocks save with a reason when the definition has no checksum', async () => {
    const { getWorkflowDefinitionParsed } = await import('../api-client')
    ;(
      getWorkflowDefinitionParsed as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      definition: { ...mockDefinition, checksum: undefined },
      parsed: mockParsed,
    })
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450)
    })
    const save = screen.getByRole('button', { name: /^SAVE$/i })
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(save.getAttribute('title')).toMatch(/no checksum/i)
    expect(screen.getByText(/SAVE BLOCKED/)).toBeTruthy()
  })

  it('typing after a structural edit is its own undo step', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    const body = container.querySelector(
      '.wge-cfg textarea',
    ) as HTMLTextAreaElement
    fireEvent.change(body, { target: { value: 'echo one' } })
    fireEvent.change(body, { target: { value: 'echo one two' } })
    openMirror()
    expect(mirrorYaml(container)).toContain('bash: echo one two')

    // undo 1: the whole typing run, the added node stays
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirrorYaml(container)).toContain('id: bash-node')
    expect(mirrorYaml(container)).not.toContain('echo one')
    // undo 2: the add itself
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirrorYaml(container)).not.toContain('id: bash-node')
  })

  it('typing "300" into TIMEOUT is one undo step', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    const timeout = container.querySelector('#wge-nto') as HTMLInputElement
    for (const value of ['3', '30', '300']) {
      fireEvent.change(timeout, { target: { value } })
    }
    openMirror()
    expect(mirrorYaml(container)).toContain('timeout: 300')

    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirrorYaml(container)).not.toContain('timeout:')
    expect(mirrorYaml(container)).toContain('id: bash-node')
  })

  it('deleting a node with its edges is one undo step', async () => {
    const { container } = await renderReady()
    // canvas batch: the node plus the edge touching it (FlowCanvas drops the
    // edge; the editor gets a single removeNodes edit)
    fireEvent.click(screen.getByTestId('stub-delete-node'))
    openMirror()
    expect(mirrorGraph(container).nodes.map((n) => n.id)).toEqual([
      'resolve-input',
    ])
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirrorYaml(container)).toBe(DEF_YAML)
    expect(screen.queryByText(/UNSAVED/)).toBeNull()
  })

  it('warns about $id.output references left dangling by a delete', async () => {
    const { getWorkflowDefinitionParsed } = await import('../api-client')
    ;(
      getWorkflowDefinitionParsed as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      definition: {
        ...mockDefinition,
        yaml: DEF_YAML.replace(
          'Extract the metadata',
          'Extract $resolve-input.output',
        ),
      },
      parsed: mockParsed,
    })
    await renderReady()
    expect(screen.queryByText(/DANGLING OUTPUT/)).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'canvas select resolve-input' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /DELETE NODE/i }))
    expect(
      screen.getByText(/extract uses \$resolve-input\.output/),
    ).toBeTruthy()
  })

  it('leave guard blocks exit while dirty and proceeds after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onExit } = await renderReady()
    // clean draft: leaves immediately without a confirm
    fireEvent.click(screen.getByRole('button', { name: '← WORKFLOW' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    fireEvent.click(screen.getByRole('button', { name: '← WORKFLOW' }))
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 unsaved change'),
    )
    expect(onExit).toHaveBeenCalledTimes(1)

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '← WORKFLOW' }))
    expect(onExit).toHaveBeenCalledTimes(2)
    confirmSpy.mockRestore()
  })

  it('discards via the confirm dialog', async () => {
    const { container } = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    openMirror()
    expect(mirrorYaml(container)).toContain('id: bash-node')

    confirmDiscardFlow()
    expect(mirrorYaml(container)).not.toContain('id: bash-node')
    expect(screen.queryByText(/UNSAVED/)).toBeNull()
  })
})

function confirmDiscardFlow() {
  fireEvent.click(screen.getByRole('button', { name: /^DISCARD$/i }))
  fireEvent.click(screen.getByRole('button', { name: /Discard changes/i }))
}
