import { describe, expect, it } from 'vitest'
import { buildDag } from '../dag-model'
import {
  fmtShort,
  laneExtents,
  mergePositions,
  nodeClass,
  statusGlyph,
  statusText,
  toFlow,
} from './flow-model'
import type { DagNode, DagNodeRun } from '../dag-model'
import type { ParsedWorkflow } from '@/screens/workflows/types'

const parsed = {
  name: 't',
  description: '',
  has_loop: false,
  has_approval: false,
  edges: [],
  nodes: [
    { id: 'a', type: 'bash' },
    { id: 'b', type: 'bash', depends_on: ['a'] },
    { id: 'c', type: 'approval', depends_on: ['b'] },
    { id: 'd', type: 'prompt', depends_on: ['c'] },
  ],
} as unknown as ParsedWorkflow

const T0 = Date.parse('2026-10-05T14:00:00Z')
const iso = (ms: number) => new Date(T0 + ms).toISOString()

function node(over: Partial<DagNode>): DagNode {
  return {
    ...buildDag(parsed).nodes[0],
    startedAt: null,
    completedAt: null,
    ...over,
  }
}

describe('statusText / statusGlyph / nodeClass', () => {
  const now = T0 + 152_000
  it('covers board 7 cases', () => {
    expect(
      statusText(
        node({ status: 'completed', startedAt: T0, completedAt: T0 + 2100 }),
        now,
      ),
    ).toBe('✓ 2.1s')
    expect(statusText(node({ status: 'running', startedAt: T0 }), now)).toBe(
      'running 2:32',
    )
    expect(statusText(node({ status: 'idle' }), now)).toBe('pending')
    expect(
      statusText(node({ status: 'paused', startedAt: T0 - 271_000 }), now),
    ).toBe('waiting 7m 03s')
    expect(
      statusText(
        node({ status: 'completed', type: 'approval', startedAt: T0 }),
        now,
      ),
    ).toBe('approved')
    expect(
      statusText(
        node({
          status: 'failed',
          startedAt: T0,
          completedAt: T0 + 41_000,
          error: 'bash exited with code 1: boom',
        }),
        now,
      ),
    ).toBe('exit 1 · 41.0s')
    expect(
      statusText(node({ status: 'skipped', skipReason: 'total 18' }), now),
    ).toBe('skipped · total 18')
    expect(statusText(node({ status: 'skipped' }), now, true)).toBe(
      'upstream failed',
    )
    expect(statusText(node({ status: 'idle' }), now, true)).toBe(
      'upstream failed',
    )
  })

  it('maps glyphs and classes', () => {
    expect(
      ['completed', 'running', 'idle', 'paused', 'failed', 'skipped'].map(
        statusGlyph,
      ),
    ).toEqual(['✓', '●', '○', '⏸', '✗', '–'])
    expect(nodeClass('paused')).toBe('hold')
    expect(nodeClass('idle')).toBe('wait')
    expect(nodeClass('cancelled')).toBe('skip')
  })

  it('fmtShort', () => {
    expect(fmtShort(98_000)).toBe('1m 38s')
    expect(fmtShort(3_600_000)).toBe('1:00:00')
  })
})

describe('mergePositions', () => {
  it('keeps saved known ids, seeds new ones, drops unknown', () => {
    const seed = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    const saved = { a: { x: 5, y: 5 }, gone: { x: 1, y: 1 } }
    expect(mergePositions(seed, saved, ['a', 'b'])).toEqual({
      a: { x: 5, y: 5 },
      b: { x: 10, y: 0 },
    })
    expect(mergePositions(seed, undefined, ['a'])).toEqual({
      a: { x: 0, y: 0 },
    })
  })
  it('falls back to the seed for non-finite saved x/y', () => {
    const seed = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }
    const saved = { a: { x: NaN, y: 5 }, b: { x: 3, y: null as never } }
    expect(mergePositions(seed, saved, ['a', 'b'])).toEqual(seed)
  })
})

describe('toFlow', () => {
  const runs: Array<DagNodeRun> = [
    {
      dag_node_id: 'a',
      status: 'completed',
      started_at: iso(0),
      completed_at: iso(1000),
    },
    { dag_node_id: 'b', status: 'running', started_at: iso(1000) },
  ]

  it('classes edges live / done / pending', () => {
    const { edges, nodes } = toFlow(buildDag(parsed, runs), {})
    expect(Object.fromEntries(edges.map((e) => [e.id, e.className]))).toEqual({
      'a>b': 'live',
      'b>c': 'pending',
      'c>d': 'pending',
    })
    expect(nodes.map((n) => n.type)).toEqual(['dag', 'dag', 'dag', 'dag'])
  })

  it('hold edge into a paused node; failures mark descendants', () => {
    const paused = toFlow(
      buildDag(parsed, [
        { dag_node_id: 'b', status: 'completed' },
        { dag_node_id: 'c', status: 'paused' },
      ]),
      {},
    )
    expect(paused.edges.find((e) => e.id === 'b>c')?.className).toBe('hold')

    const failed = toFlow(
      buildDag(parsed, [{ dag_node_id: 'b', status: 'failed' }]),
      {},
    )
    expect(failed.edges.find((e) => e.id === 'b>c')?.className).toBe('fail')
    const blocked = failed.nodes
      .filter((n) => n.data.upstreamFailed)
      .map((n) => n.id)
    expect(blocked).toEqual(['c', 'd'])
  })

  it('preview edges are all pending', () => {
    const { edges } = toFlow(buildDag(parsed, runs), {}, true)
    expect(edges.every((e) => e.className === 'pending')).toBe(true)
  })
})

describe('laneExtents', () => {
  it('one band per stage, sorted, contiguous', () => {
    const lanes = laneExtents([
      { stage: 'EXECUTE', x: 300 },
      { stage: 'PLAN', x: 0 },
      { stage: 'EXECUTE', x: 500 },
      { stage: 'REVIEW', x: 800 },
    ])
    expect(lanes.map((l) => l.stage)).toEqual(['PLAN', 'EXECUTE', 'REVIEW'])
    expect(lanes[0].x1).toBe(lanes[1].x0)
    expect(lanes[2].x1).toBeGreaterThan(800)
  })
})
