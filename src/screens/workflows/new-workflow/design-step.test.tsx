// @vitest-environment jsdom
// DESIGN step with the REAL graph editor and the REAL FlowCanvas (React Flow
// with jsdom layout shims). Only `fetch` is mocked. No router in context:
// the embedded mode must not touch the router.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { readGraph } from '../graph-editor/yaml-model'
import { installReactFlowShims } from '../graph-editor/react-flow-test-shims'
import { DesignStep } from './design-step'
import type { WizardIssueState } from './use-wizard-validation'

const YAML = `name: Intake # keep
description: test
x-top: kept
nodes:
  - id: fetch
    bash: echo fetch
    x-node: kept
  - id: extract
    prompt: Extract
    depends_on: [fetch]
`

beforeAll(installReactFlowShims)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const tick = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })

async function renderDesign(
  initial = YAML,
  issues: WizardIssueState = { kind: 'unavailable', reason: 'test' },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('/api/workflow-features')
              ? { features: [], schedulerAlive: false, profile: null }
              : {},
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  )
  const changes: Array<string> = []
  let setYaml: (y: string) => void = () => {}
  function Host() {
    const [yaml, set] = useState(initial)
    setYaml = set
    return (
      // The wizard dialog hosts the editor: its shortcuts must still work.
      <div role="dialog" style={{ width: '1000px', height: '600px' }}>
        <DesignStep
          issues={issues}
          yaml={yaml}
          onChange={(y) => {
            changes.push(y)
            set(y)
          }}
        />
      </div>
    )
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  )
  for (let i = 0; i < 10; i++) {
    await tick()
    if (utils.container.querySelector('.react-flow__node')) break
  }
  return {
    ...utils,
    changes,
    setYaml: async (y: string) => {
      await act(async () => {
        setYaml(y)
        await Promise.resolve()
      })
    },
  }
}

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

const last = (changes: Array<string>) => changes[changes.length - 1] ?? ''

describe('wizard DESIGN step (embedded graph editor)', () => {
  it('renders the real canvas and palette with no SAVE/DISCARD and no leave guard', async () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const { container, changes } = await renderDesign()
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(2)
    expect(screen.getByLabelText('Node palette')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^SAVE$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^DISCARD$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /WORKFLOW$/ })).toBeNull()

    // dirty edit: still no unsaved chip and no beforeunload guard
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    await tick()
    expect(changes.length).toBe(1)
    expect(screen.queryByText(/UNSAVED/)).toBeNull()
    expect(
      addListener.mock.calls.filter(([type]) => type === 'beforeunload'),
    ).toEqual([])
  })

  it('palette add reaches onChange; unknown keys and comments survive', async () => {
    const { changes } = await renderDesign()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    await tick()
    const yaml = last(changes)
    expect(readGraph(yaml)!.nodes.map((n) => n.id)).toEqual([
      'fetch',
      'extract',
      'bash-node',
    ])
    expect(yaml).toContain('name: Intake # keep')
    expect(yaml).toContain('x-top: kept')
    expect(yaml).toContain('x-node: kept')
  })

  it('Delete on a canvas node removes it (and its edge) via onChange', async () => {
    const { container, changes } = await renderDesign()
    fireEvent.click(
      container.querySelector('.react-flow__node[data-id="fetch"]')!,
    )
    await pressDelete()
    await tick()
    const graph = readGraph(last(changes))!
    expect(graph.nodes.map((n) => n.id)).toEqual(['extract'])
    expect(graph.nodes[0].dependsOn).toEqual([])
    expect(
      container.querySelector('.react-flow__node[data-id="fetch"]'),
    ).toBeNull()
  })

  it('undo (Cmd/Ctrl+Z inside the hosting dialog) reports the previous yaml', async () => {
    const { changes } = await renderDesign()
    fireEvent.click(screen.getByRole('button', { name: /Add bash node/i }))
    await tick()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await tick()
    expect(last(changes)).toBe(YAML)
  })

  it('adopts a yaml changed by the host (e.g. CONFIGURE)', async () => {
    const { container, setYaml } = await renderDesign()
    await setYaml(`${YAML}  - id: notify\n    bash: echo done\n`)
    await tick()
    expect(
      container.querySelector('.react-flow__node[data-id="notify"]'),
    ).toBeTruthy()
  })

  it('offers the one-click fix for an engine error that blocks Next', async () => {
    const bad = YAML.replace('Extract', 'Extract for $INPUTS.chat_id')
    const { changes } = await renderDesign(bad, {
      kind: 'ready',
      errors: [
        {
          line: 9,
          col: null,
          code: 'undeclared_input',
          message: "node 'extract' references undeclared input 'chat_id'",
          node_id: 'extract',
        },
      ],
      warnings: [],
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Declare input chat_id' }),
    )
    await tick()
    expect(last(changes)).toContain('inputs:\n  - name: chat_id')
    expect(readGraph(last(changes))!.nodes).toHaveLength(2)
  })
})
