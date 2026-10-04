/**
 * Focus (ego network) mode for the Memory Map: who is within 1-2 hops of one
 * node over a chosen set of edge types, and a deterministic radial layout of
 * that set (centre, hop-1 ring, hop-2 ring). Pure, DOM-free.
 */

import type { EdgeType, GraphEdge } from '../memory-map-graph'

export type TypedAdj = Map<string, Array<{ id: string; type: EdgeType }>>

/**
 * Per-node neighbour list with the edge type, built once per dataset.
 * Repeated same-type edges between one pair collapse to one entry.
 */
export function typedAdjacency(edges: ReadonlyArray<GraphEdge>): TypedAdj {
  const adj: TypedAdj = new Map()
  const seen = new Set<string>()
  const add = (a: string, b: string, type: EdgeType) => {
    const l = adj.get(a)
    if (l) l.push({ id: b, type })
    else adj.set(a, [{ id: b, type }])
  }
  for (const e of edges) {
    if (e.source === e.target) continue
    const key =
      e.source < e.target
        ? `${e.source}\0${e.target}\0${e.edgeType}`
        : `${e.target}\0${e.source}\0${e.edgeType}`
    if (seen.has(key)) continue
    seen.add(key)
    add(e.source, e.target, e.edgeType)
    add(e.target, e.source, e.edgeType)
  }
  return adj
}

/** Ring caps keep a big hub readable; the rest is reported as "+N more". */
export const RING1_CAP = 200
export const RING2_CAP = 150

export interface Ego {
  centre: string
  hops: 1 | 2
  ring1: Array<string>
  ring2: Array<string>
  /** ring-2 id → the kept ring-1 node it was reached through */
  parent: Map<string, string>
  /** nodes dropped by the ring caps (ring 2: reached via kept ring-1 nodes) */
  more1: number
  more2: number
  /** centre↔ring1 and ring1↔ring2 edges of the allowed types */
  edges: Array<{ s: string; t: string; type: EdgeType }>
  typeCounts: Partial<Record<EdgeType, number>>
}

/** Busiest first; id breaks ties so the result is deterministic. */
function byDegree(deg: ReadonlyMap<string, number>) {
  return (a: string, b: string) =>
    (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * BFS from `centre` up to `hops` over edges whose type is in `types`. Only
 * nodes in `allowed` (the map's current filters) join a ring; the centre is
 * always in. Ring 2 is only reached through ring-1 nodes that survived the cap.
 */
export function egoNetwork(
  adj: TypedAdj,
  centre: string,
  hops: 1 | 2,
  types: ReadonlySet<EdgeType>,
  deg: ReadonlyMap<string, number>,
  allowed: ReadonlySet<string> | null = null,
  caps: { ring1: number; ring2: number } = {
    ring1: RING1_CAP,
    ring2: RING2_CAP,
  },
): Ego {
  const ok = (id: string) => allowed == null || allowed.has(id)
  const hop1 = new Set<string>()
  for (const { id, type } of adj.get(centre) ?? [])
    if (types.has(type) && id !== centre && ok(id)) hop1.add(id)
  const ring1 = [...hop1].sort(byDegree(deg)).slice(0, caps.ring1)
  const kept1 = new Set(ring1)

  const parent = new Map<string, string>()
  if (hops === 2) {
    for (const p of ring1)
      for (const { id, type } of adj.get(p) ?? [])
        if (
          types.has(type) &&
          id !== centre &&
          !hop1.has(id) &&
          ok(id) &&
          !parent.has(id)
        )
          parent.set(id, p)
  }
  const ring2 = [...parent.keys()].sort(byDegree(deg)).slice(0, caps.ring2)
  const reached = parent.size
  const kept2 = new Set(ring2)
  for (const id of [...parent.keys()]) if (!kept2.has(id)) parent.delete(id)

  const edges: Ego['edges'] = []
  const typeCounts: Ego['typeCounts'] = {}
  const push = (s: string, t: string, type: EdgeType) => {
    edges.push({ s, t, type })
    typeCounts[type] = (typeCounts[type] ?? 0) + 1
  }
  for (const { id, type } of adj.get(centre) ?? [])
    if (types.has(type) && kept1.has(id)) push(centre, id, type)
  for (const id of ring2)
    for (const { id: nb, type } of adj.get(id) ?? [])
      if (types.has(type) && kept1.has(nb)) push(nb, id, type)

  return {
    centre,
    hops,
    ring1,
    ring2,
    parent,
    more1: hop1.size - ring1.length,
    more2: reached - ring2.length,
    edges,
    typeCounts,
  }
}

/** Default minimum centre-to-centre distance on a ring (sim units); callers
 * pass `2 * maxRadius + 4` so the biggest nodes never touch. */
export const RING_GAP = 24
export const RING1_MIN = 140
export const RING_STEP = 170

/** Radius at which `n` nodes sit on a circle with chord ≥ `gap`. */
function ringRadius(n: number, gap: number, min: number): number {
  if (n < 2) return min
  return Math.max(min, gap / (2 * Math.sin(Math.PI / n)))
}

export interface RadialLayout {
  /** offsets from the centre node (sim units) */
  pos: Map<string, { x: number; y: number }>
  r1: number
  r2: number
}

/**
 * Centre at (0,0); ring 1 grouped by `group` (cluster, then kind) so similar
 * nodes sit together; ring 2 follows its parents' order and is rotated to sit
 * as close to them as possible, which keeps edges short and uncrossed.
 */
export function radialLayout(
  ego: Ego,
  group: (id: string) => ReadonlyArray<number>,
  deg: ReadonlyMap<string, number>,
  gap = RING_GAP,
): RadialLayout {
  const tie = byDegree(deg)
  const cmpGroup = (a: string, b: string) => {
    const ga = group(a)
    const gb = group(b)
    for (let i = 0; i < Math.max(ga.length, gb.length); i++) {
      const d = (ga[i] ?? 0) - (gb[i] ?? 0)
      if (d) return d
    }
    return tie(a, b)
  }
  const ring1 = [...ego.ring1].sort(cmpGroup)
  const pos = new Map<string, { x: number; y: number }>()
  pos.set(ego.centre, { x: 0, y: 0 })
  const r1 = ringRadius(ring1.length, gap, RING1_MIN)
  const angle1 = new Map<string, number>()
  const start = -Math.PI / 2
  ring1.forEach((id, i) => {
    const a = start + (i / ring1.length) * Math.PI * 2
    angle1.set(id, a)
    pos.set(id, { x: r1 * Math.cos(a), y: r1 * Math.sin(a) })
  })

  const idx1 = new Map(ring1.map((id, i) => [id, i]))
  const ring2 = [...ego.ring2].sort(
    (a, b) =>
      (idx1.get(ego.parent.get(a)!) ?? 0) -
        (idx1.get(ego.parent.get(b)!) ?? 0) || cmpGroup(a, b),
  )
  const r2 =
    ring2.length > 0 ? ringRadius(ring2.length, gap, r1 + RING_STEP) : r1
  const n2 = ring2.length
  // rotate the evenly spaced ring so each node is nearest its parent on average
  let sx = 0
  let sy = 0
  ring2.forEach((id, i) => {
    const d = (angle1.get(ego.parent.get(id)!) ?? 0) - (i / n2) * Math.PI * 2
    sx += Math.cos(d)
    sy += Math.sin(d)
  })
  const rot = n2 > 0 ? Math.atan2(sy, sx) : start
  ring2.forEach((id, i) => {
    const a = rot + (i / n2) * Math.PI * 2
    pos.set(id, { x: r2 * Math.cos(a), y: r2 * Math.sin(a) })
  })
  return { pos, r1, r2 }
}
