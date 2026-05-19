/**
 * Switch UI workflow-engine API client.
 *
 * Thin typed wrappers over /api/workflow-definitions and /api/workflow-runs.
 * Used by use-workflows.ts hooks. Same-origin fetch — auth cookie sent by
 * default; no token plumbing needed here.
 */

import type { ParsedWorkflow } from './types'
import { readResolvedSessionHeaders } from '@/lib/send-stream-session-headers'
import { useWorkflowBackendStore } from '@/stores/workflow-backend-store'

/**
 * Wrapper around fetch that injects the X-Workflow-Backend header so the
 * server factory.ts can select the correct engine (native vs plugin).
 * Only used for /api/workflow-* calls.
 */
function wfFetch(input: string, init?: RequestInit): Promise<Response> {
  const backend =
    typeof window !== 'undefined'
      ? useWorkflowBackendStore.getState().backend
      : 'native'
  const headers = new Headers(init?.headers)
  headers.set('X-Workflow-Backend', backend)
  return fetch(input, { ...init, headers })
}

export interface WorkflowDefinitionRow {
  id: string
  name: string
  description: string | null
  source: 'bundled' | 'user' | 'project'
  scope_path: string | null
  yaml: string
  checksum: string
  version: string | null
  /** 'workflow' (default) | 'subgraph' — subgraphs are hidden from the library grid by default (A.7). */
  kind?: 'workflow' | 'subgraph'
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
  const qs = params?.source
    ? `?source=${encodeURIComponent(params.source)}`
    : ''
  const res = await wfFetch(`/api/workflow-definitions${qs}`)
  if (!res.ok) {
    throw new Error(`listWorkflowDefinitions failed (${res.status})`)
  }
  const body = (await res.json()) as {
    definitions: Array<WorkflowDefinitionRow>
  }
  return body.definitions
}

export interface WorkflowDefinitionParsedResponse {
  definition: WorkflowDefinitionRow
  parsed: ParsedWorkflow
}

export async function getWorkflowDefinitionParsed(
  id: string,
): Promise<WorkflowDefinitionParsedResponse> {
  const res = await wfFetch(
    `/api/workflow-definitions/${encodeURIComponent(id)}/parsed`,
  )
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

export type WorkflowArtifactRef = {
  type?: string
  label?: string
  url?: string
  path?: string
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
  artifact_refs?: string | Array<WorkflowArtifactRef> | null
  /** Set on child rows when they belong to a subgraph expansion (A.7-subgraphs). */
  parent_subgraph_node_run_id?: string | null
}

export interface ApproveWorkflowInput {
  node_run_id: string
  decision: 'approved' | 'rejected'
  response?: string
}

export async function approveWorkflowRun(
  runId: string,
  input: ApproveWorkflowInput,
): Promise<{
  ok: true
  decision: 'approved' | 'rejected'
  resumedRunId: string
}> {
  const res = await wfFetch(
    `/api/workflow-runs/${encodeURIComponent(runId)}/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`approveWorkflowRun failed (${res.status}): ${text}`)
  }
  return (await res.json()) as {
    ok: true
    decision: 'approved' | 'rejected'
    resumedRunId: string
  }
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

export async function listWorkflowRuns(params?: {
  workflow_id?: string
  status?: string | Array<string>
}): Promise<Array<WorkflowRunRow>> {
  const qs = new URLSearchParams()
  if (params?.workflow_id) qs.set('workflow_id', params.workflow_id)
  if (params?.status)
    qs.set(
      'status',
      Array.isArray(params.status) ? params.status.join(',') : params.status,
    )
  const query = qs.toString()
  const res = await wfFetch(`/api/workflow-runs${query ? `?${query}` : ''}`)
  if (!res.ok) {
    throw new Error(`listWorkflowRuns failed (${res.status})`)
  }
  const body = (await res.json()) as { runs: Array<WorkflowRunRow> }
  return body.runs
}

export async function getWorkflowRun(
  runId: string,
): Promise<WorkflowRunDetail> {
  const res = await wfFetch(`/api/workflow-runs/${encodeURIComponent(runId)}`)
  if (!res.ok) {
    throw new Error(`getWorkflowRun failed (${res.status})`)
  }
  return (await res.json()) as WorkflowRunDetail
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  const res = await wfFetch(
    `/api/workflow-runs/${encodeURIComponent(runId)}?action=cancel`,
    {
      method: 'POST',
    },
  )
  if (!res.ok) {
    throw new Error(`cancelWorkflowRun failed (${res.status})`)
  }
}

export async function launchWorkflowRun(
  input: LaunchWorkflowInput,
): Promise<{ run: { id: string } }> {
  const res = await wfFetch(`/api/workflow-runs`, {
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

export interface WorkflowWizardChatHistoryMessage {
  role: 'assistant' | 'user'
  msg: string
}

export interface WorkflowWizardChatInput {
  sessionId?: string
  message: string
  currentYaml: string
  currentName?: string
  currentDescription?: string
  model?: string
  history?: Array<WorkflowWizardChatHistoryMessage>
}

export interface WorkflowWizardChatResponse {
  sessionId?: string
  reply: string
  stage: 'clarify' | 'drafting_nodes' | 'refine_structure' | 'ready_for_design'
  workflow_yaml: string
  suggested_id?: string
  suggested_name?: string
  suggested_description?: string
  notes?: Array<string>
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const direct = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(direct) as Record<string, unknown>
  } catch {
    // continue
  }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as Record<
        string,
        unknown
      >
    } catch {
      return null
    }
  }
  return null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeWizardAssistantResponse(
  raw: string,
  fallbackYaml: string,
): WorkflowWizardChatResponse {
  const parsed = extractJsonObject(raw)
  if (!parsed) {
    return {
      reply:
        raw.trim() ||
        'I could not structure a workflow update from that turn. Please clarify the first node or trigger.',
      stage: 'clarify',
      workflow_yaml: fallbackYaml,
      notes: [
        'Assistant response was not valid structured JSON; kept previous workflow YAML.',
      ],
    }
  }

  const stage = readString(parsed.stage)
  return {
    reply:
      readString(parsed.reply) ||
      'I updated the workflow draft. Review the structure and keep refining it.',
    stage:
      stage === 'drafting_nodes' ||
      stage === 'refine_structure' ||
      stage === 'ready_for_design'
        ? stage
        : 'clarify',
    workflow_yaml: readString(parsed.workflow_yaml) || fallbackYaml,
    suggested_id: readString(parsed.suggested_id) || undefined,
    suggested_name: readString(parsed.suggested_name) || undefined,
    suggested_description:
      readString(parsed.suggested_description) || undefined,
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.filter((note): note is string => typeof note === 'string')
      : undefined,
  }
}

function buildWizardMessage(input: WorkflowWizardChatInput): string {
  const historyBlock =
    (input.history ?? []).length > 0
      ? (input.history ?? [])
          .map((entry) => `${entry.role.toUpperCase()}: ${entry.msg}`)
          .join('\n\n')
      : '(none yet)'

  return [
    'You are Hermes, the workflow-authoring assistant inside Hermes Switch UI.',
    'Help the user build a workflow for the Switch UI workflow feature.',
    'Return JSON only. No markdown fences.',
    'Use exactly this shape:',
    '{"reply":"string","stage":"clarify|drafting_nodes|refine_structure|ready_for_design","workflow_yaml":"string","suggested_id":"string","suggested_name":"string","suggested_description":"string","notes":["string"]}',
    '',
    'Schema rules:',
    '- Top-level YAML uses name, description, nodes.',
    '- Do NOT use `type:` as a node discriminator.',
    '- Each node must have id and exactly one of prompt, command, bash, script, approval, loop, cancel.',
    '- Optional metadata includes phase, depends_on, skills, hermes_task.',
    '- Do NOT emit `provider:` or `model:` — provider and model are resolved from Hermes gateway settings, not workflow YAML.',
    '- If the user mentions an agent by name (neo, morpheus, trinity, hermes-switch), put it in `hermes_task.agent_hint`, never in `provider:`.',
    '',
    `Current draft name: ${input.currentName || '(empty)'}`,
    `Current draft description: ${input.currentDescription || '(empty)'}`,
    '',
    'Current workflow YAML draft:',
    input.currentYaml,
    '',
    'Recent chat history:',
    historyBlock,
    '',
    'Latest user message:',
    input.message,
    '',
    'Task:',
    '- Explain just enough to help the user.',
    '- Ask one concrete next question if the request is vague.',
    '- Return a complete improved workflow_yaml when possible.',
    '- Keep the workflow simple unless the user clearly needs approvals, loops, scripts, or commands.',
  ].join('\n')
}

async function resolveWorkflowWizardModel(
  explicitModel: string | undefined,
  sessionId: string | undefined,
): Promise<string | undefined> {
  const trimmed = explicitModel?.trim()
  if (trimmed) return trimmed

  const storedModel = readPersistedSessionModel(sessionId || 'main')
  if (storedModel) return storedModel

  try {
    const res = await fetch('/api/session-status')
    if (!res.ok) return undefined
    const data = (await res.json()) as Record<string, unknown>
    const payload =
      data.payload && typeof data.payload === 'object'
        ? (data.payload as Record<string, unknown>)
        : data

    const direct =
      readString(payload.model) ||
      readString(payload.currentModel) ||
      readString(payload.modelAlias)
    if (direct) return direct

    const resolved =
      payload.resolved && typeof payload.resolved === 'object'
        ? (payload.resolved as Record<string, unknown>)
        : null
    const provider = readString(resolved?.modelProvider)
    const model = readString(resolved?.model)
    return provider && model ? `${provider}/${model}` : undefined
  } catch {
    return undefined
  }
}

function readPersistedSessionModel(
  sessionId: string | undefined,
): string | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    const raw = window.localStorage.getItem('hermes-session-model')
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as {
      state?: { models?: Record<string, unknown> }
    }
    const models = parsed.state?.models
    if (!models || typeof models !== 'object') return undefined

    const candidates = [sessionId, 'main', 'new'].filter(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    )
    for (const candidate of candidates) {
      const model = models[candidate]
      if (typeof model === 'string' && model.trim()) return model.trim()
    }
  } catch {
    return undefined
  }

  return undefined
}

export async function chatWorkflowWizard(
  input: WorkflowWizardChatInput,
): Promise<WorkflowWizardChatResponse> {
  const sessionKey = input.sessionId || 'main'
  const model = await resolveWorkflowWizardModel(input.model, sessionKey)
  const res = await fetch('/api/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionKey,
      friendlyId: sessionKey,
      message: buildWizardMessage(input),
      history: (input.history ?? []).map((entry) => ({
        role: entry.role,
        content: entry.msg,
      })),
      model,
      idempotencyKey: crypto.randomUUID(),
      locale:
        typeof window !== 'undefined'
          ? window.localStorage.getItem('hermes-switchui-locale') || 'en'
          : 'en',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `chatWorkflowWizard failed (${res.status})`)
  }
  const resolved = readResolvedSessionHeaders(res.headers, {
    sessionKey,
    friendlyId: sessionKey,
  })

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('chatWorkflowWizard failed: no response body')
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let fullText = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const dataLines: Array<string> = []
      currentEvent = ''

      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim())
        }
      }

      if (currentEvent && dataLines.length > 0) {
        const payload = JSON.parse(dataLines.join('\n')) as Record<
          string,
          unknown
        >
        if (currentEvent === 'chunk') {
          const text = readString(payload.text)
          if (payload.fullReplace === true) {
            fullText = text
          } else {
            fullText += text
          }
        } else if (currentEvent === 'error') {
          throw new Error(
            readString(payload.message) || 'Wizard chat stream failed',
          )
        }
      }

      boundary = buffer.indexOf('\n\n')
    }
  }

  const normalized = normalizeWizardAssistantResponse(
    fullText,
    input.currentYaml,
  )
  return {
    sessionId: resolved.sessionKey,
    ...normalized,
  }
}

export interface UpsertWorkflowDefinitionError {
  error: string
}

export async function upsertWorkflowDefinition(
  input: UpsertWorkflowDefinitionInput,
): Promise<{ definition: WorkflowDefinitionRow }> {
  const res = await wfFetch('/api/workflow-definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: `HTTP ${res.status}`,
    }))) as UpsertWorkflowDefinitionError
    throw Object.assign(
      new Error(
        body.error || `upsertWorkflowDefinition failed (${res.status})`,
      ),
      {
        status: res.status,
        serverError: body.error,
      },
    )
  }
  return (await res.json()) as { definition: WorkflowDefinitionRow }
}

export async function deleteWorkflowDefinition(id: string): Promise<void> {
  const res = await wfFetch(
    `/api/workflow-definitions/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: `HTTP ${res.status}`,
    }))) as UpsertWorkflowDefinitionError
    throw Object.assign(
      new Error(
        body.error || `deleteWorkflowDefinition failed (${res.status})`,
      ),
      {
        status: res.status,
      },
    )
  }
}
