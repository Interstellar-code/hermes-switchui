/**
 * PluginClient — implements WorkflowEngineInterface by calling the
 * workflow-engine plugin's FastAPI endpoints on the Hermes dashboard
 * (proxied through /api/plugins/workflow-engine/*).
 *
 * Uses the same _dashboardProxyFetch pattern as hermes-api.ts so it works
 * both in the browser (via /api/dashboard-proxy) and server-side (direct
 * dashboardFetch).
 */
import { dashboardFetch } from '../../gateway-capabilities.js'
import type {
  ApprovalClaimResult,
  EngineHealth,
  NodeRun,
  PhaseTransition,
  RunEvent,
  RunEventsPage,
  RunEventsQuery,
  RunSessions,
  TriggerInfo,
  WorkflowDefinitionRow,
  WorkflowEngineInterface,
  WorkflowRun,
} from '../interface.js'

const PLUGIN_BASE = '/api/plugins/workflow-engine'

/** Maximum time to wait for any single plugin API request before aborting. */
const PLUGIN_REQUEST_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class WorkflowConflictError extends Error {
  status = 409
  code = 'conflict' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowConflictError'
  }
}

export class WorkflowValidationError extends Error {
  status = 422
  code = 'validation' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowValidationError'
  }
}

export class WorkflowNotFoundError extends Error {
  status = 404
  code = 'not_found' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowNotFoundError'
  }
}

export class WorkflowForbiddenError extends Error {
  status = 403
  code = 'forbidden' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowForbiddenError'
  }
}

/** POST /runs/{id}/retry rejected: `status` is the plugin's 400/404/409, `message` its error text. */
export class WorkflowRetryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowRetryError'
  }
}

// Shape returned by GET /node-runs/active (hermes-agent#16)
export interface ActiveNodeRunSummary {
  runId: string
  nodeId: string
  workflowId: string
  status: 'running' | 'waiting'
  startedAt: string // ISO8601
  workerId: string | null
}

// ---------------------------------------------------------------------------
// Internal fetch helpers — mirrors hermes-api.ts dashboardGet / dashboardSend
// ---------------------------------------------------------------------------

function _proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(PLUGIN_REQUEST_TIMEOUT_MS)
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal
  if (typeof window !== 'undefined') {
    const proxyPath = `/api/dashboard-proxy${path.startsWith('/') ? path : `/${path}`}`
    return fetch(proxyPath, { ...init, signal })
  }
  return dashboardFetch(path, { ...init, signal })
}

async function _get<T>(path: string): Promise<T> {
  const res = await _proxyFetch(`${PLUGIN_BASE}${path}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`PluginClient GET ${path}: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

async function _send<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await _proxyFetch(`${PLUGIN_BASE}${path}`, {
    method,
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PluginClient ${method} ${path}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function _delete(path: string): Promise<void> {
  const res = await _proxyFetch(`${PLUGIN_BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PluginClient DELETE ${path}: ${res.status} ${text}`)
  }
}

// ---------------------------------------------------------------------------
// PluginClient
// ---------------------------------------------------------------------------

export class PluginClient implements WorkflowEngineInterface {
  async health(): Promise<EngineHealth> {
    return _get('/health')
  }

  // ── Definitions ──────────────────────────────────────────────────────────

  async listDefinitions(filter?: {
    source?: string
  }): Promise<Array<WorkflowDefinitionRow>> {
    const qs = filter?.source
      ? `?source=${encodeURIComponent(filter.source)}`
      : ''
    const data = await _get<{ definitions: Array<WorkflowDefinitionRow> }>(
      `/definitions${qs}`,
    )
    return data.definitions
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionRow | null> {
    try {
      const data = await _get<{ definition: WorkflowDefinitionRow }>(
        `/definitions/${encodeURIComponent(id)}`,
      )
      return data.definition
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null
      throw e
    }
  }

  async upsertDefinition(
    yaml: string,
    sourcePath?: string,
    opts?: { id?: string; name?: string; expected_checksum?: string },
  ): Promise<WorkflowDefinitionRow> {
    const res = await _proxyFetch(`${PLUGIN_BASE}/definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yaml,
        source_path: sourcePath,
        ...(opts?.id != null ? { id: opts.id } : {}),
        ...(opts?.name != null ? { name: opts.name } : {}),
        ...(opts?.expected_checksum != null
          ? { expected_checksum: opts.expected_checksum }
          : {}),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 409)
        throw new WorkflowConflictError(text || 'Conflict: checksum mismatch')
      if (res.status === 422)
        throw new WorkflowValidationError(text || 'Validation failed')
      throw new Error(`PluginClient POST /definitions: ${res.status} ${text}`)
    }
    const data = (await res.json()) as { definition: WorkflowDefinitionRow }
    return data.definition
  }

  async resetFactoryDefinition(id: string): Promise<WorkflowDefinitionRow> {
    const res = await _proxyFetch(
      `${PLUGIN_BASE}/definitions/${encodeURIComponent(id)}/reset-factory`,
      { method: 'POST' },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 404)
        throw new WorkflowNotFoundError(text || 'Not found')
      if (res.status === 403)
        throw new WorkflowForbiddenError(text || 'Forbidden')
      throw new Error(
        `PluginClient POST /definitions/${id}/reset-factory: ${res.status} ${text}`,
      )
    }
    const data = (await res.json()) as { definition: WorkflowDefinitionRow }
    return data.definition
  }

  async parseDefinition(id: string): Promise<Record<string, unknown> | null> {
    try {
      const data = await _get<{ parsed: Record<string, unknown> }>(
        `/definitions/${encodeURIComponent(id)}/parsed`,
      )
      return data.parsed
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null
      throw e
    }
  }

  async deleteWorkflowDefinition(id: string): Promise<number> {
    try {
      await _delete(`/definitions/${encodeURIComponent(id)}`)
      return 1
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return 0
      throw e
    }
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  async listRuns(opts?: {
    workflowId?: string
    limit?: number
    /** Comma-separated run statuses. */
    status?: string
  }): Promise<Array<WorkflowRun>> {
    const params = new URLSearchParams()
    if (opts?.workflowId) params.set('workflow_id', opts.workflowId)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.status) params.set('status', opts.status)
    const qs = params.toString() ? `?${params}` : ''
    const data = await _get<{ runs: Array<WorkflowRun> }>(`/runs${qs}`)
    return data.runs
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    try {
      const data = await _get<{ run: WorkflowRun }>(
        `/runs/${encodeURIComponent(runId)}`,
      )
      return data.run
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null
      throw e
    }
  }

  async startRun(
    workflowId: string,
    inputs: Record<string, unknown>,
    trigger: TriggerInfo,
  ): Promise<WorkflowRun> {
    const data = await _send<{ run: WorkflowRun }>('POST', '/runs', {
      workflow_id: workflowId,
      conversation_id: trigger.conversation_id,
      user_message: trigger.user_message,
      working_path: trigger.working_path,
      variables: inputs,
      parent_conversation_id: trigger.parent_conversation_id,
      codebase_id: trigger.codebase_id,
      ...(trigger.parent_run_id != null && {
        parent_run_id: trigger.parent_run_id,
      }),
      ...(trigger.schedule != null && { schedule: trigger.schedule }),
      ...(trigger.priority != null && { priority: trigger.priority }),
      ...(trigger.maxRuntimeSeconds != null && {
        maxRuntimeSeconds: trigger.maxRuntimeSeconds,
      }),
    })
    return data.run
  }

  async cancelRun(runId: string): Promise<void> {
    await _send('POST', `/runs/${encodeURIComponent(runId)}/cancel`)
  }

  async resumeWorkflowRun(id: string): Promise<WorkflowRun> {
    const data = await _send<{ run: WorkflowRun }>(
      'POST',
      `/runs/${encodeURIComponent(id)}/resume`,
    )
    return data.run
  }

  async retryRun(
    id: string,
    opts: { from_node_id?: string; actor?: string } = {},
  ): Promise<WorkflowRun> {
    const res = await _proxyFetch(
      `${PLUGIN_BASE}/runs/${encodeURIComponent(id)}/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: unknown
      } | null
      const msg = typeof body?.error === 'string' ? body.error : ''
      if ([400, 404, 409].includes(res.status))
        throw new WorkflowRetryError(res.status, msg)
      throw new Error(
        `PluginClient POST /runs/${id}/retry: ${res.status} ${msg}`,
      )
    }
    const data = (await res.json()) as { run: WorkflowRun }
    return data.run
  }

  async findRunByConversationId(
    conversationId: string,
  ): Promise<WorkflowRun | null> {
    try {
      const data = await _get<{ run: WorkflowRun | null }>(
        `/runs/by-conversation/${encodeURIComponent(conversationId)}`,
      )
      return data.run
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null
      throw e
    }
  }

  async getActiveWorkflowRunByPath(path: string): Promise<WorkflowRun | null> {
    try {
      const data = await _get<{ run: WorkflowRun | null }>(
        `/runs/active?scope_path=${encodeURIComponent(path)}`,
      )
      return data.run
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null
      throw e
    }
  }

  // ── Node Runs ────────────────────────────────────────────────────────────

  async listNodeRuns(runId: string): Promise<Array<NodeRun>> {
    const data = await _get<{ nodeRuns: Array<NodeRun> }>(
      `/runs/${encodeURIComponent(runId)}/nodes`,
    )
    return data.nodeRuns
  }

  async listActiveNodeRuns(): Promise<Array<ActiveNodeRunSummary>> {
    const data = await _get<{ nodeRuns: Array<ActiveNodeRunSummary> }>(
      '/node-runs/active',
    )
    return data.nodeRuns
  }

  async getRunSessions(runId: string): Promise<RunSessions | null> {
    try {
      return await _get<RunSessions>(
        `/runs/${encodeURIComponent(runId)}/sessions`,
      )
    } catch (e) {
      if (e instanceof Error && e.message.includes(': 404')) return null
      throw e
    }
  }

  async findNodeRunById(nodeRunId: string): Promise<NodeRun | null> {
    try {
      const data = await _get<{ nodeRun: NodeRun }>(
        `/node-runs/${encodeURIComponent(nodeRunId)}`,
      )
      return data.nodeRun
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null
      throw e
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  async appendWorkflowEvent(event: RunEvent): Promise<void> {
    const { workflow_run_id, ...rest } = event
    await _send(
      'POST',
      `/runs/${encodeURIComponent(workflow_run_id)}/events`,
      rest,
    )
  }

  async listRecentWorkflowEvents(
    runId: string,
    limit = 200,
  ): Promise<Array<RunEvent>> {
    const data = await _get<{ events: Array<RunEvent> }>(
      `/runs/${encodeURIComponent(runId)}/events?limit=${limit}`,
    )
    return data.events
  }

  async listRunEvents(
    runId: string,
    q: RunEventsQuery = {},
  ): Promise<RunEventsPage> {
    const params = new URLSearchParams()
    if (q.limit != null) params.set('limit', String(q.limit))
    if (q.node_run_id) params.set('node_run_id', q.node_run_id)
    if (q.type) params.set('type', q.type)
    if (q.after) params.set('after', q.after)
    const qs = params.toString() ? `?${params}` : ''
    const data = await _get<{
      events: Array<RunEvent>
      cursor?: string | number | null
    }>(`/runs/${encodeURIComponent(runId)}/events${qs}`)
    return { events: data.events, cursor: data.cursor ?? null }
  }

  subscribeEvents(
    runId?: string,
    signal?: AbortSignal,
  ): AsyncIterable<RunEvent> {
    // Pass relative path only — pluginSseStream prepends PLUGIN_BASE internally.
    return pluginSseStream(
      `/events${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`,
      signal,
    )
  }

  // ── Phase Transitions ────────────────────────────────────────────────────

  async recordPhaseTransition(input: {
    runId: string
    toPhase: string
    decidedBy: string
    decisionData?: Record<string, unknown>
  }): Promise<{ from: string; to: string }> {
    return _send<{ from: string; to: string }>(
      'POST',
      `/runs/${encodeURIComponent(input.runId)}/phase-transitions`,
      {
        toPhase: input.toPhase,
        decidedBy: input.decidedBy,
        decisionData: input.decisionData,
      },
    )
  }

  async listPhaseTransitions(runId: string): Promise<Array<PhaseTransition>> {
    const data = await _get<{ phaseTransitions: Array<PhaseTransition> }>(
      `/runs/${encodeURIComponent(runId)}/phase-transitions`,
    )
    return data.phaseTransitions
  }

  // ── Approvals ────────────────────────────────────────────────────────────

  async approve(
    runId: string,
    nodeRunId: string,
    decision: 'approve' | 'reject',
    comment?: string,
    approvedBy?: string,
  ): Promise<void> {
    await _send('POST', `/runs/${encodeURIComponent(runId)}/approve`, {
      node_run_id: nodeRunId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      response: comment,
      ...(approvedBy ? { approved_by: approvedBy } : {}),
    })
  }

  async tryClaimApprovalForResume(
    runId: string,
    nodeRunId: string,
    decision: 'approved' | 'rejected',
    approvalResponse: string,
  ): Promise<ApprovalClaimResult> {
    return _send<ApprovalClaimResult>(
      'POST',
      `/runs/${encodeURIComponent(runId)}/approval-claim`,
      {
        nodeRunId,
        decision,
        approvalResponse,
      },
    )
  }
}

// ---------------------------------------------------------------------------
// SSE stream helper (imported by subscribeEvents above)
// ---------------------------------------------------------------------------

async function* pluginSseStream(
  url: string,
  signal?: AbortSignal,
): AsyncGenerator<RunEvent> {
  // Server-side: use undici fetch with streaming body
  // Browser-side: this path is not expected (use EventSource directly)
  if (typeof window !== 'undefined') {
    throw new Error(
      'pluginSseStream must not be called in browser context — use EventSource directly',
    )
  }
  const { dashboardFetch: df } = await import('../../gateway-capabilities.js')
  // The timeout covers connecting only; a live stream must outlive it.
  const connect = new AbortController()
  const timer = setTimeout(() => connect.abort(), PLUGIN_REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await df(PLUGIN_BASE + url, {
      signal: signal
        ? AbortSignal.any([signal, connect.signal])
        : connect.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`Plugin SSE stream failed: ${res.status}`)
  if (!res.body) throw new Error(`Plugin SSE stream had no body`)
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6)) as RunEvent
            if (!evt.event_type) continue // keep-alive / non-event frame
            yield evt
          } catch {
            // skip malformed
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
