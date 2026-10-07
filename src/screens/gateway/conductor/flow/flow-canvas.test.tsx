// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildDag } from '../dag-model'
import FlowCanvas from './flow-canvas'

import type { ParsedWorkflow } from '@/screens/workflows/types'
import type { DagModel } from '../dag-model'

// Mock ResizeObserver for JSDOM
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const parsed: ParsedWorkflow = {
  name: 'Test',
  description: '',
  has_loop: false,
  has_approval: false,
  edges: [],
  required_inputs: [],
  optional_inputs: [],
  node_count: 2,
  nodes: [
    { id: 'a', label: 'a', type: 'prompt', depends_on: [] },
    { id: 'b', label: 'b', type: 'bash', depends_on: ['a'] },
  ],
}

const mockDag = buildDag(parsed)

describe('FlowCanvas editable mode', () => {
  it('renders canvas in editable mode with nodes and edges without throwing', () => {
    const onConnect = vi.fn()
    const onNodesDelete = vi.fn()
    const onEdgesDelete = vi.fn()
    const onDropNode = vi.fn()
    const onSelectionChange = vi.fn()

    const { container } = render(
      <FlowCanvas
        dag={mockDag}
        workflowId="test-wf"
        editable
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onDropNode={onDropNode}
        onSelectionChange={onSelectionChange}
      />,
    )

    expect(container.querySelector('.flow-host')).toBeTruthy()
  })
})
