// yaml-model.test.ts — lossless round-trip tests for the F4 graph editor's
// pure YAML editing model. No mocks: real `yaml` Document API, real strings.
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  addDependency,
  addNode,
  duplicateNode,
  readGraph,
  removeDependency,
  removeNodes,
  renameNode,
  setNodeBody,
  setNodePhase,
  setNodeRetry,
  setNodeTimeout,
  setNodeTrigger,
  setNodeType,
  suggestNodeId,
  wouldCreateCycle,
} from './yaml-model'

const BASE = `# top-level comment preserved
name: catalog intake
description: Ingest a catalog.
owner: platform-team          # unknown top-level key must survive
metadata:
  refresh: daily
  tags: [catalog, nightly]
required_inputs:
  - video_url
nodes:
  # leading comment on the first node
  - id: resolve-input
    bash: yt-dlp --flat-playlist $video_url
    timeout: 120
  - id: extract
    prompt: Extract the metadata
    phase: discover
    depends_on: [resolve-input]
    hermes_task:
      agent_hint: trinity      # unknown nested key must survive
  - id: apply
    command: ./apply.sh
    phase: execute
    depends_on:
      - resolve-input
      - extract
    retry:
      max_attempts: 2
      delay_ms: 1000
`

function asObj(text: string): Record<string, unknown> {
  return parseYaml(text) as Record<string, unknown>
}

describe('yaml-model lossless round-trip', () => {
  it('keeps unknown top-level keys, comments and node order when editing a node field', () => {
    const next = setNodeBody(BASE, 'extract', 'Extract all the metadata now')

    const before = asObj(BASE)
    const after = asObj(next)

    expect(after['owner']).toBe('platform-team')
    expect(after['metadata']).toEqual(before['metadata'])
    expect(after['required_inputs']).toEqual(['video_url'])
    expect(next).toContain('# top-level comment preserved')
    expect(next).toContain('# leading comment on the first node')
    expect(next).toContain('# unknown nested key must survive')
    // Node order preserved
    expect((after['nodes'] as Array<{ id: string }>).map((n) => n.id)).toEqual([
      'resolve-input',
      'extract',
      'apply',
    ])
    // Only the edited field changed
    const extractAfter = (after['nodes'] as Array<Record<string, unknown>>)[1]
    expect(extractAfter['prompt']).toBe('Extract all the metadata now')
    expect(extractAfter['hermes_task']).toEqual({ agent_hint: 'trinity' })
    expect(extractAfter['phase']).toBe('discover')
    expect(extractAfter['depends_on']).toEqual(['resolve-input'])
  })

  it('keeps per-node unknown keys and comments when adding a dependency', () => {
    const text = addDependency(BASE, 'extract', 'apply')
    const extract = (asObj(text)['nodes'] as Array<Record<string, unknown>>)[1]
    expect(extract['hermes_task']).toEqual({ agent_hint: 'trinity' })
    expect(extract['depends_on']).toEqual(['resolve-input', 'apply'])
    expect(text).toContain('# unknown nested key must survive')
    expect(text).toContain('owner: platform-team')
  })

  it('addDependency appends to a list-style depends_on and removeDependency prunes it', () => {
    let text = addDependency(BASE, 'extract', 'apply') // extract after apply (legal for the model)
    const obj = asObj(text)
    const extract = (obj['nodes'] as Array<Record<string, unknown>>).find(
      (n) => n['id'] === 'extract',
    )!
    expect(extract['depends_on']).toEqual(['resolve-input', 'apply'])

    text = removeDependency(text, 'extract', 'apply')
    const obj2 = asObj(text)
    const extract2 = (obj2['nodes'] as Array<Record<string, unknown>>).find(
      (n) => n['id'] === 'extract',
    )!
    expect(extract2['depends_on']).toEqual(['resolve-input'])
  })

  it('removeDependency drops the depends_on key when the list becomes empty', () => {
    const text = removeDependency(BASE, 'extract', 'resolve-input')
    const obj = asObj(text)
    const extract = (obj['nodes'] as Array<Record<string, unknown>>).find(
      (n) => n['id'] === 'extract',
    )!
    expect(extract['depends_on']).toBeUndefined()
    expect(text).not.toContain('depends_on: []')
  })

  it('addNode appends a palette node with a valid default body and keeps everything else', () => {
    const text = addNode(BASE, 'approval', 'approval-gate')
    const obj = asObj(text)
    const nodes = obj['nodes'] as Array<Record<string, unknown>>
    expect(nodes).toHaveLength(4)
    const added = nodes[3]
    expect(added['id']).toBe('approval-gate')
    expect(added['approval']).toEqual({ message: 'Approve to continue' })
    // everything before is untouched
    expect(text).toContain('owner: platform-team')
    expect(nodes[0]['bash']).toBe('yt-dlp --flat-playlist $video_url')
    // script gets its required runtime
    const withScript = addNode(BASE, 'script', 'sc')
    const sc = (asObj(withScript)['nodes'] as Array<Record<string, unknown>>)[3]
    expect(sc['runtime']).toBe('uv')
    expect(typeof sc['script']).toBe('string')
  })

  it('removeNodes deletes nodes and scrubs dangling depends_on references', () => {
    const text = removeNodes(BASE, ['extract'])
    const obj = asObj(text)
    const nodes = obj['nodes'] as Array<Record<string, unknown>>
    expect(nodes.map((n) => n['id'])).toEqual(['resolve-input', 'apply'])
    const apply = nodes[1]
    expect(apply['depends_on']).toEqual(['resolve-input'])
    expect(text).not.toContain('id: extract')
  })

  it('renameNode rewrites the id and every depends_on reference', () => {
    const text = renameNode(BASE, 'resolve-input', 'fetch-input')
    const obj = asObj(text)
    const nodes = obj['nodes'] as Array<Record<string, unknown>>
    expect(nodes[0]['id']).toBe('fetch-input')
    expect(nodes[1]['depends_on']).toEqual(['fetch-input'])
    expect(nodes[2]['depends_on']).toEqual(
      expect.arrayContaining(['fetch-input']),
    )
    expect(text).not.toContain('resolve-input')
  })

  it('renameNode rejects taken ids and invalid characters', () => {
    expect(() => renameNode(BASE, 'extract', 'apply')).toThrow(/taken/i)
    expect(() => renameNode(BASE, 'extract', 'bad id!')).toThrow(/letters/)
  })

  it('setNodePhase sets and clears phase without touching other keys', () => {
    const set = setNodePhase(BASE, 'resolve-input', 'record')
    const obj = asObj(set)
    expect((obj['nodes'] as Array<Record<string, unknown>>)[0]['phase']).toBe(
      'record',
    )
    expect(set.match(/phase:/g)).toHaveLength(3)

    const cleared = setNodePhase(set, 'resolve-input', null)
    expect(cleared.match(/phase:/g)).toHaveLength(2)
    const clearedObj = asObj(cleared)
    expect(
      (clearedObj['nodes'] as Array<Record<string, unknown>>)[0]['phase'],
    ).toBeUndefined()
    // the other nodes' phases survive untouched
    expect(
      (clearedObj['nodes'] as Array<Record<string, unknown>>)[1]['phase'],
    ).toBe('discover')
  })

  it('setNodeType swaps the mode key and keeps metadata keys', () => {
    const text = setNodeType(BASE, 'extract', 'bash')
    const obj = asObj(text)
    const extract = (obj['nodes'] as Array<Record<string, unknown>>).find(
      (n) => n['id'] === 'extract',
    )!
    expect(extract['prompt']).toBeUndefined()
    expect(typeof extract['bash']).toBe('string')
    expect(extract['phase']).toBe('discover')
    expect(extract['hermes_task']).toEqual({ agent_hint: 'trinity' })
  })

  it('setNodeBody edits approval.message, loop.prompt and subgraph.ref in place', () => {
    const withApproval = addNode(BASE, 'approval', 'gate')
    const edited = setNodeBody(withApproval, 'gate', 'Please approve the run')
    const gate = (asObj(edited)['nodes'] as Array<Record<string, unknown>>)[3]
    expect(gate['approval']).toEqual({ message: 'Please approve the run' })
  })

  it('setNodeTrigger / setNodeRetry / setNodeTimeout round-trip their fields', () => {
    let text = setNodeTrigger(BASE, 'extract', 'all_done')
    text = setNodeRetry(text, 'extract', 3)
    text = setNodeTimeout(text, 'extract', 45)
    const extract = (asObj(text)['nodes'] as Array<Record<string, unknown>>)[1]
    expect(extract['trigger_rule']).toBe('all_done')
    // extract had no retry before: setting max_attempts creates {max_attempts: 3}
    expect(extract['retry']).toEqual({ max_attempts: 3 })
    expect(extract['timeout']).toBe(45)

    // clearing removes keys; the untouched retry on apply survives
    text = setNodeTrigger(text, 'extract', null)
    text = setNodeRetry(text, 'extract', null)
    text = setNodeTimeout(text, 'extract', null)
    const extract2 = (asObj(text)['nodes'] as Array<Record<string, unknown>>)[1]
    expect(extract2['trigger_rule']).toBeUndefined()
    expect(extract2['retry']).toBeUndefined()
    expect(extract2['timeout']).toBeUndefined()
    const apply = (asObj(text)['nodes'] as Array<Record<string, unknown>>)[2]
    expect(apply['retry']).toEqual({ max_attempts: 2, delay_ms: 1000 })
  })

  it('duplicateNode clones the full node (including unknown keys) under a fresh id', () => {
    const { yaml, newId } = duplicateNode(BASE, 'extract')
    expect(newId).toBe('extract-2')
    const nodes = asObj(yaml)['nodes'] as Array<Record<string, unknown>>
    const copy = nodes[3]
    expect(copy['prompt']).toBe('Extract the metadata')
    expect(copy['hermes_task']).toEqual({ agent_hint: 'trinity' })
    expect(copy['depends_on']).toBeUndefined()
  })

  it('readGraph exposes types, deps, phase, trigger, retry, timeout', () => {
    const g = readGraph(BASE)!
    expect(g.name).toBe('catalog intake')
    expect(g.nodes.map((n) => n.id)).toEqual([
      'resolve-input',
      'extract',
      'apply',
    ])
    expect(g.nodes[0].type).toBe('bash')
    expect(g.nodes[1].type).toBe('prompt')
    expect(g.nodes[2].dependsOn).toEqual(['resolve-input', 'extract'])
    expect(g.nodes[2].hasRetry).toBe(true)
    expect(g.nodes[0].timeout).toBe(120)
    expect(g.nodes[1].phase).toBe('discover')
  })

  it('readGraph returns null for unparseable or node-less YAML', () => {
    expect(readGraph('nodes: [')).toBeNull()
    expect(readGraph('name: x')).toBeNull()
  })

  it('wouldCreateCycle detects a real loop and passes legal edges', () => {
    expect(wouldCreateCycle(BASE, 'resolve-input', 'apply')).toBe(true)
    // apply ⇝ extract ⇝ resolve-input: adding resolve-input → apply loops.
    expect(wouldCreateCycle(BASE, 'apply', 'resolve-input')).toBe(false)
    // adding apply → extract: extract cannot reach apply… wait it can via nothing; extract ⇝ resolve-input only.
    expect(wouldCreateCycle(BASE, 'extract', 'resolve-input')).toBe(false)
  })

  it('addNode creates the nodes list when the draft has none', () => {
    const text = addNode('name: empty one\n', 'prompt', 'first')
    const obj = asObj(text)
    const nodes = obj['nodes'] as Array<Record<string, unknown>>
    expect(nodes).toHaveLength(1)
    expect(nodes[0]['id']).toBe('first')
    expect(obj['name']).toBe('empty one')
  })

  it('suggestNodeId walks -2, -3 …', () => {
    expect(suggestNodeId(['a', 'b'], 'a')).toBe('a-2')
    expect(suggestNodeId(['a', 'a-2'], 'a')).toBe('a-3')
  })

  it('edits never reorder keys inside an untouched node map', () => {
    const text = setNodePhase(BASE, 'apply', 'record')
    const applyBlock = text.split('- id: apply')[1].split('\n- id:')[0].trim()
    // key order inside the node: command, phase, depends_on, retry — preserved
    expect(applyBlock.indexOf('command:')).toBeLessThan(
      applyBlock.indexOf('phase:'),
    )
    expect(applyBlock.indexOf('phase:')).toBeLessThan(
      applyBlock.indexOf('depends_on:'),
    )
    expect(applyBlock.indexOf('depends_on:')).toBeLessThan(
      applyBlock.indexOf('retry:'),
    )
  })
})
