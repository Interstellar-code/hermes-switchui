// @vitest-environment jsdom
/**
 * QA1 F4-3 — the TIMEOUT field's label must name the engine unit.
 *
 * The engine reads node `timeout:` as milliseconds
 * (~/.hermes/.../engine/nodes/bash.py: `timeout_raw / 1000.0`), but the
 * label said bare "TIMEOUT" while yaml-model docs claimed seconds — typing
 * 300 silently meant a 0.3s subprocess timeout. On ccdd3789 the accessible
 * label was "TIMEOUT".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NodeConfigPanel } from './node-config-panel'
import type { EditorNode } from './yaml-model'

afterEach(() => {
  cleanup()
})

function makeNode(partial: Partial<EditorNode>): EditorNode {
  return {
    id: 'bash-node',
    type: 'bash',
    phase: 'execute',
    dependsOn: [],
    body: 'echo hi',
    summary: 'echo hi',
    triggerRule: null,
    hasRetry: false,
    retryAttempts: null,
    timeout: 300,
    ...partial,
  }
}

function renderPanel(node: EditorNode) {
  return render(
    <NodeConfigPanel
      node={node}
      nodes={[node]}
      onRename={vi.fn()}
      onTypeChange={vi.fn()}
      onPhaseChange={vi.fn()}
      onBodyChange={vi.fn()}
      onAddDependency={vi.fn()}
      onRemoveDependency={vi.fn()}
      onTriggerChange={vi.fn()}
      onRetryChange={vi.fn()}
      onTimeoutChange={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
    />,
  )
}

describe('NodeConfigPanel TIMEOUT field (QA1 F4-3)', () => {
  it('labels the timeout field with the engine unit (MS)', () => {
    renderPanel(makeNode({}))
    const label = screen.getByText('TIMEOUT (MS)')
    expect(label.getAttribute('for')).toBe('wge-nto')
    expect(screen.queryByText(/^TIMEOUT$/)).toBeNull()
  })

  it('stores the typed value unchanged so the YAML matches the engine unit', () => {
    const onTimeoutChange = vi.fn()
    render(
      <NodeConfigPanel
        node={makeNode({})}
        nodes={[makeNode({})]}
        onRename={vi.fn()}
        onTypeChange={vi.fn()}
        onPhaseChange={vi.fn()}
        onBodyChange={vi.fn()}
        onAddDependency={vi.fn()}
        onRemoveDependency={vi.fn()}
        onTriggerChange={vi.fn()}
        onRetryChange={vi.fn()}
        onTimeoutChange={onTimeoutChange}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('TIMEOUT (MS)')
    fireEvent.change(input, { target: { value: '120000' } })
    expect(onTimeoutChange).toHaveBeenCalledWith(120000)
  })
})
