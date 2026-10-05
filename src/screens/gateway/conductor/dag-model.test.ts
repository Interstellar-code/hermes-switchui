/**
 * Fixtures in __fixtures__ are trimmed captures (config_preview shortened) of
 * GET /api/workflow-definitions/:id/parsed and GET /api/workflow-runs/:id from
 * the live dev server on 2026-10-04.
 */
import { describe, expect, it } from 'vitest'
import { agentCount, buildDag, classifyTier, loopBadge } from './dag-model'
import improveLoop from './__fixtures__/parsed-agent-improve-loop.json'
import loopDag from './__fixtures__/parsed-archon-test-loop-dag.json'
import validatePr from './__fixtures__/parsed-archon-validate-pr.json'
import runSessions from './__fixtures__/run-sessions.json'
import improveLoopRuns from './__fixtures__/node-runs-agent-improve-loop-paused.json'
import type { RunSessions } from '@/server/workflow-engine/interface'
import type { ParsedWorkflow } from '@/screens/workflows/types'
import type { DagNodeRun } from './dag-model'

const parsed = (x: unknown) => x as ParsedWorkflow
const byId = (dag: ReturnType<typeof buildDag>, id: string) =>
  dag.nodes.find((n) => n.id === id)!

describe('buildDag — skeleton is the definition', () => {
  it.each([
    ['agent-improve-loop', improveLoop],
    ['archon-test-loop-dag', loopDag],
    ['archon-validate-pr', validatePr],
  ])('%s: rendered node/edge counts equal the definition', (_id, def) => {
    const dag = buildDag(parsed(def))
    expect(dag.nodes).toHaveLength(def.node_count)
    expect(dag.edges).toHaveLength(def.edges.length)
    expect(dag.hiddenCount).toBe(0)
  })

  it('node_runs for a subset of nodes (depends_on: null) do not change the shape', () => {
    // Real rows: every node_run has depends_on: null; only 6 of 9 nodes ran.
    const runs: Array<DagNodeRun> = improveLoopRuns
    const dag = buildDag(parsed(improveLoop), runs)
    expect(dag.nodes).toHaveLength(9)
    expect(dag.edges).toHaveLength(11)
    expect(byId(dag, 'approval').status).toBe('paused')
    expect(byId(dag, 'analyze').status).toBe('completed')
    expect(byId(dag, 'analyze').startedAt).toBe(
      Date.parse('2026-08-03T07:36:41.819Z'),
    )
    expect(byId(dag, 'measure').status).toBe('idle')
    expect(byId(dag, 'measure').startedAt).toBeNull()
  })

  it('tolerates depends_on: null on definition nodes (falls back to parsed.edges)', () => {
    const def = parsed(structuredClone(improveLoop))
    for (const n of def.nodes) n.depends_on = null
    const dag = buildDag(def)
    expect(dag.edges).toHaveLength(11)
  })

  it('layers come from the longest path', () => {
    const dag = buildDag(parsed(improveLoop))
    expect(byId(dag, 'check-staleness').layer).toBe(0)
    expect(byId(dag, 'measure').layer).toBe(7)
    // depends on check-staleness (0) and measure (7) → longest path wins
    expect(byId(dag, 'summarize').layer).toBe(8)
    expect(dag.layerCount).toBe(9)
  })
})

describe('stages (D3)', () => {
  it('YAML phase wins; approval is always REVIEW', () => {
    const dag = buildDag(parsed(improveLoop))
    expect(byId(dag, 'check-staleness').stage).toBe('PLAN') // Discover
    expect(byId(dag, 'analyze').stage).toBe('EXECUTE') // Execute
    expect(byId(dag, 'load-report').stage).toBe('REPORT') // Report
    expect(byId(dag, 'approval').phase).toBe('Report')
    expect(byId(dag, 'approval').stage).toBe('REVIEW')
  })

  it('no ROUTE pill without a router; pills aggregate node status', () => {
    const dag = buildDag(parsed(improveLoop), improveLoopRuns)
    expect(dag.stages.map((s) => s.stage)).toEqual([
      'PLAN',
      'EXECUTE',
      'REVIEW',
      'REPORT',
    ])
    const pill = (s: string) => dag.stages.find((p) => p.stage === s)!
    expect(pill('PLAN').status).toBe('done')
    expect(pill('REVIEW').status).toBe('waiting')
    expect(pill('REVIEW').nodeIds).toEqual(['approval'])
  })

  it('renders only stages that have at least one node', () => {
    const def = parsed(improveLoop)
    const dag = buildDag({
      ...def,
      nodes: def.nodes.filter((n) => n.id !== 'approval'),
    })
    expect(dag.stages.map((s) => s.stage)).not.toContain('REVIEW')
  })

  it('derives from type/position when phase is missing; ROUTE only with a router', () => {
    const def: ParsedWorkflow = {
      ...parsed(loopDag),
      nodes: [
        { id: 'a', type: 'prompt', depends_on: [] },
        { id: 'r', type: 'router', depends_on: ['a'] },
        { id: 'b', type: 'bash', depends_on: ['r'] },
        { id: 'c', type: 'prompt', depends_on: ['b'] },
      ],
      edges: [],
      node_count: 4,
    }
    const dag = buildDag(def)
    expect(dag.nodes.map((n) => n.stage)).toEqual([
      'PLAN',
      'ROUTE',
      'EXECUTE',
      'REPORT',
    ])
    expect(dag.stages.map((s) => s.stage)).toContain('ROUTE')
  })
})

describe('layering and stages edge cases', () => {
  it('puts cycle members after the deepest acyclic layer', () => {
    const dag = buildDag({
      ...parsed(loopDag),
      nodes: [
        { id: 'a', type: 'bash', depends_on: [] },
        { id: 'b', type: 'bash', depends_on: ['a', 'c'] },
        { id: 'c', type: 'bash', depends_on: ['b'] },
        { id: 'd', type: 'bash', depends_on: ['a'] },
      ],
      edges: [],
      node_count: 4,
    })
    const layer = Object.fromEntries(dag.nodes.map((n) => [n.id, n.layer]))
    expect(layer).toEqual({ a: 0, d: 1, b: 2, c: 2 })
  })

  it('type rule beats the last-node REPORT rule', () => {
    const dag = buildDag({
      ...parsed(loopDag),
      nodes: [
        { id: 'a', type: 'prompt', depends_on: [] },
        { id: 'z', type: 'bash', depends_on: ['a'] },
      ],
      edges: [],
      node_count: 2,
    })
    expect(dag.nodes.map((n) => n.stage)).toEqual(['PLAN', 'EXECUTE'])
  })
})

describe('loops', () => {
  // Real node_run row shape; the engine records loop iterations via loop_iteration.
  const loopRuns: Array<DagNodeRun> = [
    {
      dag_node_id: 'setup',
      status: 'completed',
      started_at: '2026-10-04T10:00:00+00:00',
      completed_at: '2026-10-04T10:00:01+00:00',
      loop_iteration: null,
      parent_subgraph_node_run_id: null,
    },
    {
      dag_node_id: 'loop-counter',
      status: 'running',
      started_at: '2026-10-04T10:00:01+00:00',
      completed_at: null,
      loop_iteration: null,
      parent_subgraph_node_run_id: null,
    },
    {
      dag_node_id: 'loop-counter',
      status: 'completed',
      started_at: '2026-10-04T10:00:01+00:00',
      completed_at: '2026-10-04T10:00:05+00:00',
      loop_iteration: 1,
      parent_subgraph_node_run_id: null,
    },
    {
      dag_node_id: 'loop-counter',
      status: 'completed',
      started_at: '2026-10-04T10:00:05+00:00',
      completed_at: '2026-10-04T10:00:09+00:00',
      loop_iteration: 2,
      parent_subgraph_node_run_id: null,
    },
    {
      dag_node_id: 'loop-counter',
      status: 'running',
      started_at: '2026-10-04T10:00:09+00:00',
      completed_at: null,
      loop_iteration: 3,
      parent_subgraph_node_run_id: null,
    },
  ]

  it('collapses 3 iteration rows into one node with an n/N badge', () => {
    const dag = buildDag(parsed(loopDag), loopRuns)
    expect(dag.nodes).toHaveLength(3)
    const loop = byId(dag, 'loop-counter')
    expect(loop.status).toBe('running')
    expect(loop.loop).toEqual({ n: 3, max: null }) // real preview is truncated before max_iterations
    expect(loopBadge(loop.loop)).toBe('3')
    expect(loop.tier).toBe(3)

    const def = parsed(structuredClone(loopDag))
    def.nodes[1].config_preview =
      '{"loop":{"until":"COMPLETE","max_iterations":5}}'
    expect(loopBadge(byId(buildDag(def, loopRuns), 'loop-counter').loop)).toBe(
      '3/5',
    )
  })

  it('ignores subgraph child rows when overlaying', () => {
    const dag = buildDag(parsed(loopDag), [
      {
        dag_node_id: 'setup',
        status: 'failed',
        parent_subgraph_node_run_id: 'x',
      },
    ])
    expect(byId(dag, 'setup').status).toBe('idle')
  })
})

describe('tokens, tiers and cap', () => {
  it('sums total_tokens once present, else null', () => {
    const runs: Array<DagNodeRun> = [
      { dag_node_id: 'setup', status: 'completed', total_tokens: 120 },
    ]
    const dag = buildDag(parsed(loopDag), runs)
    expect(byId(dag, 'setup').tokens).toBe(120)
    expect(byId(dag, 'report').tokens).toBeNull()
  })

  it('classifyTier: T3 loop/subgraph, T2 agent, else T1', () => {
    expect(
      classifyTier({ agent: null, loopIterations: 2, subgraph: false }),
    ).toBe(3)
    expect(
      classifyTier({ agent: null, loopIterations: 0, subgraph: true }),
    ).toBe(3)
    expect(
      classifyTier({ agent: 'neo', loopIterations: 0, subgraph: false }),
    ).toBe(2)
    expect(
      classifyTier({ agent: null, loopIterations: 0, subgraph: false }),
    ).toBe(1)
  })

  it('caps at 60 nodes with +K hidden', () => {
    const nodes = Array.from({ length: 65 }, (_, i) => ({
      id: `n${i}`,
      type: 'bash',
      depends_on: i ? [`n${i - 1}`] : [],
    }))
    const dag = buildDag({
      ...parsed(loopDag),
      nodes,
      edges: [],
      node_count: 65,
    })
    expect(dag.nodes).toHaveLength(60)
    expect(dag.hiddenCount).toBe(5)
    expect(dag.edges).toHaveLength(59)
  })
})

describe('buildDag — loop token sums', () => {
  it('counts only the wrapper row, never wrapper + iterations', () => {
    const row = (id: string, iter: number | null, tok: number): DagNodeRun => ({
      id,
      dag_node_id: 'analyze',
      status: 'completed',
      loop_iteration: iter,
      total_tokens: tok,
    })
    const runs = [
      row('w', null, 90),
      row('a', 1, 30),
      row('b', 2, 30),
      row('c', 3, 30),
    ]
    const dag = buildDag(parsed(improveLoop), runs)
    expect(byId(dag, 'analyze').tokens).toBe(90)
  })
})

describe('buildDag — linked sessions (C3)', () => {
  const sessions = runSessions as unknown as RunSessions
  const runs = (extra: Array<DagNodeRun> = []): Array<DagNodeRun> => [
    { id: 'nr-analyze', dag_node_id: 'analyze', status: 'completed' },
    ...extra,
  ]

  it('attaches sessions to the wrapper node and counts nested agents', () => {
    const dag = buildDag(parsed(improveLoop), runs(), sessions)
    const n = byId(dag, 'analyze')
    expect(n.sessions).toHaveLength(1)
    expect(agentCount(n.sessions)).toBe(3) // session + sub-1 + sub-1a
    expect(n.tier).toBe(3)
    expect(byId(dag, 'approval').sessions).toEqual([])
  })

  it('skips sessions owned by loop-iteration rows', () => {
    const dag = buildDag(
      parsed(improveLoop),
      [
        {
          id: 'nr-analyze',
          dag_node_id: 'analyze',
          status: 'x',
          loop_iteration: 2,
        },
      ],
      sessions,
    )
    expect(byId(dag, 'analyze').sessions).toEqual([])
  })
})

describe('buildDag — F1 overlay fields', () => {
  it('copies error / skip_reason / approval_response from the own row', () => {
    const def = parsed({
      name: 't',
      description: '',
      edges: [],
      nodes: [
        { id: 'a', type: 'bash' },
        { id: 'b', type: 'approval', depends_on: ['a'] },
      ],
    })
    const dag = buildDag(def, [
      { dag_node_id: 'a', status: 'failed', error: 'exited with code 2: x' },
      {
        dag_node_id: 'b',
        status: 'skipped',
        skip_reason: 'upstream',
        approval_response: 'ok',
      },
    ])
    expect(byId(dag, 'a')).toMatchObject({
      error: 'exited with code 2: x',
      skipReason: null,
    })
    expect(byId(dag, 'b')).toMatchObject({
      skipReason: 'upstream',
      approvalResponse: 'ok',
    })
    expect(buildDag(def).nodes[0]).toMatchObject({
      error: null,
      approvalResponse: null,
    })
  })
})
