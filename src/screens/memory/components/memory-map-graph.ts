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

export type GraphNode = { id: string; kind: Kind; label: string }
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
}

/** Default focused view size (top-N by degree). */
export const DEFAULT_NODE_LIMIT = 300

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

/** Latest incident-edge timestamp per node (nodes carry no date of their own). */
export function nodeDates(
  edges: ReadonlyArray<GraphEdge>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of edges) {
    if (!e.timestamp) continue
    for (const id of [e.source, e.target]) {
      const cur = out.get(id)
      if (!cur || e.timestamp > cur) out.set(id, e.timestamp)
    }
  }
  return out
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
  /** Nodes passing the kind / edge-type / degree filters before the limit. */
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

  const deg = new Map<string, number>()
  for (const e of edges) {
    if (!opts.types[e.edgeType] || !kindOn(e.source) || !kindOn(e.target))
      continue
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }

  const candidates = nodes.filter(
    (n) => opts.kinds[n.kind] && (deg.get(n.id) ?? 0) >= opts.minDegree,
  )
  const byDeg = (a: string, b: string) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0)
  let nodeIds: Set<string>
  if (opts.limit == null || candidates.length <= opts.limit) {
    nodeIds = new Set(candidates.map((n) => n.id))
  } else {
    // Plain top-N by degree is a scatter: hubs mostly link to nodes outside
    // the cut. Take the top fifth as hubs, fill with their best-connected
    // neighbours, then top up by degree.
    const ok = new Set(candidates.map((n) => n.id))
    const ranked = [...ok].sort(byDeg)
    nodeIds = new Set(ranked.slice(0, Math.ceil(opts.limit / 5)))
    const near = new Set<string>()
    for (const e of edges) {
      if (!opts.types[e.edgeType] || !ok.has(e.source) || !ok.has(e.target))
        continue
      if (nodeIds.has(e.source) && !nodeIds.has(e.target)) near.add(e.target)
      if (nodeIds.has(e.target) && !nodeIds.has(e.source)) near.add(e.source)
    }
    for (const id of [...[...near].sort(byDeg), ...ranked]) {
      if (nodeIds.size >= opts.limit) break
      nodeIds.add(id)
    }
  }

  if (opts.pinned && kindOn(opts.pinned)) nodeIds.add(opts.pinned)

  const edgeIdx: Array<number> = []
  edges.forEach((e, i) => {
    if (
      opts.types[e.edgeType] &&
      nodeIds.has(e.source) &&
      nodeIds.has(e.target)
    ) {
      edgeIdx.push(i)
    }
  })
  return { nodeIds, edgeIdx, candidates: candidates.length }
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
