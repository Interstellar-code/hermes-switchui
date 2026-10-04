/**
 * dag-model.ts — pure model behind the Conductor canvas.
 *
 * The skeleton is always the parsed definition (nodes + depends_on edges);
 * node_runs only overlay status, times, loop iterations and tokens. Real
 * node_runs carry `depends_on: null` and may cover only a subset of nodes, so
 * they never add or remove nodes/edges.
 */

import type {
  RunSessionNode,
  RunSessions,
  SessionChild,
} from '@/server/workflow-engine/interface'
import type { StageLabel } from '@/screens/workflows/run-status'
import type { ParsedWorkflow } from '@/screens/workflows/types'
import { phaseLabel, toEpochMs } from '@/screens/workflows/run-status'

export const DAG_NODE_CAP = 60

/** Fields of a node_run row the canvas reads (NodeRunRow / engine NodeRun both fit). */
export interface DagNodeRun {
  id?: string
  dag_node_id: string
  status: string
  started_at?: string | number | null
  completed_at?: string | number | null
  loop_iteration?: number | null
  parent_subgraph_node_run_id?: string | null
  assigned_agent?: string | null
  worker_id?: string | null
  agent_profile_hint?: string | null
  /** B1 — absent until the backend reports it. */
  total_tokens?: number | null
}

export type Tier = 1 | 2 | 3

export interface DagNode {
  id: string
  label: string
  type: string
  /** Raw YAML `phase:` (null when absent). */
  phase: string | null
  stage: StageLabel
  /** Longest-path layer from the sources (0-based). */
  layer: number
  /** node_run status, or 'idle' when the run has no row for this node yet. */
  status: string
  startedAt: number | null
  completedAt: number | null
  /** Loop badge: `n/N` (N null when the definition doesn't say). */
  loop: { n: number; max: number | null } | null
  tokens: number | null
  agent: string | null
  /** Linked session rows (wrapper node_runs only); empty when none. */
  sessions: Array<RunSessionNode>
  /** Kept for C2; tier bands are not rendered yet (D4/D5). */
  tier: Tier
}

export interface StagePill {
  stage: StageLabel
  nodeIds: Array<string>
  status: 'pending' | 'running' | 'waiting' | 'done' | 'failed'
}

export interface DagModel {
  nodes: Array<DagNode>
  edges: Array<[string, string]>
  layerCount: number
  /** Nodes dropped by the 60-node cap ("+K more"). */
  hiddenCount: number
  stages: Array<StagePill>
}

type ParsedNode = ParsedWorkflow['nodes'][number]

/** T3 = loop iterations / subgraph work; T2 = has an agent; else T1. */
export function classifyTier(input: {
  agent: string | null
  loopIterations: number
  subgraph: boolean
  linkedSessions?: boolean
}): Tier {
  if (input.loopIterations > 0 || input.subgraph || input.linkedSessions)
    return 3
  return input.agent ? 2 : 1
}

const EXECUTE_TYPES = new Set(['loop', 'bash', 'command', 'subagent'])

/** D3: approval always REVIEW; YAML phase wins; else type/position. */
function stageFor(
  node: ParsedNode,
  index: number,
  firstPromptIndex: number,
  isLast: boolean,
): StageLabel {
  const type = node.type ?? ''
  if (type === 'approval') return 'REVIEW'
  if (type === 'router') return 'ROUTE'
  const fromYaml = phaseLabel(node.phase)
  if (fromYaml) return fromYaml
  if (EXECUTE_TYPES.has(type)) return 'EXECUTE'
  if (index === firstPromptIndex) return 'PLAN'
  if (isLast && index !== 0) return 'REPORT'
  return 'EXECUTE'
}

const STAGE_ORDER: Array<StageLabel> = [
  'PLAN',
  'ROUTE',
  'EXECUTE',
  'REVIEW',
  'REPORT',
]

function pillStatus(nodes: Array<DagNode>): StagePill['status'] {
  const s = new Set(nodes.map((n) => n.status))
  if (s.has('failed')) return 'failed'
  if (s.has('running')) return 'running'
  if (s.has('paused')) return 'waiting'
  if (
    nodes.length > 0 &&
    nodes.every((n) => n.status === 'completed' || n.status === 'skipped')
  )
    return 'done'
  return 'pending'
}

/** Pills in canonical order; only stages that have at least one node. */
export function deriveStages(nodes: Array<DagNode>): Array<StagePill> {
  return STAGE_ORDER.filter((stage) =>
    nodes.some((n) => n.stage === stage),
  ).map((stage) => {
    const inStage = nodes.filter((n) => n.stage === stage)
    return {
      stage,
      nodeIds: inStage.map((n) => n.id),
      status: pillStatus(inStage),
    }
  })
}

function maxIterations(node: ParsedNode): number | null {
  const m = /"max_iterations"\s*:\s*(\d+)/.exec(node.config_preview ?? '')
  return m ? Number(m[1]) : null
}

function countDescendants(children: Array<SessionChild>): number {
  return children.reduce((n, c) => n + 1 + countDescendants(c.children), 0)
}

/** Agents linked to a DAG node: its session plus every nested child. */
export function agentCount(sessions: Array<RunSessionNode>): number {
  return sessions.reduce(
    (n, s) => n + (s.session ? 1 : 0) + countDescendants(s.children),
    0,
  )
}

export function buildDag(
  parsed: ParsedWorkflow,
  nodeRuns: Array<DagNodeRun> = [],
  runSessions: RunSessions | null = null,
): DagModel {
  const defNodes = parsed.nodes
  const ids = new Set(defNodes.map((n) => n.id))

  // Edges: depends_on (null-safe) ∪ parsed.edges, deduped, both ends known.
  const edgeKeys = new Set<string>()
  const edges: Array<[string, string]> = []
  const addEdge = (from: string, to: string) => {
    const key = `${from}\u0000${to}`
    if (!ids.has(from) || !ids.has(to) || edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push([from, to])
  }
  for (const n of defNodes)
    for (const dep of n.depends_on ?? []) addEdge(dep, n.id)
  for (const [from, to] of parsed.edges) addEdge(from, to)

  // Longest-path layering (Kahn). Cycle leftovers go after the last layer.
  const preds = new Map(defNodes.map((n) => [n.id, [] as Array<string>]))
  const succs = new Map(defNodes.map((n) => [n.id, [] as Array<string>]))
  for (const [from, to] of edges) {
    preds.get(to)!.push(from)
    succs.get(from)!.push(to)
  }
  const layer = new Map<string, number>()
  const indeg = new Map(defNodes.map((n) => [n.id, preds.get(n.id)!.length]))
  const queue = defNodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  for (const id of queue) layer.set(id, 0)
  while (queue.length) {
    const id = queue.shift()!
    for (const next of succs.get(id)!) {
      layer.set(next, Math.max(layer.get(next) ?? 0, layer.get(id)! + 1))
      indeg.set(next, indeg.get(next)! - 1)
      if (indeg.get(next) === 0) queue.push(next)
    }
  }
  // Cycle members never reach indeg 0 but may carry a partial layer; place
  // them all after the deepest layer reached by acyclic nodes.
  const isCyclic = (id: string) => indeg.get(id)! > 0
  const maxLayer = Math.max(
    -1,
    ...defNodes.filter((n) => !isCyclic(n.id)).map((n) => layer.get(n.id)!),
  )
  for (const n of defNodes) if (isCyclic(n.id)) layer.set(n.id, maxLayer + 1)

  // Overlay rows per node; subgraph children belong to another definition.
  const runsByNode = new Map<string, Array<DagNodeRun>>()
  for (const nr of nodeRuns) {
    if (nr.parent_subgraph_node_run_id) continue
    const list = runsByNode.get(nr.dag_node_id) ?? []
    list.push(nr)
    runsByNode.set(nr.dag_node_id, list)
  }

  // Sessions attach to wrapper rows only: drop ones owned by iteration or
  // subgraph-child rows (matched by node_run_id when known).
  const nonWrapperIds = new Set(
    nodeRuns
      .filter(
        (r) =>
          r.id && (r.loop_iteration != null || r.parent_subgraph_node_run_id),
      )
      .map((r) => r.id!),
  )
  const sessionsByNode = new Map<string, Array<RunSessionNode>>()
  for (const sn of runSessions?.nodes ?? []) {
    if (nonWrapperIds.has(sn.node_run_id)) continue
    const list = sessionsByNode.get(sn.dag_node_id) ?? []
    list.push(sn)
    sessionsByNode.set(sn.dag_node_id, list)
  }

  const firstPromptIndex = defNodes.findIndex((n) => n.type === 'prompt')
  // "Last" = a sink (no successors); falls back to YAML order for a lone chain end.
  const sinks = defNodes.filter((n) => succs.get(n.id)!.length === 0)
  const lastId = (sinks.at(-1) ?? defNodes.at(-1))?.id

  const all: Array<DagNode> = defNodes.map((n, i) => {
    const runs = runsByNode.get(n.id) ?? []
    const iterations = new Set(
      runs.map((r) => r.loop_iteration).filter((x): x is number => x != null),
    )
    // Status/times come from the node's own row; iteration rows only count.
    const own =
      runs.filter((r) => r.loop_iteration == null).at(-1) ?? runs.at(-1)
    const agent =
      runs.find((r) => r.assigned_agent)?.assigned_agent ??
      runs.find((r) => r.worker_id)?.worker_id ??
      runs.find((r) => r.agent_profile_hint)?.agent_profile_hint ??
      n.hermes_task?.agent_hint ??
      null
    const tokenRows = runs.filter(
      (r) => r.loop_iteration == null && r.total_tokens != null,
    )
    const isLoop = n.type === 'loop'
    const sessions = sessionsByNode.get(n.id) ?? []
    return {
      id: n.id,
      label: n.label ?? n.id,
      type: n.type ?? 'prompt',
      phase: n.phase ?? null,
      stage: stageFor(n, i, firstPromptIndex, n.id === lastId),
      layer: layer.get(n.id)!,
      status: own?.status ?? 'idle',
      startedAt: toEpochMs(own?.started_at),
      completedAt: toEpochMs(own?.completed_at),
      loop:
        isLoop || iterations.size > 0
          ? { n: iterations.size, max: maxIterations(n) }
          : null,
      tokens: tokenRows.length
        ? tokenRows.reduce((sum, r) => sum + (r.total_tokens ?? 0), 0)
        : null,
      agent,
      sessions,
      tier: classifyTier({
        linkedSessions: agentCount(sessions) > 0,
        agent,
        loopIterations: iterations.size,
        subgraph: Boolean(n.subgraph) || n.type === 'subgraph',
      }),
    }
  })

  // ponytail: plain cap by (layer, definition order); collapse/expand if 60+ node DAGs show up.
  const order = new Map(defNodes.map((n, i) => [n.id, i]))
  const sorted = [...all].sort(
    (a, b) => a.layer - b.layer || order.get(a.id)! - order.get(b.id)!,
  )
  const nodes = sorted.slice(0, DAG_NODE_CAP)
  const visible = new Set(nodes.map((n) => n.id))

  return {
    nodes,
    edges: edges.filter(([a, b]) => visible.has(a) && visible.has(b)),
    layerCount: nodes.length ? Math.max(...nodes.map((n) => n.layer)) + 1 : 0,
    hiddenCount: all.length - nodes.length,
    stages: deriveStages(nodes),
  }
}

/** Loop badge text: "3/5", or "3" when the max is unknown. */
export function loopBadge(loop: DagNode['loop']): string | null {
  if (!loop) return null
  return loop.max != null ? `${loop.n}/${loop.max}` : String(loop.n)
}
