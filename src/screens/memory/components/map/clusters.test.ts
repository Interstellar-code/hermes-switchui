import { describe, expect, it } from 'vitest'
import { OTHER_CLUSTER_ID, computeClusters } from './clusters'
import type { GraphEdge, GraphNode, Kind } from '../memory-map-graph'

const node = (id: string, kind: Kind = 'gist', label = id): GraphNode => ({
  id,
  kind,
  label,
})
const edge = (source: string, target: string, weight = 1): GraphEdge => ({
  source,
  target,
  edgeType: 'mentions',
  weight,
  occurrences: 1,
  timestamp: null,
})

/** Clique of `size` nodes named `${prefix}${i}`. */
function clique(prefix: string, size: number) {
  const nodes = Array.from({ length: size }, (_, i) => node(`${prefix}${i}`))
  const edges: Array<GraphEdge> = []
  for (let i = 0; i < size; i++)
    for (let j = i + 1; j < size; j++)
      edges.push(edge(`${prefix}${i}`, `${prefix}${j}`))
  return { nodes, edges }
}

/** Seeded LCG so the synthetic graph and shuffles are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}
function shuffle<T>(arr: Array<T>, rand: () => number): Array<T> {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function synthetic(n: number, m: number, seed = 1) {
  const rand = rng(seed)
  const kinds: Array<Kind> = ['gist', 'fact', 'entity', 'episodic']
  const nodes = Array.from({ length: n }, (_, i) =>
    node(`n${i}`, kinds[i % kinds.length]),
  )
  // Community-ish: mostly within blocks of 100, some cross links.
  const edges: Array<GraphEdge> = []
  for (let k = 0; k < m; k++) {
    const a = Math.floor(rand() * n)
    const b =
      rand() < 0.8
        ? Math.min(n - 1, Math.floor(a / 100) * 100 + Math.floor(rand() * 100))
        : Math.floor(rand() * n)
    edges.push(edge(`n${a}`, `n${b}`, 1 + Math.floor(rand() * 3)))
  }
  return { nodes, edges }
}

const plain = (r: ReturnType<typeof computeClusters>) => ({
  clusterOf: [...r.clusterOf].sort(([a], [b]) => (a < b ? -1 : 1)),
  clusters: r.clusters,
})

describe('computeClusters', () => {
  it('is deterministic under input shuffling', () => {
    const { nodes, edges } = synthetic(800, 2400, 7)
    const base = plain(computeClusters(nodes, edges))
    const rand = rng(42)
    for (let k = 0; k < 3; k++) {
      const r = computeClusters(shuffle(nodes, rand), shuffle(edges, rand))
      expect(plain(r)).toEqual(base)
    }
  })

  it('splits two disjoint cliques into 2 clusters', () => {
    const a = clique('a', 6)
    const b = clique('b', 7)
    const r = computeClusters(
      [...a.nodes, ...b.nodes],
      [...a.edges, ...b.edges],
    )
    expect(r.clusters.map((c) => [c.size, c.slot])).toEqual([
      [7, 0],
      [6, 1],
    ])
    for (const nd of a.nodes) expect(r.clusterOf.get(nd.id)).toBe(1)
    for (const nd of b.nodes) expect(r.clusterOf.get(nd.id)).toBe(0)
  })

  it('merges clusters under 5 members and isolated nodes into Other', () => {
    const big = clique('a', 5)
    const small = clique('s', 4)
    const r = computeClusters(
      [...big.nodes, ...small.nodes, node('lonely')],
      [...big.edges, ...small.edges],
    )
    expect(r.clusters).toHaveLength(2)
    expect(r.clusters[1]).toEqual({
      id: OTHER_CLUSTER_ID,
      name: 'Other',
      size: 5,
      slot: null,
    })
    expect(r.clusterOf.get('s0')).toBe(OTHER_CLUSTER_ID)
    expect(r.clusterOf.get('lonely')).toBe(OTHER_CLUSTER_ID)
  })

  it('ranks by size into slots 0-7, ties by smallest member id, rest Other', () => {
    // 10 cliques: sizes 5..9 then two ties of size 6 — only 8 get slots.
    const parts = [
      clique('c', 9),
      clique('d', 5),
      clique('e', 8),
      clique('f', 7),
      clique('g', 6),
      clique('b', 6),
      clique('h', 5),
      clique('i', 5),
      clique('j', 5),
      clique('k', 5),
    ]
    const r = computeClusters(
      parts.flatMap((p) => p.nodes),
      parts.flatMap((p) => p.edges),
    )
    const slotted = r.clusters.filter((c) => c.slot !== null)
    expect(slotted.map((c) => c.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(slotted.map((c) => c.size)).toEqual([9, 8, 7, 6, 6, 5, 5, 5])
    // Tie at size 6: 'b0' < 'g0'; tie at size 5: d < h < i, j/k fall to Other.
    expect(r.clusterOf.get('b0')).toBe(3)
    expect(r.clusterOf.get('g0')).toBe(4)
    expect(r.clusterOf.get('d0')).toBe(5)
    expect(r.clusterOf.get('j0')).toBe(OTHER_CLUSTER_ID)
    expect(r.clusters.at(-1)).toMatchObject({ slot: null, size: 10 })
  })

  it('names a cluster after an entity, else its highest-degree node', () => {
    const { nodes, edges } = clique('g', 5)
    const hub = node('hub', 'gist', 'Big gist hub')
    const ent = node('e1', 'entity', 'SwitchUI')
    const withEntity = computeClusters(
      [...nodes, hub, ent],
      [
        ...edges,
        ...nodes.map((n) => edge('hub', n.id)),
        edge('e1', 'g0'),
        edge('e1', 'g1'),
        edge('e1', 'g2'),
      ],
    )
    expect(withEntity.clusters[0].name).toBe('SwitchUI')

    const noEntity = computeClusters(
      [...nodes, hub, node('leaf')],
      // 'leaf' lifts hub's degree above the clique members'.
      [...edges, ...nodes.map((n) => edge('hub', n.id)), edge('hub', 'leaf')],
    )
    expect(noEntity.clusters[0].name).toBe('Big gist hub')
  })

  it('names by distinctive entity: a ubiquitous one loses to a cluster-specific one', () => {
    const a = clique('a', 8)
    const others = Array.from({ length: 20 }, (_, k) => clique(`o${k}x`, 5))
    const ubiq = node('u', 'entity', 'Ubiquitous')
    const spec = node('s', 'entity', 'Specific')
    const r = computeClusters(
      [...a.nodes, ...others.flatMap((o) => o.nodes), ubiq, spec],
      [
        ...a.edges,
        ...others.flatMap((o) => o.edges),
        // u: 6 links into a, plus one into each of 20 other clusters.
        ...a.nodes.slice(0, 6).map((n) => edge('u', n.id)),
        ...others.map((o) => edge('u', o.nodes[0].id)),
        // s: 4 links, all into a.
        ...a.nodes.slice(0, 4).map((n) => edge('s', n.id)),
      ],
    )
    const cluster = r.clusters.find((c) => c.id === r.clusterOf.get('a0'))
    expect(r.clusterOf.get('u')).toBe(cluster?.id)
    // Highest degree would pick "Ubiquitous"; distinctiveness ranks it second.
    expect(cluster?.name).toBe('Specific · Ubiquitous')
  })

  it('clusters 7590 nodes / 20k edges fast', () => {
    const { nodes, edges } = synthetic(7590, 20000)
    computeClusters(nodes, edges) // warm-up (JIT)
    const t = performance.now()
    const r = computeClusters(nodes, edges)
    const ms = performance.now() - t
    console.log(`computeClusters 7590/20000: ${ms.toFixed(1)} ms`)
    expect(r.clusterOf.size).toBe(7590)
    expect(ms).toBeLessThan(200)
  })
})
