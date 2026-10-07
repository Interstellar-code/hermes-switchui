/** Client-side DAG parse of a workflow YAML draft (layout + metrics). */
import { parse as parseYaml } from 'yaml'
import type { NodeType } from '../types'

export function inferNodeType(raw: Record<string, unknown>): NodeType {
  if (typeof raw['prompt'] === 'string') return 'prompt'
  if (typeof raw['command'] === 'string') return 'command'
  if (typeof raw['bash'] === 'string') return 'bash'
  if (typeof raw['script'] === 'string') return 'script'
  if (typeof raw['cancel'] === 'string') return 'cancel'
  if (raw['approval'] && typeof raw['approval'] === 'object') return 'approval'
  if (raw['loop'] && typeof raw['loop'] === 'object') return 'loop'
  return 'prompt'
}

export interface RawNode {
  id: string
  type: NodeType
  depends_on?: Array<string>
}

export interface DagInfo {
  nodes: Array<RawNode>
  node_count: number
  depth: number
  parallelism: number
  node_type_counts: Record<string, number>
  /** Positioned nodes for SVG: cx/cy = center point */
  positioned: Array<{
    id: string
    type: string
    cx: number
    cy: number
    layer: number
  }>
  edges: Array<[string, string]>
}

export interface DagError {
  error: string
}

/** Parse YAML string → DAG metrics + layout. Exported for smoke testing. */
export function parseDagFromYaml(yamlStr: string): DagInfo | DagError {
  try {
    const parsed = parseYaml(yamlStr) as Record<string, unknown>
    const rawNodes: Array<RawNode> = Array.isArray(parsed['nodes'])
      ? (parsed['nodes'] as Array<Record<string, unknown>>).map(
          (node, index) => ({
            id:
              typeof node['id'] === 'string' ? node['id'] : `node-${index + 1}`,
            type: inferNodeType(node),
            depends_on: Array.isArray(node['depends_on'])
              ? node['depends_on'].filter(
                  (dep): dep is string => typeof dep === 'string',
                )
              : [],
          }),
        )
      : []
    const node_count = rawNodes.length

    // Compute topo depth per node
    const depthMap: Record<string, number> = {}
    function nodeDepth(id: string, visited = new Set<string>()): number {
      if (id in depthMap) return depthMap[id]
      if (visited.has(id)) return 1 // cycle guard
      visited.add(id)
      const node = rawNodes.find((n) => n.id === id)
      const deps = node?.depends_on ?? []
      const d =
        deps.length === 0
          ? 1
          : 1 + Math.max(...deps.map((dep) => nodeDepth(dep, new Set(visited))))
      depthMap[id] = d
      return d
    }
    rawNodes.forEach((n) => nodeDepth(n.id))

    const depth =
      rawNodes.length === 0 ? 0 : Math.max(...Object.values(depthMap))

    // Group by layer for parallelism + layout
    const layers: Record<number, Array<RawNode>> = {}
    rawNodes.forEach((n) => {
      const d = depthMap[n.id] ?? 1
      ;(layers[d] ??= []).push(n)
    })
    const parallelism = Object.values(layers).reduce(
      (m, l) => Math.max(m, l.length),
      0,
    )

    const node_type_counts: Record<string, number> = {}
    rawNodes.forEach((n) => {
      node_type_counts[n.type] = (node_type_counts[n.type] ?? 0) + 1
    })

    // Layout: X by layer depth, Y by index within layer
    const NODE_W = 110,
      NODE_H = 34
    const LAYER_GAP = 140,
      ROW_GAP = 80,
      X_OFFSET = 60,
      Y_OFFSET = 50
    const capped = rawNodes.slice(0, 30)
    const positioned = capped.map((n) => {
      const layer = depthMap[n.id] ?? 1
      const layerNodes = layers[layer] ?? []
      const idx = layerNodes.indexOf(n)
      return {
        id: n.id,
        type: n.type,
        cx: (layer - 1) * LAYER_GAP + X_OFFSET + NODE_W / 2,
        cy: idx * ROW_GAP + Y_OFFSET,
        layer,
      }
    })

    // Edges from depends_on (capped set only)
    const cappedIds = new Set(capped.map((n) => n.id))
    const edges: Array<[string, string]> = []
    capped.forEach((n) => {
      ;(n.depends_on ?? []).forEach((dep) => {
        if (cappedIds.has(dep)) edges.push([dep, n.id])
      })
    })

    return {
      nodes: rawNodes,
      node_count,
      depth,
      parallelism,
      node_type_counts,
      positioned,
      edges,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
