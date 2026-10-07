import { describe, expect, it } from 'vitest'
import { areNodesEqual, diffDraftNodes, diffWorkflowYaml } from './draft-diff'

describe('draft-diff', () => {
  describe('areNodesEqual', () => {
    it('returns true for deeply identical node objects', () => {
      const a = { id: 'n1', prompt: 'test', depends_on: ['a', 'b'] }
      const b = { id: 'n1', prompt: 'test', depends_on: ['a', 'b'] }
      expect(areNodesEqual(a, b)).toBe(true)
    })

    it('returns false when fields differ', () => {
      const a = { id: 'n1', prompt: 'test' }
      const b = { id: 'n1', prompt: 'different' }
      expect(areNodesEqual(a, b)).toBe(false)
    })
  })

  describe('diffDraftNodes', () => {
    it('detects added nodes when previous revision has none or fewer nodes', () => {
      const prev = [{ id: 'plan', prompt: 'plan work' }]
      const next = [
        { id: 'plan', prompt: 'plan work' },
        { id: 'execute', bash: 'run.sh' },
      ]
      const res = diffDraftNodes(prev, next)

      expect(res.added).toEqual(['execute'])
      expect(res.nodeStatus['execute']).toBe('added')
      expect(res.unchanged).toEqual(['plan'])
      expect(res.changed).toEqual([])
      expect(res.removed).toEqual([])
    })

    it('detects changed nodes when any field differs', () => {
      const prev = [{ id: 'node-1', prompt: 'initial prompt', phase: 'Plan' }]
      const next = [{ id: 'node-1', prompt: 'updated prompt', phase: 'Plan' }]
      const res = diffDraftNodes(prev, next)

      expect(res.changed).toEqual(['node-1'])
      expect(res.nodeStatus['node-1']).toBe('changed')
      expect(res.added).toEqual([])
      expect(res.unchanged).toEqual([])
      expect(res.removed).toEqual([])
    })

    it('detects unchanged nodes when all fields match', () => {
      const prev = [{ id: 'check', command: 'check.sh', skills: ['lint'] }]
      const next = [{ id: 'check', command: 'check.sh', skills: ['lint'] }]
      const res = diffDraftNodes(prev, next)

      expect(res.unchanged).toEqual(['check'])
      expect(res.nodeStatus['check']).toBe('unchanged')
      expect(res.added).toEqual([])
      expect(res.changed).toEqual([])
      expect(res.removed).toEqual([])
    })

    it('detects removed nodes when a node is deleted in revision N', () => {
      const prev = [
        { id: 'step-1', prompt: 'first' },
        { id: 'step-2', prompt: 'second' },
      ]
      const next = [{ id: 'step-1', prompt: 'first' }]
      const res = diffDraftNodes(prev, next)

      expect(res.removed).toEqual(['step-2'])
      expect(res.nodeStatus['step-2']).toBe('removed')
      expect(res.unchanged).toEqual(['step-1'])
      expect(res.added).toEqual([])
      expect(res.changed).toEqual([])
    })

    it('counts renamed-id as removed + added', () => {
      const prev = [{ id: 'old-node-id', prompt: 'do something' }]
      const next = [{ id: 'new-node-id', prompt: 'do something' }]
      const res = diffDraftNodes(prev, next)

      expect(res.removed).toEqual(['old-node-id'])
      expect(res.added).toEqual(['new-node-id'])
      expect(res.nodeStatus['old-node-id']).toBe('removed')
      expect(res.nodeStatus['new-node-id']).toBe('added')
      expect(res.changed).toEqual([])
      expect(res.unchanged).toEqual([])
    })

    it('handles null or empty previous revisions as all added', () => {
      const next = [
        { id: 'start', prompt: 'hello' },
        { id: 'end', bash: 'echo 1' },
      ]
      const res = diffDraftNodes(null, next)
      expect(res.added).toEqual(['start', 'end'])
      expect(res.changed).toEqual([])
      expect(res.unchanged).toEqual([])
      expect(res.removed).toEqual([])
    })
  })

  describe('diffWorkflowYaml', () => {
    it('diffs YAML strings correctly across revisions', () => {
      const yaml1 = `name: Wf
nodes:
  - id: n1
    prompt: p1
  - id: n2
    prompt: p2
`
      const yaml2 = `name: Wf
nodes:
  - id: n1
    prompt: p1-modified
  - id: n3
    prompt: p3
`
      const res = diffWorkflowYaml(yaml1, yaml2)
      expect(res.changed).toEqual(['n1'])
      expect(res.removed).toEqual(['n2'])
      expect(res.added).toEqual(['n3'])
      expect(res.unchanged).toEqual([])
    })
  })
})
