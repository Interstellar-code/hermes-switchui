/**
 * PluginClient — implements WorkflowEngineInterface by calling the
 * workflow-engine plugin's FastAPI endpoints on the Hermes dashboard
 * (proxied through /api/plugins/workflow-engine/*).
 *
 * Uses the same _dashboardProxyFetch pattern as hermes-api.ts so it works
 * both in the browser (via /api/dashboard-proxy) and server-side (direct
 * dashboardFetch).
 */
import { dashboardFetch } from '../../gateway-capabilities.js';
import type {
  ApprovalClaimResult,
  NodeRun,
  PhaseTransition,
  RunEvent,
  TriggerInfo,
  WorkflowDefinitionRow,
  WorkflowEngineInterface,
  WorkflowRun,
} from '../interface.js';

const PLUGIN_BASE = '/api/plugins/workflow-engine';

// Shape returned by GET /node-runs/active (hermes-agent#16)
export interface ActiveNodeRunSummary {
  runId: string;
  nodeId: string;
  workflowId: string;
  status: 'running' | 'waiting';
  startedAt: string; // ISO8601
  workerId: string | null;
}

// ---------------------------------------------------------------------------
// Internal fetch helpers — mirrors hermes-api.ts dashboardGet / dashboardSend
// ---------------------------------------------------------------------------

function _proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  if (typeof window !== 'undefined') {
    const proxyPath = `/api/dashboard-proxy${path.startsWith('/') ? path : `/${path}`}`;
    return fetch(proxyPath, init);
  }
  return dashboardFetch(path, init);
}

async function _get<T>(path: string): Promise<T> {
  const res = await _proxyFetch(`${PLUGIN_BASE}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PluginClient GET ${path}: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
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
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PluginClient ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

async function _delete(path: string): Promise<void> {
  const res = await _proxyFetch(`${PLUGIN_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PluginClient DELETE ${path}: ${res.status} ${text}`);
  }
}

// ---------------------------------------------------------------------------
// PluginClient
// ---------------------------------------------------------------------------

export class PluginClient implements WorkflowEngineInterface {
  // ── Definitions ──────────────────────────────────────────────────────────

  async listDefinitions(filter?: { source?: string }): Promise<Array<WorkflowDefinitionRow>> {
    const qs = filter?.source ? `?source=${encodeURIComponent(filter.source)}` : '';
    const data = await _get<{ definitions: Array<WorkflowDefinitionRow> }>(`/definitions${qs}`);
    return data.definitions;
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionRow | null> {
    try {
      const data = await _get<{ definition: WorkflowDefinitionRow }>(`/definitions/${encodeURIComponent(id)}`);
      return data.definition;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  async upsertDefinition(yaml: string, sourcePath?: string): Promise<WorkflowDefinitionRow> {
    const data = await _send<{ definition: WorkflowDefinitionRow }>('POST', '/definitions', {
      yaml,
      source_path: sourcePath,
      // id and name are derived by the plugin from YAML content — do not send placeholders.
    });
    return data.definition;
  }

  async parseDefinition(id: string): Promise<Record<string, unknown> | null> {
    try {
      const data = await _get<{ parsed: Record<string, unknown> }>(`/definitions/${encodeURIComponent(id)}/parsed`);
      return data.parsed;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  async deleteWorkflowDefinition(id: string): Promise<number> {
    try {
      await _delete(`/definitions/${encodeURIComponent(id)}`);
      return 1;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return 0;
      throw e;
    }
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  async listRuns(opts?: { workflowId?: string; limit?: number }): Promise<Array<WorkflowRun>> {
    const params = new URLSearchParams();
    if (opts?.workflowId) params.set('workflow_id', opts.workflowId);
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params}` : '';
    const data = await _get<{ runs: Array<WorkflowRun> }>(`/runs${qs}`);
    return data.runs;
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    try {
      const data = await _get<{ run: WorkflowRun }>(`/runs/${encodeURIComponent(runId)}`);
      return data.run;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
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
      ...(trigger.schedule != null && { schedule: trigger.schedule }),
      ...(trigger.priority != null && { priority: trigger.priority }),
      ...(trigger.maxRuntimeSeconds != null && { maxRuntimeSeconds: trigger.maxRuntimeSeconds }),
    });
    return data.run;
  }

  async cancelRun(runId: string): Promise<void> {
    await _send('POST', `/runs/${encodeURIComponent(runId)}/cancel`);
  }

  async resumeWorkflowRun(id: string): Promise<WorkflowRun> {
    const data = await _send<{ run: WorkflowRun }>('POST', `/runs/${encodeURIComponent(id)}/resume`);
    return data.run;
  }

  async findRunByConversationId(conversationId: string): Promise<WorkflowRun | null> {
    try {
      const data = await _get<{ run: WorkflowRun | null }>(`/runs/by-conversation/${encodeURIComponent(conversationId)}`);
      return data.run;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  async getActiveWorkflowRunByPath(path: string): Promise<WorkflowRun | null> {
    try {
      const data = await _get<{ run: WorkflowRun | null }>(`/runs/active?scope_path=${encodeURIComponent(path)}`);
      return data.run;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  // ── Node Runs ────────────────────────────────────────────────────────────

  async listNodeRuns(runId: string): Promise<Array<NodeRun>> {
    const data = await _get<{ nodeRuns: Array<NodeRun> }>(`/runs/${encodeURIComponent(runId)}/nodes`);
    return data.nodeRuns;
  }

  async listActiveNodeRuns(): Promise<Array<ActiveNodeRunSummary>> {
    return _get<Array<ActiveNodeRunSummary>>('/node-runs/active');
  }

  async findNodeRunById(nodeRunId: string): Promise<NodeRun | null> {
    try {
      const data = await _get<{ nodeRun: NodeRun }>(`/node-runs/${encodeURIComponent(nodeRunId)}`);
      return data.nodeRun;
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('404')) return null;
      throw e;
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  async appendWorkflowEvent(event: RunEvent): Promise<void> {
    const { workflow_run_id, ...rest } = event;
    await _send('POST', `/runs/${encodeURIComponent(workflow_run_id)}/events`, rest);
  }

  async listRecentWorkflowEvents(runId: string, limit = 200): Promise<Array<RunEvent>> {
    const data = await _get<{ events: Array<RunEvent> }>(`/runs/${encodeURIComponent(runId)}/events?limit=${limit}`);
    return data.events;
  }

  subscribeEvents(runId?: string): AsyncIterable<RunEvent> {
    // Pass relative path only — pluginSseStream prepends PLUGIN_BASE internally.
    return pluginSseStream(`/events${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`);
  }

  // ── Phase Transitions ────────────────────────────────────────────────────

  async recordPhaseTransition(input: {
    runId: string;
    toPhase: string;
    decidedBy: string;
    decisionData?: Record<string, unknown>;
  }): Promise<{ from: string; to: string }> {
    return _send<{ from: string; to: string }>(
      'POST',
      `/runs/${encodeURIComponent(input.runId)}/phase-transitions`,
      {
        toPhase: input.toPhase,
        decidedBy: input.decidedBy,
        decisionData: input.decisionData,
      },
    );
  }

  async listPhaseTransitions(runId: string): Promise<Array<PhaseTransition>> {
    const data = await _get<{ phaseTransitions: Array<PhaseTransition> }>(`/runs/${encodeURIComponent(runId)}/phase-transitions`);
    return data.phaseTransitions;
  }

  // ── Approvals ────────────────────────────────────────────────────────────

  async approve(
    runId: string,
    nodeRunId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<void> {
    await _send('POST', `/runs/${encodeURIComponent(runId)}/approve`, {
      node_run_id: nodeRunId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      response: comment,
    });
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
    );
  }
}

// ---------------------------------------------------------------------------
// SSE stream helper (imported by subscribeEvents above)
// ---------------------------------------------------------------------------

async function* pluginSseStream(url: string): AsyncGenerator<RunEvent> {
  // Server-side: use undici fetch with streaming body
  // Browser-side: this path is not expected (SSE handled by plugin-client.sse.ts in UI layer)
  if (typeof window !== 'undefined') {
    throw new Error('pluginSseStream must not be called in browser context — use EventSource directly');
  }
  const { dashboardFetch: df } = await import('../../gateway-capabilities.js');
  const res = await df(PLUGIN_BASE + url);
  if (!res.ok) throw new Error(`Plugin SSE stream had no body`);
  if (!res.body) throw new Error(`Plugin SSE stream had no body`);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6)) as RunEvent;
        } catch {
          // skip malformed
        }
      }
    }
  }
}
