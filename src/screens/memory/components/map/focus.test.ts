import { describe, expect, it } from 'vitest'
import { RING_GAP, egoNetwork, radialLayout, typedAdjacency } from './focus'
import { nodeRadius } from './map-render'
import type { EdgeType, GraphEdge } from '../memory-map-graph'

const e = (source: string, target: string, edgeType: EdgeType): GraphEdge => ({
  source,
  target,
  edgeType,
  weight: 1,
  occurrences: 1,
  timestamp: null,
})

// c ─about─ a ─mentions─ x
// c ─mentions─ b ─about─ y ─about─ z (3 hops)
// a ─about─ b (ring1 ↔ ring1)
const EDGES = [
  e('c', 'a', 'about'),
  e('c', 'b', 'mentions'),
  e('a', 'x', 'mentions'),
  e('b', 'y', 'about'),
  e('y', 'z', 'about'),
  e('a', 'b', 'about'),
]
const ALL = new Set<EdgeType>(['about', 'mentions'])
const adj = typedAdjacency(EDGES)
const deg = new Map<string, number>()
for (const x of EDGES) {
  deg.set(x.source, (deg.get(x.source) ?? 0) + 1)
  deg.set(x.target, (deg.get(x.target) ?? 0) + 1)
}

describe('egoNetwork', () => {
  it('1 hop: direct neighbours only, centre edges only', () => {
    const g = egoNetwork(adj, 'c', 1, ALL, deg)
    expect(new Set(g.ring1)).toEqual(new Set(['a', 'b']))
    expect(g.ring2).toEqual([])
    expect(g.edges).toHaveLength(2)
    expect(g.typeCounts).toEqual({ about: 1, mentions: 1 })
  })

  it('2 hops: second ring excludes centre and ring 1, stops at 2', () => {
    const g = egoNetwork(adj, 'c', 2, ALL, deg)
    expect(new Set(g.ring2)).toEqual(new Set(['x', 'y']))
    expect(g.ring2).not.toContain('z')
    expect(g.parent.get('x')).toBe('a')
    expect(g.parent.get('y')).toBe('b')
    // ring1↔ring1 (a-b) is not drawn
    expect(g.edges.some((x) => x.s === 'a' && x.t === 'b')).toBe(false)
    expect(g.edges).toHaveLength(4)
  })

  it('edge-type filter applies to every hop', () => {
    const g = egoNetwork(adj, 'c', 2, new Set<EdgeType>(['about']), deg)
    expect(g.ring1).toEqual(['a'])
    // a-b about edge reaches b at hop 2 now that c-b (mentions) is off
    expect(g.ring2).toEqual(['b'])
    expect(g.typeCounts).toEqual({ about: 2 })
  })

  it('caps rings by degree and reports the rest', () => {
    const star = [
      ...Array.from({ length: 10 }, (_, i) => e('h', `n${i}`, 'about')),
      ...Array.from({ length: 10 }, (_, i) => e('n0', `m${i}`, 'about')),
    ]
    const sdeg = new Map<string, number>([['n0', 11]])
    const g = egoNetwork(typedAdjacency(star), 'h', 2, ALL, sdeg, null, {
      ring1: 3,
      ring2: 4,
    })
    expect(g.ring1).toHaveLength(3)
    expect(g.ring1[0]).toBe('n0')
    expect(g.more1).toBe(7)
    expect(g.ring2).toHaveLength(4)
    expect(g.more2).toBe(6)
  })

  it('collapses duplicate same-type edges', () => {
    const dup = typedAdjacency([...EDGES, e('a', 'c', 'about')])
    const g = egoNetwork(dup, 'c', 1, ALL, deg)
    expect(g.edges).toHaveLength(2)
    expect(g.typeCounts.about).toBe(1)
  })

  it('only nodes in the allowed set join the rings; the centre always does', () => {
    const g = egoNetwork(adj, 'c', 2, ALL, deg, new Set(['a', 'x']))
    expect(g.ring1).toEqual(['a'])
    expect(g.ring2).toEqual(['x'])
  })

  it('unknown centre gives an empty ego', () => {
    const g = egoNetwork(adj, 'nope', 2, ALL, deg)
    expect(g.ring1).toEqual([])
    expect(g.ring2).toEqual([])
  })
})

describe('radialLayout', () => {
  const big = [
    ...Array.from({ length: 60 }, (_, i) => e('h', `n${i}`, 'about')),
    ...Array.from({ length: 60 }, (_, i) => e(`n${i % 7}`, `m${i}`, 'about')),
  ]
  const badj = typedAdjacency(big)
  const bdeg = new Map<string, number>()
  const ego = egoNetwork(badj, 'h', 2, ALL, bdeg)
  const group = (id: string) => [id.charCodeAt(1) % 3]

  it('is deterministic', () => {
    const a = radialLayout(ego, group, bdeg)
    const b = radialLayout(ego, group, bdeg)
    expect([...a.pos]).toEqual([...b.pos])
  })

  it('centre at origin, rings at their radii, ring 2 outside ring 1', () => {
    const l = radialLayout(ego, group, bdeg)
    expect(l.pos.get('h')).toEqual({ x: 0, y: 0 })
    for (const id of ego.ring1)
      expect(Math.hypot(l.pos.get(id)!.x, l.pos.get(id)!.y)).toBeCloseTo(l.r1)
    for (const id of ego.ring2)
      expect(Math.hypot(l.pos.get(id)!.x, l.pos.get(id)!.y)).toBeCloseTo(l.r2)
    expect(l.r2).toBeGreaterThan(l.r1)
  })

  it('no two nodes overlap, radii included, with gap = 2·maxR + 4', () => {
    // hubs get the biggest radius (nodeRadius caps at +6)
    const r = (id: string) => nodeRadius('wiki', id === 'n0' ? 400 : 1)
    const ids = [ego.centre, ...ego.ring1, ...ego.ring2]
    const gap = 2 * Math.max(...ids.map(r)) + 4
    expect(gap).toBeGreaterThanOrEqual(RING_GAP)
    const l = radialLayout(ego, group, bdeg, gap)
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = l.pos.get(ids[i])!
        const b = l.pos.get(ids[j])!
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
          r(ids[i]) + r(ids[j]),
        )
      }
  })
})
