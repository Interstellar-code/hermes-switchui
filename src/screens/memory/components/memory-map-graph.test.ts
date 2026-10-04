import { describe, expect, it } from 'vitest'
import {
  buildSearchIndex,
  cleanLabel,
  computeVisibleGraph,
  degreeMap,
  deriveInspector,
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

  it('grows the cut ring by ring so second-hop nodes beat stranded hubs', () => {
    const nodes = ['h', 'l1', 'l2', 'l3', 'm1', 'p', 'q', 'r'].map((id) =>
      node(id, 'fact'),
    )
    const edges = [
      edge('h', 'l1', 'about'),
      edge('h', 'l2', 'about'),
      edge('h', 'l3', 'about'),
      edge('l1', 'm1', 'about'),
      edge('p', 'q', 'about'),
      edge('p', 'r', 'about'),
    ]
    const v = computeVisibleGraph(nodes, edges, {
      kinds: KINDS,
      types: TYPES,
      minDegree: 0,
      limit: 5,
    })
    expect([...v.nodeIds].sort()).toEqual(['h', 'l1', 'l2', 'l3', 'm1'])
    expect(v.edgeIdx).toEqual([0, 1, 2, 3])
    // a pinned node outside the ring-filled cut is forced in, with its edges
    const pinned = computeVisibleGraph(nodes, edges, {
      kinds: KINDS,
      types: TYPES,
      minDegree: 0,
      limit: 5,
      pinned: 'q',
    })
    expect([...pinned.nodeIds].sort()).toEqual([
      'h',
      'l1',
      'l2',
      'l3',
      'm1',
      'q',
    ])
    expect(pinned.edgeIdx).toEqual([0, 1, 2, 3])
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

  it('drops nodes left without a visible edge, except wiki pages', () => {
    // mentions off: b and c only had mentions edges → stray dots
    const v = computeVisibleGraph(NODES, EDGES, {
      kinds: KINDS,
      types: { ...TYPES, mentions: false },
      minDegree: 0,
      limit: null,
    })
    expect([...v.nodeIds].sort()).toEqual(['a', 'ep', 'f', 'hub', 'w'])
    expect(v.candidates).toBe(5)
  })

  it('min-degree holds on the visible graph (peels to a fixed point)', () => {
    // star h–x,y,z plus chain x–y: at min 2, z falls (deg 1), then h still
    // has x,y (2) and x,y each have h + each other (2) → stable square.
    const nodes = ['h', 'x', 'y', 'z', 'q'].map((id) => node(id, 'fact'))
    const edges = [
      edge('h', 'x', 'about'),
      edge('h', 'y', 'about'),
      edge('h', 'z', 'about'),
      edge('x', 'y', 'about'),
      edge('z', 'q', 'about'), // z has 2 until q (deg 1) goes
    ]
    const v = computeVisibleGraph(nodes, edges, {
      kinds: KINDS,
      types: TYPES,
      minDegree: 2,
      limit: null,
    })
    expect([...v.nodeIds].sort()).toEqual(['h', 'x', 'y'])
    expect(v.edgeIdx).toEqual([0, 1, 3])
    expect(v.candidates).toBe(3)
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
    expect(nodeDates(EDGES).get('hub')?.last).toBe('2026-03-01T00:00:00Z')
    expect(nodeDates(EDGES).has('b')).toBe(false)
  })

  it('nodeDates returns first + last, skipping null timestamps', () => {
    const d = nodeDates([
      edge('n', 'x', 'about', '2026-05-01T00:00:00Z'),
      edge('n', 'y', 'about', null),
      edge('z', 'n', 'about', '2026-02-01T00:00:00Z'),
    ])
    expect(d.get('n')).toEqual({
      first: '2026-02-01T00:00:00Z',
      last: '2026-05-01T00:00:00Z',
    })
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

describe('deriveInspector', () => {
  const nodes = [
    node('e:rohit', 'entity', 'Rohit'),
    node('e:neo', 'entity', 'Neo'),
    node('e:blr', 'entity', 'BLR'),
    node('f1', 'fact'),
    node('g1', 'gist'),
    node('g2', 'gist'),
    node('w1', 'wiki'),
  ]
  const edges = [
    edge('g1', 'e:rohit', 'mentions', '2026-01-02T00:00:00Z'),
    edge('g2', 'e:rohit', 'mentions', '2026-03-05T00:00:00Z'),
    edge('w1', 'e:rohit', 'references', '2026-02-01T00:00:00Z'),
    edge('f1', 'e:rohit', 'about', '2026-01-01T00:00:00Z'),
    edge('f1', 'e:neo', 'about', '2026-01-01T00:00:00Z'),
    edge('g1', 'e:blr', 'mentions', '2026-01-02T00:00:00Z'),
    edge('g2', 'e:blr', 'mentions', '2026-01-03T00:00:00Z'),
  ]
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    for (const [a, b] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      if (!adj.has(a)) adj.set(a, new Set())
      adj.get(a)!.add(b)
    }
  }
  const model = {
    byId: new Map(nodes.map((n) => [n.id, n])),
    deg: degreeMap(edges),
    dates: nodeDates(edges),
    adj,
  }
  const clusters = {
    clusterOf: new Map([['e:rohit', 3]]),
    clusters: [{ id: 3, name: 'Personal', size: 9, slot: 3 }],
  }

  it('returns undefined for unknown ids', () => {
    expect(deriveInspector(model, 'nope', null)).toBeUndefined()
  })

  it('derives connections, first/last, cluster', () => {
    const d = deriveInspector(model, 'e:rohit', clusters)!
    expect(d.connections).toBe(4)
    expect(d.firstSeen).toBe('2026-01-01T00:00:00Z')
    expect(d.lastSeen).toBe('2026-03-05T00:00:00Z')
    expect(d.clusterId).toBe(3)
    expect(deriveInspector(model, 'e:rohit', null)!.clusterId).toBeNull()
  })

  it('links entities directly and via a fact, excluding self, by degree', () => {
    const d = deriveInspector(model, 'e:rohit', null)!
    // Neo is reached 2-hop through f1; BLR is not linked to Rohit.
    expect(d.linkedEntities.map((n) => n.id)).toEqual(['e:neo'])
    const g = deriveInspector(model, 'g1', null)!
    expect(g.linkedEntities.map((n) => n.id)).toEqual(['e:rohit', 'e:blr'])
  })

  it('lists gist/wiki mentions newest first', () => {
    const d = deriveInspector(model, 'e:rohit', null)!
    expect(d.mentionedIn.map((m) => m.node.id)).toEqual(['g2', 'w1', 'g1'])
    expect(d.mentionedIn[0].at).toBe('2026-03-05T00:00:00Z')
  })
})
