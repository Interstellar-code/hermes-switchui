import { describe, expect, it } from 'vitest'
import { buildDag } from './dag-model'
import {
  GAP_X,
  MIN_SCALE,
  NODE_H,
  NODE_W,
  PAD,
  edgePath,
  fitScale,
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

describe('edgePath', () => {
  it('runs from right-middle of source to left-middle of target', () => {
    const d = edgePath({ x: 0, y: 0 }, { x: 300, y: 100 })
    expect(d.startsWith(`M${NODE_W} ${NODE_H / 2}`)).toBe(true)
    expect(d.endsWith(`300 ${100 + NODE_H / 2}`)).toBe(true)
  })
})

describe('fitScale', () => {
  it('never upscales', () => {
    expect(
      fitScale({ width: 100, height: 100 }, { width: 1000, height: 1000 }),
    ).toBe(1)
  })
  it('fits height only; width scrolls', () => {
    expect(
      fitScale({ width: 9000, height: 400 }, { width: 100, height: 300 }),
    ).toBe(0.75)
  })
  it('floors at MIN_SCALE and tolerates zero sizes', () => {
    expect(
      fitScale({ width: 100, height: 1000 }, { width: 100, height: 100 }),
    ).toBe(MIN_SCALE)
    expect(fitScale({ width: 0, height: 0 }, { width: 0, height: 0 })).toBe(1)
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
})
