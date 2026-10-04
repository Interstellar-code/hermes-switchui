/**
 * memory-map-graph — pure helpers for the Memory Map tab (no DOM, no d3).
 *
 * Types mirror src/server/memory-graph.ts (GET /api/memory/graph).
 */

export type Kind = 'gist' | 'fact' | 'wiki' | 'entity' | 'working' | 'episodic'
export type EdgeType =
  | 'ctx'
  | 'references'
  | 'mentions'
  | 'about'
  | 'relates'
  | 'summarizes'

export type GraphNode = {
  id: string
  kind: Kind
  label: string
  /** fact nodes: identical facts collapsed into this one (>1 only). */
  count?: number
  firstAt?: string | null
  lastAt?: string | null
  factIds?: Array<string>
}
export type GraphEdge = {
  source: string
  target: string
  edgeType: EdgeType
  weight: number
  occurrences: number
  timestamp: string | null
}
export type GraphMeta = {
  rawEdgeCount: number
  edgeCount: number
  nodeCount: number
  truncated: boolean
  dbMissing: boolean
  generatedAt: string
  junkDropped?: number
  junkFacts?: number
  duplicateFacts?: number
  byType?: Record<EdgeType, number>
  droppedByType?: Record<EdgeType, number>
}
export type GraphResponse = {
  nodes: Array<GraphNode>
  edges: Array<GraphEdge>
  meta: GraphMeta
}

/** GET /api/memory/graph/node?id= (mirrors src/server/memory-graph-node.ts). */
export type GraphNodeDetail = {
  id: string
  kind: Kind
  label: string
  text: string
  createdAt: string | null
  updatedAt: string | null
  source: Record<string, string | number>
  count?: number
  firstAt?: string | null
  lastAt?: string | null
  facts?: Array<{
    id: string
    text: string
    count: number
    firstAt: string | null
    lastAt: string | null
  }>
}

/** Default focused view size (top-N by degree). */
export const DEFAULT_NODE_LIMIT = 2000

// "(ASSISTANT) …", "[user] …", "assistant: …" — chat-log role prefixes.
const ROLE_PREFIX =
  /^(?:[([]\s*(?:assistant|user|system|tool|human|ai)\s*[)\]]\s*:?|(?:assistant|user|system|tool|human|ai)\s*:)\s*/i

export function cleanLabel(label: string): string {
  let s = label.replace(/\s+/g, ' ').trim()
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(ROLE_PREFIX, '')
  }
  return s
}

/** Short canvas label; episodic chat text is never drawn raw. */
export function shortLabel(
  node: GraphNode,
  max = 28,
  date: string | null = null,
): string {
  if (node.kind === 'episodic') {
    return date ? `episode · ${date.slice(0, 10)}` : 'episode'
  }
  const s = cleanLabel(node.label) || node.id
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function degreeMap(
  edges: ReadonlyArray<GraphEdge>,
): Map<string, number> {
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  return deg
}

export type NodeDates = { first: string; last: string }

/** Earliest + latest incident-edge timestamp per node (nodes carry no date of their own). */
export function nodeDates(
  edges: ReadonlyArray<GraphEdge>,
): Map<string, NodeDates> {
  const out = new Map<string, NodeDates>()
  for (const e of edges) {
    const t = e.timestamp
    if (!t) continue
    for (const id of [e.source, e.target]) {
      const cur = out.get(id)
      if (!cur) out.set(id, { first: t, last: t })
      else {
        if (t < cur.first) cur.first = t
        if (t > cur.last) cur.last = t
      }
    }
  }
  return out
}

// ── redesign contracts (Phase 0; bodies land in later lanes) ────────────────

export type ColourBy = 'cluster' | 'kind' | 'age'

export interface ClusterResult {
  clusterOf: Map<string, number>
  clusters: Array<{
    id: number
    name: string
    size: number
    /** Palette slot 0-7 (`--mm-cluster-N`); null = "Other". */
    slot: number | null
  }>
}

/** Map view state — local to memory-map.tsx, prop-drilled to rail/inspector. */
export interface MapViewState {
  colourBy: ColourBy
  kinds: Record<Kind, boolean>
  types: Record<EdgeType, boolean>
  minDegree: number
  selectedId: string | null
  selectedCluster: number | null
  focus: { id: string; hops: 1 | 2; types: Set<EdgeType> } | null
}

export interface InspectorData {
  node: GraphNode
  clusterId: number | null
  connections: number
  firstSeen?: string
  lastSeen?: string
  linkedEntities: Array<GraphNode>
  mentionedIn: Array<{ node: GraphNode; at?: string }>
}

/** Graph lookups the inspector derives from (built once per dataset in memory-map.tsx). */
export interface InspectorModel {
  byId: Map<string, GraphNode>
  deg: Map<string, number>
  dates: Map<string, NodeDates>
  adj: Map<string, Set<string>>
}

/** Stub — Lane D fills it from `model.adj`. */
export function deriveInspector(
  model: InspectorModel,
  id: string,
  clusters: ClusterResult | null,
): InspectorData | undefined {
  const node = model.byId.get(id)
  if (!node) return undefined
  return {
    node,
    clusterId: clusters?.clusterOf.get(id) ?? null,
    connections: model.deg.get(id) ?? 0,
    linkedEntities: [],
    mentionedIn: [],
  }
}

export type VisibilityOptions = {
  kinds: Record<Kind, boolean>
  types: Record<EdgeType, boolean>
  minDegree: number
  /** null = show every node that passes the filters. */
  limit: number | null
  /** Always shown (if its kind is on), regardless of limit / minDegree. */
  pinned?: string | null
}

export type VisibleGraph = {
  nodeIds: Set<string>
  /** Indices into the input edges array. */
  edgeIdx: Array<number>
  /** Nodes left after the kind / edge-type / degree cut, before the limit. */
  candidates: number
}

export function computeVisibleGraph(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  opts: VisibilityOptions,
): VisibleGraph {
  const kindOf = new Map<string, Kind>()
  for (const n of nodes) kindOf.set(n.id, n.kind)
  const kindOn = (id: string) => {
    const k = kindOf.get(id)
    return k != null && opts.kinds[k]
  }
  const edgeOn = (e: GraphEdge, among: Set<string>) =>
    opts.types[e.edgeType] && among.has(e.source) && among.has(e.target)
  const degreeIn = (among: Set<string>) => {
    const d = new Map<string, number>()
    for (const e of edges) {
      if (!edgeOn(e, among)) continue
      d.set(e.source, (d.get(e.source) ?? 0) + 1)
      d.set(e.target, (d.get(e.target) ?? 0) + 1)
    }
    return d
  }
  // Wiki pages may stand alone (the server keeps them edgeless); anything
  // else needs at least one visible edge, else it is a stray dot.
  const floorOf = (id: string) =>
    kindOf.get(id) === 'wiki' ? opts.minDegree : Math.max(1, opts.minDegree)

  // Peel to a fixed point: dropping a node lowers its neighbours' visible
  // degree, which can push them under the floor in turn.
  // ponytail: O(E) per pass, passes <= peel depth; fine at 20k edges.
  let ok = new Set(nodes.filter((n) => opts.kinds[n.kind]).map((n) => n.id))
  let deg = degreeIn(ok)
  for (;;) {
    const next = new Set(
      [...ok].filter((id) => (deg.get(id) ?? 0) >= floorOf(id)),
    )
    if (next.size === ok.size) break
    ok = next
    deg = degreeIn(ok)
  }

  const byDeg = (a: string, b: string) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0)
  let nodeIds: Set<string>
  if (opts.limit == null || ok.size <= opts.limit) {
    nodeIds = new Set(ok)
  } else {
    // Plain top-N by degree is a scatter: hubs mostly link to nodes outside
    // the cut. Take the top fifth as hubs, then grow outward ring by ring
    // (best-connected neighbours first) so every added node touches the
    // picture; top up by degree only if the rings run dry.
    const ranked = [...ok].sort(byDeg)
    nodeIds = new Set(ranked.slice(0, Math.ceil(opts.limit / 5)))
    const adj = new Map<string, Array<string>>()
    for (const e of edges) {
      if (!edgeOn(e, ok)) continue
      ;(adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(
        e.target,
      )
      ;(adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(
        e.source,
      )
    }
    // frontier BFS: each ring only expands the nodes added by the last one
    let frontier = [...nodeIds]
    while (frontier.length > 0 && nodeIds.size < opts.limit) {
      const near = new Set<string>()
      for (const id of frontier)
        for (const nb of adj.get(id) ?? []) if (!nodeIds.has(nb)) near.add(nb)
      frontier = []
      for (const id of [...near].sort(byDeg)) {
        if (nodeIds.size >= opts.limit) break
        nodeIds.add(id)
        frontier.push(id)
      }
    }
    for (const id of ranked) {
      if (nodeIds.size >= opts.limit) break
      nodeIds.add(id)
    }
    // the cut can strand a node whose edges all leave it
    const cutDeg = degreeIn(nodeIds)
    for (const id of nodeIds)
      if (!cutDeg.get(id) && kindOf.get(id) !== 'wiki') nodeIds.delete(id)
  }

  if (opts.pinned && kindOn(opts.pinned)) nodeIds.add(opts.pinned)

  const edgeIdx: Array<number> = []
  edges.forEach((e, i) => {
    if (edgeOn(e, nodeIds)) edgeIdx.push(i)
  })
  return { nodeIds, edgeIdx, candidates: ok.size }
}

export type SearchEntry = { node: GraphNode; label: string; id: string }

/** Lowercased clean label + id per node; build once per dataset. */
export function buildSearchIndex(
  nodes: ReadonlyArray<GraphNode>,
): Array<SearchEntry> {
  return nodes.map((node) => ({
    node,
    label: cleanLabel(node.label).toLowerCase(),
    id: node.id.toLowerCase(),
  }))
}

/**
 * Case-insensitive label/id search. `ids` holds every hit (the one predicate
 * behind both the count and the canvas highlight); `matches` is the top
 * `limit`, prefix hits first, then by degree.
 */
export function searchNodes(
  index: ReadonlyArray<SearchEntry>,
  query: string,
  deg: Map<string, number>,
  limit = 8,
): { matches: Array<GraphNode>; total: number; ids: Set<string> } {
  const q = query.trim().toLowerCase()
  const ids = new Set<string>()
  if (!q) return { matches: [], total: 0, ids }
  const hits: Array<{ n: GraphNode; prefix: boolean }> = []
  for (const e of index) {
    if (e.label.includes(q) || e.id.includes(q)) {
      ids.add(e.node.id)
      hits.push({ n: e.node, prefix: e.label.startsWith(q) })
    }
  }
  hits.sort(
    (a, b) =>
      Number(b.prefix) - Number(a.prefix) ||
      (deg.get(b.n.id) ?? 0) - (deg.get(a.n.id) ?? 0),
  )
  return {
    matches: hits.slice(0, limit).map((h) => h.n),
    total: hits.length,
    ids,
  }
}
