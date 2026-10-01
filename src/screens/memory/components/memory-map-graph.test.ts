import { describe, expect, it } from 'vitest'
import {
  buildSearchIndex,
  cleanLabel,
  computeVisibleGraph,
  degreeMap,
  nodeDates,
  searchNodes,
  shortLabel,
} from './memory-map-graph'
import type { EdgeType, GraphEdge, GraphNode, Kind } from './memory-map-graph'

const KINDS: Record<Kind, boolean> = {
  gist: true,
  working: true,
  fact: true,
  entity: true,
  episodic: true,
  wiki: true,
}
const TYPES: Record<EdgeType, boolean> = {
  ctx: true,
  references: true,
  mentions: true,
  about: true,
  relates: true,
  summarizes: true,
}

const node = (id: string, kind: Kind, label = id): GraphNode => ({
  id,
  kind,
  label,
})
const edge = (
  source: string,
  target: string,
  edgeType: EdgeType,
  timestamp: string | null = null,
): GraphEdge => ({
  source,
  target,
  edgeType,
  weight: 1,
  occurrences: 1,
  timestamp,
})

// hub(entity) ← a, b, c (mentions); a → f (ctx); ep (episodic) → hub (relates)
const NODES = [
  node('hub', 'entity', 'SwitchUI'),
  node('a', 'gist'),
  node('b', 'gist'),
  node('c', 'gist'),
  node('f', 'fact'),
  node('ep', 'episodic', '(ASSISTANT) long chat text'),
  node('w', 'wiki'),
]
const EDGES = [
  edge('a', 'hub', 'mentions'),
  edge('b', 'hub', 'mentions'),
  edge('c', 'hub', 'mentions'),
  edge('a', 'f', 'ctx', '2026-01-02T00:00:00Z'),
  edge('ep', 'hub', 'relates', '2026-03-01T00:00:00Z'),
]

describe('computeVisibleGraph', () => {
  it('keeps the top-N nodes by degree and only edges between them', () => {
    const v = computeVisibleGraph(NODES, EDGES, {
      kinds: KINDS,
      types: TYPES,
      minDegree: 0,
      limit: 2,
    })
    expect([...v.nodeIds].sort()).toEqual(['a', 'hub'])
    expect(v.edgeIdx).toEqual([0])
    expect(v.candidates).toBe(7)
  })

  it('fills the cut with hub neighbours, not disconnected high-degree nodes', () => {
    const nodes = ['h', 'l1', 'l2', 'l3', 'p', 'q', 'r'].map((id) =>
      node(id, 'fact'),
    )
    const edges = [
      edge('h', 'l1', 'about'),
      edge('h', 'l2', 'about'),
      edge('h', 'l3', 'about'),
      edge('p', 'q', 'about'),
      edge('p', 'r', 'about'),
    ]
    const v = computeVisibleGraph(nodes, edges, {
      kinds: KINDS,
      types: TYPES,
      minDegree: 0,
      limit: 4,
    })
    expect([...v.nodeIds].sort()).toEqual(['h', 'l1', 'l2', 'l3'])
    expect(v.edgeIdx).toEqual([0, 1, 2])
  })

  it('degree counts only edges whose type and endpoint kinds are visible', () => {
    const v = computeVisibleGraph(NODES, EDGES, {
      kinds: { ...KINDS, episodic: false },
      types: { ...TYPES, mentions: false },
      minDegree: 1,
      limit: null,
    })
    expect([...v.nodeIds].sort()).toEqual(['a', 'f'])
    expect(v.edgeIdx).toEqual([3])
  })

  it('always includes the pinned node when its kind is on', () => {
    const v = computeVisibleGraph(NODES, EDGES, {
      kinds: KINDS,
      types: TYPES,
      minDegree: 0,
      limit: 1,
      pinned: 'w',
    })
    expect(v.nodeIds.has('w')).toBe(true)
    const off = computeVisibleGraph(NODES, EDGES, {
      kinds: { ...KINDS, wiki: false },
      types: TYPES,
      minDegree: 0,
      limit: 1,
      pinned: 'w',
    })
    expect(off.nodeIds.has('w')).toBe(false)
  })
})

describe('labels + lookups', () => {
  it('strips chat role prefixes and never shows raw episodic text', () => {
    expect(cleanLabel('(ASSISTANT)  hello   there')).toBe('hello there')
    expect(cleanLabel('[user] assistant: hi')).toBe('hi')
    expect(shortLabel(NODES[5], 28, '2026-03-01T00:00:00Z')).toBe(
      'episode · 2026-03-01',
    )
    expect(shortLabel(node('x', 'fact', 'abcdefghij'), 5)).toBe('abcd…')
  })

  it('computes degree and latest edge date per node', () => {
    expect(degreeMap(EDGES).get('hub')).toBe(4)
    expect(nodeDates(EDGES).get('hub')).toBe('2026-03-01T00:00:00Z')
    expect(nodeDates(EDGES).has('b')).toBe(false)
  })

  it('searches labels with prefix hits first, then by degree', () => {
    const r = searchNodes(
      buildSearchIndex([node('z', 'fact', 'my switch'), ...NODES]),
      'switch',
      degreeMap(EDGES),
    )
    expect(r.total).toBe(2)
    expect(r.matches.map((n) => n.id)).toEqual(['hub', 'z'])
    expect([...r.ids].sort()).toEqual(['hub', 'z'])
    // id matches count too (same predicate as the canvas highlight)
    expect(
      searchNodes(buildSearchIndex(NODES), 'ep', degreeMap(EDGES)).ids.has(
        'ep',
      ),
    ).toBe(true)
    expect(
      searchNodes(buildSearchIndex(NODES), '  ', degreeMap(EDGES)).total,
    ).toBe(0)
  })
})
