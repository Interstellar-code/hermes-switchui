import { describe, expect, it } from 'vitest'
import { summariseWorkflowYaml } from './workflow-yaml-summary'

describe('summariseWorkflowYaml', () => {
  it('extracts node_count and node_types for typed nodes', () => {
    const yaml = `
name: Typed Workflow
nodes:
  - id: n1
    type: approval
  - id: n2
    type: script
  - id: n3
    type: loop
  - id: n4
    type: custom-agent
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.node_count).toBe(4)
    expect(summary.node_types).toEqual([
      'approval',
      'script',
      'loop',
      'custom-agent',
    ])
    expect(summary.has_approval).toBe(true)
    expect(summary.has_loop).toBe(false)
  })

  it('extracts node_count and node_types for key-style nodes according to candidate precedence', () => {
    const yaml = `
name: Key Style Workflow
nodes:
  - id: n1
    approval:
      message: "Confirm please"
  - id: n2
    loop:
      over: items
  - id: n3
    cancel: true
  - id: n4
    script: "process()"
  - id: n5
    command: "echo test"
  - id: n6
    prompt: "Generate summary"
  - id: n7
    bash: "ls -la"
  - id: n8
    subgraph:
      ref: sub-1
  - id: n9
    router:
      routes: []
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.node_count).toBe(9)
    expect(summary.node_types).toEqual([
      'approval',
      'loop',
      'cancel',
      'script',
      'command',
      'prompt',
      'bash',
      'subgraph',
      'router',
    ])
    expect(summary.has_approval).toBe(true)
    expect(summary.has_loop).toBe(true)
  })

  it('defaults node type to prompt when no candidate key or type is found', () => {
    const yaml = `
name: Default Type
nodes:
  - id: n1
    unknown_key: value
  - id: n2
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.node_count).toBe(2)
    expect(summary.node_types).toEqual(['prompt', 'prompt'])
  })

  it('prioritizes type over candidate keys', () => {
    const yaml = `
name: Type Precedence
nodes:
  - id: n1
    type: custom
    command: "echo 1"
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.node_count).toBe(1)
    expect(summary.node_types).toEqual(['custom'])
  })

  it('handles mixed workflows with typed, key-style, and fallback nodes', () => {
    const yaml = `
name: Mixed Workflow
nodes:
  - id: step-a
    type: approval
  - id: step-b
    command: npm test
  - id: step-c
    something_else: true
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.node_count).toBe(3)
    expect(summary.node_types).toEqual(['approval', 'command', 'prompt'])
    expect(summary.has_approval).toBe(true)
  })

  it('sets has_approval via type: approval', () => {
    const yaml = `
name: Approval by Type
nodes:
  - id: gate
    type: approval
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.has_approval).toBe(true)
  })

  it('sets has_approval via approval key', () => {
    const yaml = `
name: Approval by Key
nodes:
  - id: gate
    approval:
      prompt: "Are you sure?"
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.has_approval).toBe(true)
  })

  it('returns false for has_approval when no approval node exists', () => {
    const yaml = `
name: No Approval
nodes:
  - id: run
    command: echo hi
`
    const summary = summariseWorkflowYaml(yaml)
    expect(summary.has_approval).toBe(false)
  })

  it('returns safe fallback for invalid YAML', () => {
    const invalidYaml = `
name: Broken
nodes:
  - : [unbalanced
`
    const summary = summariseWorkflowYaml(invalidYaml)
    expect(summary).toEqual({
      has_loop: false,
      has_approval: false,
      required_inputs: [],
      optional_inputs: [],
      node_count: 0,
      node_types: [],
    })
  })

  it('handles empty or missing nodes list safely', () => {
    const summary = summariseWorkflowYaml('name: Empty')
    expect(summary.node_count).toBe(0)
    expect(summary.node_types).toEqual([])
  })
})
