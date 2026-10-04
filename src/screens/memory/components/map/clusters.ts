/**
 * clusters — deterministic weighted label propagation over the memory graph.
 *
 * Pure (no DOM): runs once per fetched dataset on the main thread.
 */
import { degreeMap, nodeDates, shortLabel } from '../memory-map-graph'
import type { ClusterResult, GraphEdge, GraphNode } from '../memory-map-graph'

export const OTHER_CLUSTER_ID = -1
const MIN_SIZE = 5
const SLOTS = 8
const MAX_ITERS = 20

/** Fewer member links than this and an entity is too incidental to name a cluster. */
const MIN_NAME_DEGREE = 3

// Variant: plain weighted LPA over ALL edge types, no hub damping. Measured on
// the real hermes-switch graph (9144 nodes / 20k edges, 2026-10-04):
//   plain            largest 12.1%, Other 44%, top-8 incl. SwitchUI · Interstellar, PR · Neo, BLR · Trek
//   no ctx           largest 12.7%, Other 45%, ~same groups
//   1/log2(deg+1)    largest 17.1%, Other 67% — hubs lose pull, tail shatters
//   no ctx + damp    largest  9.3%, Other 69%
// No giant-cluster collapse, so the §6 mitigations were not needed.
// ponytail: plain LPA, O(E·iters) (~35 ms here). Upgrade path if clusters read
// noisy: Louvain (graphology-communities-louvain) behind the same
// ClusterResult contract; wrap in a Web Worker if this exceeds 50 ms.
export function computeClusters(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
): ClusterResult {
  // Id order makes the result independent of input order.
  const sorted = [...nodes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const n = sorted.length
  const idx = new Map<string, number>()
  sorted.forEach((node, i) => idx.set(node.id, i))

  const used = edges.filter((e) => e.source !== e.target)
  const adj: Array<Array<[number, number]>> = Array.from(
    { length: n },
    () => [],
  )
  for (const e of used) {
    const s = idx.get(e.source)
    const t = idx.get(e.target)
    if (s === undefined || t === undefined) continue
    const w = Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 1
    adj[s].push([t, w])
    adj[t].push([s, w])
  }
  // Fixed summation order → bit-identical float scores regardless of edge order.
  for (const list of adj) list.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const label = Int32Array.from({ length: n }, (_, i) => i)
  const score = new Float64Array(n)
  const touched: Array<number> = []
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      const list = adj[i]
      if (list.length === 0) continue
      for (const [j, w] of list) {
        const l = label[j]
        if (score[l] === 0) touched.push(l)
        score[l] += w
      }
      let best = label[i]
      let bestScore = -1
      for (const l of touched) {
        const s = score[l]
        if (s > bestScore || (s === bestScore && l < best)) {
          best = l
          bestScore = s
        }
        score[l] = 0
      }
      touched.length = 0
      if (best !== label[i]) {
        label[i] = best
        changed = true
      }
    }
    if (!changed) break
  }

  const groups = new Map<number, Array<number>>()
  for (let i = 0; i < n; i++) {
    const g = groups.get(label[i])
    if (g) g.push(i)
    else groups.set(label[i], [i])
  }
  // Members are pushed in index order, so g[0] is the smallest member id.
  const ranked = [...groups.values()]
    .filter((g) => g.length >= MIN_SIZE)
    .sort((a, b) => b.length - a.length || a[0] - b[0])
    .slice(0, SLOTS)

  const deg = degreeMap(edges)
  const dates = nodeDates(edges)
  const slotOf = new Int32Array(n).fill(OTHER_CLUSTER_ID)
  ranked.forEach((members, slot) => {
    for (const i of members) slotOf[i] = slot
  })
  const clusterOf = new Map<string, number>()
  sorted.forEach((node, i) => clusterOf.set(node.id, slotOf[i]))
  const clusters: ClusterResult['clusters'] = ranked.map((members, slot) => ({
    id: slot,
    name: nameOf(members, slot),
    size: members.length,
    slot,
  }))
  const otherSize = n - ranked.reduce((sum, g) => sum + g.length, 0)
  if (otherSize > 0) {
    clusters.push({
      id: OTHER_CLUSTER_ID,
      name: 'Other',
      size: otherSize,
      slot: null,
    })
  }
  return { clusterOf, clusters }

  /**
   * Most DISTINCTIVE entity, TF-IDF-like:
   *   score = linksFromMembers × log((N+1) / (globalDeg+1))
   * so entities linked everywhere ("Status", "PASS") lose to cluster-specific
   * ones. Candidates: entities inside the cluster with >= MIN_NAME_DEGREE member
   * links; if none (episode-hub clusters), entities 1 hop outside it. Fallback:
   * the highest-degree member (episodic → "episode · <date>"). The runner-up is
   * appended ("A · B") when it scores >= 0.6 × the winner.
   */
  function nameOf(members: Array<number>, slot: number): string {
    const links = new Map<number, number>()
    for (const i of members) {
      for (const [j] of adj[i]) {
        if (sorted[j].kind === 'entity') links.set(j, (links.get(j) ?? 0) + 1)
      }
    }
    const top = (inside: boolean) => {
      const scored: Array<[number, number]> = []
      for (const [j, c] of links) {
        if (c < MIN_NAME_DEGREE || (slotOf[j] === slot) !== inside) continue
        const idf = Math.log((n + 1) / ((deg.get(sorted[j].id) ?? 0) + 1))
        scored.push([j, c * idf])
      }
      // Ties → smallest id (index order = id order).
      return scored.sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2)
    }
    const inside = top(true)
    const best = inside.length ? inside : top(false)
    if (best.length && best[0][1] > 0) {
      const name = shortLabel(sorted[best[0][0]])
      return best.length > 1 && best[1][1] >= 0.6 * best[0][1]
        ? `${name} · ${shortLabel(sorted[best[1][0]])}`
        : name
    }
    let hub = members[0]
    for (const i of members) {
      if ((deg.get(sorted[i].id) ?? 0) > (deg.get(sorted[hub].id) ?? 0)) hub = i
    }
    const node = sorted[hub]
    return shortLabel(node, 28, dates.get(node.id)?.first ?? null)
  }
}
