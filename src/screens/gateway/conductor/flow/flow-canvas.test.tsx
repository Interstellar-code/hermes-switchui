// @vitest-environment jsdom
// Real React Flow (no canvas mock), with jsdom layout shims so nodes measure
// and edges render.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildDag } from '../dag-model'
import FlowCanvas from './flow-canvas'
import type { ParsedWorkflow } from '@/screens/workflows/types'
import { installReactFlowShims } from '@/screens/workflows/graph-editor/react-flow-test-shims'

beforeAll(installReactFlowShims)

afterEach(cleanup)

const parsed: ParsedWorkflow = {
  name: 'Test',
  description: '',
  has_loop: false,
  has_approval: false,
  edges: [],
  required_inputs: [],
  optional_inputs: [],
  node_count: 3,
  nodes: [
    { id: 'a', label: 'a', type: 'prompt', depends_on: [] },
    { id: 'b', label: 'b', type: 'bash', depends_on: ['a'] },
    { id: 'c', label: 'c', type: 'bash', depends_on: [] },
  ],
}

async function renderCanvas(props: Partial<Parameters<typeof FlowCanvas>[0]>) {
  const handlers = {
    onConnect: vi.fn(),
    onDelete: vi.fn(),
    onSelectionChange: vi.fn(),
  }
  const utils = render(
    <div style={{ width: '800px', height: '600px' }}>
      <FlowCanvas
        dag={buildDag(parsed)}
        workflowId="test-wf"
        editable
        {...handlers}
        {...props}
      />
    </div>,
  )
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  return { ...utils, ...handlers }
}

function nodeEl(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`.react-flow__node[data-id="${id}"]`)!
}

async function pressDelete() {
  // keydown and keyup in separate acts: React Flow deletes from an effect
  // on the pressed state, which a same-batch keyup would cancel.
  await act(async () => {
    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })
    await new Promise((r) => setTimeout(r, 0))
  })
  await act(async () => {
    fireEvent.keyUp(document, { key: 'Delete', code: 'Delete' })
    await new Promise((r) => setTimeout(r, 0))
  })
}

// Multi-select: hold React Flow's selection key (Control in jsdom, not macOS).
async function selectWithModifier(el: Element) {
  await act(async () => {
    fireEvent.keyDown(document, { key: 'Control', code: 'ControlLeft' })
    await new Promise((r) => setTimeout(r, 0))
  })
  fireEvent.click(el, { ctrlKey: true })
  await act(async () => {
    fireEvent.keyUp(document, { key: 'Control', code: 'ControlLeft' })
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('FlowCanvas editable mode (real React Flow)', () => {
  it('renders nodes and edges', async () => {
    const { container } = await renderCanvas({})
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3)
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
  })

  it('Del on a selected node calls onDelete once, without its edge, and keeps it until the dag changes', async () => {
    const { container, onDelete } = await renderCanvas({})
    fireEvent.click(nodeEl(container, 'b'))
    await pressDelete()
    expect(onDelete).toHaveBeenCalledTimes(1)
    // a>b touches the deleted node: removeNodes scrubs it
    expect(onDelete).toHaveBeenCalledWith({ nodeIds: ['b'], edges: [] })
    // not removed locally — the parent's YAML change rebuilds the canvas
    expect(nodeEl(container, 'b')).toBeTruthy()
  })

  it('select + Del on an edge calls onDelete exactly once', async () => {
    const { container, onDelete } = await renderCanvas({})
    const edge = container.querySelector('.react-flow__edge')!
    fireEvent.click(edge)
    expect(edge.classList.contains('selected')).toBe(true)
    await pressDelete()
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith({
      nodeIds: [],
      edges: [{ source: 'a', target: 'b' }],
    })
    // still drawn until the dag (YAML) drops it
    expect(container.querySelectorAll('.react-flow__edge')).toHaveLength(1)
  })

  it('node + unrelated selected edge in one keypress → one onDelete', async () => {
    const { container, onDelete } = await renderCanvas({})
    fireEvent.click(nodeEl(container, 'c'))
    await selectWithModifier(container.querySelector('.react-flow__edge')!)
    expect(nodeEl(container, 'c').classList.contains('selected')).toBe(true)
    await pressDelete()
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith({
      nodeIds: ['c'],
      edges: [{ source: 'a', target: 'b' }],
    })
  })

  it('connect (click source handle, then target handle) calls onConnect', async () => {
    const { container, onConnect } = await renderCanvas({})
    const source = nodeEl(container, 'c').querySelector(
      '.react-flow__handle.source',
    )!
    const target = nodeEl(container, 'a').querySelector(
      '.react-flow__handle.target',
    )!
    const prev = document.elementFromPoint
    document.elementFromPoint = () => target
    try {
      fireEvent.click(source)
      fireEvent.click(target)
    } finally {
      document.elementFromPoint = prev
    }
    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onConnect).toHaveBeenCalledWith({ source: 'c', target: 'a' })
  })

  it('palette drop calls onDropNode with the type and a flow position', async () => {
    const onDropNode = vi.fn()
    const { container } = await renderCanvas({ onDropNode })
    const host = container.querySelector('.flow-host')!
    fireEvent.drop(host, {
      clientX: 100,
      clientY: 80,
      dataTransfer: {
        getData: (k: string) =>
          k === 'application/x-switchui-wf-node' ? 'approval' : '',
      },
    })
    expect(onDropNode).toHaveBeenCalledTimes(1)
    expect(onDropNode.mock.calls[0][0]).toBe('approval')
    expect(onDropNode.mock.calls[0][1]).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
    })
  })

  it('Conductor (non-editable) mode ignores Delete', async () => {
    const { container, onDelete } = await renderCanvas({
      editable: false,
    })
    fireEvent.click(nodeEl(container, 'b'))
    await pressDelete()
    expect(onDelete).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3)
  })
})
