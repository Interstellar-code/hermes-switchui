/**
 * Shared workflow type definitions — neutral names (no mock prefix).
 * Replaces mock-workflows.ts type exports.
 */

export type WorkflowSource = 'bundled' | 'user' | 'project'
export type VersionTier = 'v1' | 'v1.1'
export type NodeType =
  | 'prompt'
  | 'bash'
  | 'command'
  | 'approval'
  | 'router'
  | 'loop'
  | 'cancel'
  | 'script'
  | 'subgraph'

export interface HermesTaskHint {
  skills?: Array<string>
  agent_hint?: string | null
  model_hint?: string | null
}

/** Subgraph reference on a DAG node (A.7-subgraphs). */
export interface SubgraphRef {
  ref: string
  inputs?: Record<string, unknown>
  when?: string
}

export interface WorkflowDagNode {
  id: string
  label: string
  type: NodeType
  phase?: string | null
  hermes_task?: HermesTaskHint | null
  config?: string
  /** Present when the node expands a subgraph definition (A.7-subgraphs). */
  subgraph?: SubgraphRef | null
}

export interface WorkflowSummary {
  id: string
  name: string
  description: string
  source: WorkflowSource
  tags: Array<string>
  node_count: number
  last_used_at: string | null
  version_tier: VersionTier
  has_loop: boolean
  has_approval: boolean
  // extended fields for editor
  required_inputs: Array<string>
  optional_inputs: Array<string>
  when_to_use: string
  dag_depth: number
  max_parallelism: number
  /** Absent when the definitions API returns no run data — render "—", not 0. */
  run_count?: number
  dag: Array<WorkflowDagNode>
  dag_edges: Array<[string, string]>
  yaml: string
  /** 'workflow' (default) | 'subgraph' — subgraphs are hidden from the grid by default (A.7). */
  kind?: 'workflow' | 'subgraph'
  /** 1 once a user has edited this bundled row; absent on legacy rows = treat as 0. */
  user_modified?: 0 | 1
  /** sha256 of the factory yaml this row was seeded/reset from; null for pure user rows. */
  bundled_checksum?: string | null
  node_types?: Array<string>
  updated_at?: number
  created_at?: number
  version?: string | null
}

/** One declared workflow input (`default` only when the YAML declares it). */
export interface WorkflowInputDetail {
  name: string
  type: string
  required: boolean
  default?: unknown
  description?: string
}

/** Shape returned by GET /api/workflow-definitions/:id/parsed */
export interface ParsedWorkflow {
  name: string
  description: string
  nodes: Array<{
    id: string
    label?: string
    type?: string
    phase?: string | null
    hermes_task?: HermesTaskHint | null
    config?: string
    config_preview?: string
    /** Present when the node expands a subgraph definition (A.7-subgraphs). */
    subgraph?: SubgraphRef | null
    depends_on?: Array<string> | null
  }>
  edges: Array<[string, string]>
  has_loop: boolean
  has_approval: boolean
  required_inputs: Array<string>
  optional_inputs: Array<string>
  inputs_detail?: Array<WorkflowInputDetail>
  node_count: number
}

/** Version chip text: "—" when the API gives no version (QA1 F1-3). */
export function formatVersion(version?: string | null): string {
  return version ? `v${version}` : '—'
}

/**
 * Numeric workflow timestamps are a mix of epoch seconds (older rows, e.g.
 * gateway-health-check-v2) and epoch milliseconds — anything below 1e12
 * cannot be a current-era ms value, so it is seconds (QA2 NEW-1).
 */
export function toEpochMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

/** Utility: relative time string from ISO/epoch timestamp */
export function relativeTime(ts: string | number | null | undefined): string {
  if (!ts) return 'Never'
  const d = typeof ts === 'number' ? new Date(toEpochMs(ts)) : new Date(ts)
  if (isNaN(d.getTime())) return 'Never'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
