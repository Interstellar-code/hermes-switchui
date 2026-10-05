import { describe, expect, it } from 'vitest'
import { buildDag } from './dag-model'
import {
  GAP_X,
  NODE_H,
  NODE_W,
  PAD,
  fmtDuration,
  layoutDag,
  nodeProgress,
} from './dag-layout'
import type { ParsedWorkflow } from '@/screens/workflows/types'

const parsed = {
  name: 't',
  description: '',
  has_loop: false,
  has_approval: false,
  edges: [],
  nodes: [
    { id: 'a', type: 'prompt' },
    { id: 'b', type: 'bash', depends_on: ['a'] },
    { id: 'c', type: 'bash', depends_on: ['a'] },
    { id: 'd', type: 'prompt', depends_on: ['b', 'c'] },
  ],
} as unknown as ParsedWorkflow

describe('layoutDag', () => {
  const dag = buildDag(parsed)
  const l = layoutDag(dag)

  it('places one position per node, layer by column', () => {
    expect(Object.keys(l.positions).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(l.positions.a.x).toBe(PAD)
    expect(l.positions.b.x).toBe(PAD + NODE_W + GAP_X)
    expect(l.positions.b.x).toBe(l.positions.c.x)
    expect(l.positions.d.x).toBeGreaterThan(l.positions.b.x)
  })

  it('centres the short columns on the tallest', () => {
    const mid = (l.positions.b.y + l.positions.c.y + NODE_H) / 2
    expect(l.positions.a.y + NODE_H / 2).toBeCloseTo(mid)
    expect(l.height).toBe(PAD * 2 + 2 * NODE_H + 22)
  })

  it('is empty for an empty dag', () => {
    expect(layoutDag({ nodes: [] })).toEqual({
      positions: {},
      width: 0,
      height: 0,
    })
  })
})

describe('fmtDuration / nodeProgress', () => {
  it('formats', () => {
    expect(fmtDuration(83_000)).toBe('1:23')
    expect(fmtDuration(3_723_000)).toBe('1:02:03')
    expect(fmtDuration(null)).toBe('—')
    expect(fmtDuration((62 * 24 + 10) * 3_600_000)).toBe('62d 10h')
  })
  it('counts the active node as current', () => {
    const dag = buildDag(parsed, [
      { dag_node_id: 'a', status: 'completed' },
      { dag_node_id: 'b', status: 'running' },
    ])
    expect(nodeProgress(dag)).toEqual({ x: 2, y: 4 })
    expect(nodeProgress(buildDag(parsed))).toEqual({ x: 0, y: 4 })
  })
  it('reports the failed node position for a failed run (CondFailed-like)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'apply', 'g', 'h', 'i', 'j']
    const wf = {
      ...parsed,
      nodes: ids.map((id, i) => ({
        id,
        type: 'bash',
        depends_on: i ? [ids[i - 1]] : [],
      })),
    } as unknown as ParsedWorkflow
    const runs = ids.slice(0, 5).map((id) => ({
      dag_node_id: id,
      status: 'completed',
    }))
    runs.push({ dag_node_id: 'apply', status: 'failed' })
    expect(nodeProgress(buildDag(wf, runs))).toEqual({ x: 6, y: 10 })
  })
})
