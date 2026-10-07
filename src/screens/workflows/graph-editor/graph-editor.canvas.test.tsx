// @vitest-environment jsdom
// Editor + the REAL FlowCanvas (no canvas mock): Delete on the canvas goes
// through React Flow into the YAML draft and the undo history.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
import { installReactFlowShims } from './react-flow-test-shims'
import type * as ApiClientModule from '../api-client'

const DEF_YAML = `name: Intake
nodes:
  - id: fetch
    bash: echo fetch
  - id: extract
    prompt: Extract
    depends_on: [fetch]
  - id: notify
    bash: echo done
`

vi.mock('../api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>()
  return {
    ...actual,
    getWorkflowDefinitionParsed: vi.fn(() =>
      Promise.resolve({
        definition: {
          id: 'intake',
          name: 'Intake',
          description: null,
          source: 'user',
          scope_path: null,
          yaml: DEF_YAML,
          checksum: 'c1',
          version: '1',
          tags: null,
          created_at: 0,
          updated_at: 0,
          node_count: 3,
          run_count: 0,
          last_used_at: null,
        },
        parsed: null,
      }),
    ),
    getWorkflowFeatures: vi.fn(() =>
      Promise.resolve({ features: [], schedulerAlive: true, profile: 'p' }),
    ),
  }
})

beforeAll(installReactFlowShims)
afterEach(cleanup)

const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })

async function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({}),
    history: createMemoryHistory({ initialEntries: ['/workflows'] }),
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <div style={{ width: '1000px', height: '700px' }}>
          <WorkflowGraphEditor workflowId="intake" onExit={() => {}} />
        </div>
      </RouterContextProvider>
    </QueryClientProvider>,
  )
  // query + lazy canvas chunk
  for (let i = 0; i < 10; i++) {
    await tick()
    if (utils.container.querySelector('.react-flow__node')) break
  }
  fireEvent.click(screen.getByRole('button', { name: /YAML MIRROR/i }))
  return utils
}

const mirror = (c: HTMLElement) =>
  c.querySelector('.wge-mirror-code')?.textContent ?? ''

async function pressDelete() {
  await act(async () => {
    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })
    await new Promise((r) => setTimeout(r, 0))
  })
  await act(async () => {
    fireEvent.keyUp(document, { key: 'Delete', code: 'Delete' })
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('graph editor with the real canvas', () => {
  it('Del on a node removes it (and its edge) as one undo step', async () => {
    const { container } = await renderEditor()
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)

    fireEvent.click(
      container.querySelector('.react-flow__node[data-id="fetch"]')!,
    )
    await pressDelete()
    await tick()

    const graph = readGraph(mirror(container))!
    expect(graph.nodes.map((n) => n.id)).toEqual(['extract', 'notify'])
    expect(graph.nodes[0].dependsOn).toEqual([])
    expect(container.querySelector('.react-flow__node[data-id="fetch"]')).toBe(
      null,
    )
    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirror(container)).toBe(DEF_YAML)
  })

  it('select + Del on an edge removes the depends_on entry once', async () => {
    const { container } = await renderEditor()
    fireEvent.click(container.querySelector('.react-flow__edge')!)
    await pressDelete()
    await tick()

    const graph = readGraph(mirror(container))!
    expect(graph.nodes.map((n) => n.id)).toEqual(['fetch', 'extract', 'notify'])
    expect(graph.nodes[1].dependsOn).toEqual([])
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirror(container)).toBe(DEF_YAML)
  })

  it('node + unrelated selected edge in one keypress is one undo step', async () => {
    const { container } = await renderEditor()
    fireEvent.click(
      container.querySelector('.react-flow__node[data-id="notify"]')!,
    )
    // hold React Flow's multi-select key (Control in jsdom) and add the edge
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Control', code: 'ControlLeft' })
      await new Promise((r) => setTimeout(r, 0))
    })
    fireEvent.click(container.querySelector('.react-flow__edge')!, {
      ctrlKey: true,
    })
    await act(async () => {
      fireEvent.keyUp(document, { key: 'Control', code: 'ControlLeft' })
      await new Promise((r) => setTimeout(r, 0))
    })
    await pressDelete()
    await tick()

    const graph = readGraph(mirror(container))!
    expect(graph.nodes.map((n) => n.id)).toEqual(['fetch', 'extract'])
    expect(graph.nodes[1].dependsOn).toEqual([])
    expect(screen.getAllByText('1 UNSAVED CHANGE').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }))
    expect(mirror(container)).toBe(DEF_YAML)
  })
})
