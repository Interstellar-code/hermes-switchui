/**
 * Shared workflow type definitions — neutral names (no mock prefix).
 * Replaces mock-workflows.ts type exports.
 */

export type WorkflowSource = 'bundled' | 'user' | 'project'
export type VersionTier = 'v1' | 'v1.1'
export type NodeType = 'prompt' | 'bash' | 'command' | 'approval' | 'router' | 'loop'

export interface WorkflowDagNode {
  id: string
  label: string
  type: NodeType
  config?: string
}

export interface WorkflowSummary {
  id: string
  name: string
  description: string
  source: WorkflowSource
  tags: string[]
  node_count: number
  last_used_at: string | null
  version_tier: VersionTier
  has_loop: boolean
  has_approval: boolean
  // extended fields for editor
  required_inputs: string[]
  optional_inputs: string[]
  when_to_use: string
  dag_depth: number
  max_parallelism: number
  run_count: number
  dag: WorkflowDagNode[]
  dag_edges: [string, string][]
  yaml: string
}

/** Shape returned by GET /api/workflow-definitions/:id/parsed */
export interface ParsedWorkflow {
  name: string
  description: string
  nodes: Array<{ id: string; label?: string; type?: string; config?: string }>
  edges: Array<[string, string]>
  has_loop: boolean
  has_approval: boolean
  required_inputs: string[]
  optional_inputs: string[]
  node_count: number
}

/** Utility: relative time string from ISO/epoch timestamp */
export function relativeTime(ts: string | number | null | undefined): string {
  if (!ts) return 'Never'
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  if (isNaN(d.getTime())) return 'Never'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
