/**
 * Switch UI workflow-engine API client.
 *
 * Thin typed wrappers over /api/workflow-definitions and /api/workflow-runs.
 * Used by use-workflows.ts hooks. Same-origin fetch — auth cookie sent by
 * default; no token plumbing needed here.
 */

import type { ParsedWorkflow } from './types'

export interface WorkflowDefinitionRow {
  id: string
  name: string
  description: string | null
  source: 'bundled' | 'user' | 'project'
  scope_path: string | null
  yaml: string
  checksum: string
  version: string | null
  tags: string | null // JSON-encoded string[]
  created_at: number
  updated_at: number
  node_count: number
  run_count: number
  last_used_at: number | null
}

export async function listWorkflowDefinitions(params?: {
  source?: 'bundled' | 'user' | 'project'
}): Promise<Array<WorkflowDefinitionRow>> {
  const qs = params?.source ? `?source=${encodeURIComponent(params.source)}` : ''
  const res = await fetch(`/api/workflow-definitions${qs}`)
  if (!res.ok) {
    throw new Error(`listWorkflowDefinitions failed (${res.status})`)
  }
  const body = (await res.json()) as { definitions: Array<WorkflowDefinitionRow> }
  return body.definitions
}

export interface WorkflowDefinitionParsedResponse {
  definition: WorkflowDefinitionRow
  parsed: ParsedWorkflow
}

export async function getWorkflowDefinitionParsed(id: string): Promise<WorkflowDefinitionParsedResponse> {
  const res = await fetch(`/api/workflow-definitions/${encodeURIComponent(id)}/parsed`)
  if (!res.ok) {
    throw new Error(`getWorkflowDefinitionParsed failed (${res.status})`)
  }
  return (await res.json()) as WorkflowDefinitionParsedResponse
}

export interface LaunchWorkflowInput {
  workflow_id: string
  conversation_id: string
  user_message: string
  working_path?: string
  variables?: Record<string, unknown>
}

export interface PhaseTransition {
  id: string
  from_phase: string | null
  to_phase: string
  decided_by: string
  decision_data: Record<string, unknown> | null
  at: number
}

export interface WorkflowRunRow {
  id: string
  workflow_id: string
  conversation_id: string
  status: string
  current_phase: string
  user_message: string
  working_path: string
  started_at: string | number
  completed_at: string | number | null
  error: string | null
}

export interface NodeRunRow {
  id: string
  workflow_run_id: string
  dag_node_id: string
  node_type: string
  status: string
  kanban_task_id: string | null
  started_at: string | number | null
  completed_at: string | number | null
  summary: string | null
  error: string | null
  approval_message?: string | null
  approval_response?: string | null
  approval_target?: string | null
}

export interface ApproveWorkflowInput {
  node_run_id: string
  decision: 'approved' | 'rejected'
  response?: string
}

export async function approveWorkflowRun(
  runId: string,
  input: ApproveWorkflowInput,
): Promise<{ ok: true; decision: 'approved' | 'rejected'; resumedRunId: string }> {
  const res = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`approveWorkflowRun failed (${res.status}): ${text}`)
  }
  return (await res.json()) as { ok: true; decision: 'approved' | 'rejected'; resumedRunId: string }
}

export interface WorkflowEventRow {
  id: string
  workflow_run_id: string
  event_type: string
  data: string | null
  created_at: number
}

export interface WorkflowRunDetail {
  run: WorkflowRunRow
  nodeRuns: Array<NodeRunRow>
  events: Array<WorkflowEventRow>
  phaseTransitions: Array<PhaseTransition>
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunDetail> {
  const res = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}`)
  if (!res.ok) {
    throw new Error(`getWorkflowRun failed (${res.status})`)
  }
  return (await res.json()) as WorkflowRunDetail
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  const res = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}?action=cancel`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`cancelWorkflowRun failed (${res.status})`)
  }
}

export async function launchWorkflowRun(input: LaunchWorkflowInput): Promise<{ run: { id: string } }> {
  const res = await fetch(`/api/workflow-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`launchWorkflowRun failed (${res.status}): ${text}`)
  }
  return (await res.json()) as { run: { id: string } }
}

export interface UpsertWorkflowDefinitionInput {
  id: string
  name: string
  description?: string
  source: 'user' | 'project'
  scope_path?: string
  yaml: string
  version?: string
  tags?: Array<string>
}

export interface UpsertWorkflowDefinitionError {
  error: string
}

export async function upsertWorkflowDefinition(
  input: UpsertWorkflowDefinitionInput,
): Promise<{ definition: WorkflowDefinitionRow }> {
  const res = await fetch('/api/workflow-definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as UpsertWorkflowDefinitionError
    throw Object.assign(new Error(body.error || `upsertWorkflowDefinition failed (${res.status})`), {
      status: res.status,
      serverError: body.error,
    })
  }
  return (await res.json()) as { definition: WorkflowDefinitionRow }
}

export async function deleteWorkflowDefinition(id: string): Promise<void> {
  const res = await fetch(`/api/workflow-definitions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as UpsertWorkflowDefinitionError
    throw Object.assign(new Error(body.error || `deleteWorkflowDefinition failed (${res.status})`), {
      status: res.status,
    })
  }
}
