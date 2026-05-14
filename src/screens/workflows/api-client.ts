/**
 * Switch UI workflow-engine API client.
 *
 * Thin typed wrappers over /api/workflow-definitions and /api/workflow-runs.
 * Used by use-workflows.ts hooks. Same-origin fetch — auth cookie sent by
 * default; no token plumbing needed here.
 */

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
}

export async function listWorkflowDefinitions(params?: {
  source?: 'bundled' | 'user' | 'project'
}): Promise<WorkflowDefinitionRow[]> {
  const qs = params?.source ? `?source=${encodeURIComponent(params.source)}` : ''
  const res = await fetch(`/api/workflow-definitions${qs}`)
  if (!res.ok) {
    throw new Error(`listWorkflowDefinitions failed (${res.status})`)
  }
  const body = (await res.json()) as { definitions: WorkflowDefinitionRow[] }
  return body.definitions
}

export interface LaunchWorkflowInput {
  workflow_id: string
  conversation_id: string
  user_message: string
  working_path?: string
  variables?: Record<string, unknown>
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
