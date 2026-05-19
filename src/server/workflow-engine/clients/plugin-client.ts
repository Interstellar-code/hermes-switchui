/**
 * PluginClient — implements WorkflowEngineInterface by calling the
 * workflow-engine plugin's FastAPI endpoints on the Hermes dashboard
 * (proxied through /api/plugins/workflow-engine/*).
 *
 * Uses the same _dashboardProxyFetch pattern as hermes-api.ts so it works
 * both in the browser (via /api/dashboard-proxy) and server-side (direct
 * dashboardFetch).
 */
import type {
  WorkflowEngineInterface,
  WorkflowRun,
  WorkflowDefinitionRow,
  NodeRun,
  TriggerInfo,
  RunEvent,
  PhaseTransition,
  ApprovalClaimResult,
} from '../interface.js';
import { dashboardFetch } from '../../gateway-capabilities.js';

const PLUGIN_BASE = '/api/plugins/workflow-engine';

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

  async listDefinitions(filter?: { source?: string }): Promise<WorkflowDefinitionRow[]> {
    const qs = filter?.source ? `?source=${encodeURIComponent(filter.source)}` : '';
    const data = await _get<{ definitions: WorkflowDefinitionRow[] }>(`/definitions${qs}`);
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
      // id/name derived by plugin validator from YAML content
      id: '_placeholder',
      name: '_placeholder',
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

  async listRuns(opts?: { workflowId?: string; limit?: number }): Promise<WorkflowRun[]> {
    const params = new URLSearchParams();
    if (opts?.workflowId) params.set('workflow_id', opts.workflowId);
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params}` : '';
    const data = await _get<{ runs: WorkflowRun[] }>(`/runs${qs}`);
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
    });
    return data.run;
  }

  async cancelRun(runId: string): Promise<void> {
    await _send('POST', `/runs/${encodeURIComponent(runId)}?action=cancel`);
  }

  async resumeWorkflowRun(id: string): Promise<WorkflowRun> {
    const data = await _send<{ run: WorkflowRun }>('POST', `/runs/${encodeURIComponent(id)}/resume`);
    return data.run;
  }

  async findRunByConversationId(conversationId: string): Promise<WorkflowRun | null> {
    const data = await _get<{ run: WorkflowRun | null }>(`/runs/by-conversation/${encodeURIComponent(conversationId)}`);
    return data.run;
  }

  async getActiveWorkflowRunByPath(path: string): Promise<WorkflowRun | null> {
    const data = await _get<{ run: WorkflowRun | null }>(`/runs/active?scope_path=${encodeURIComponent(path)}`);
    return data.run;
  }

  // ── Node Runs ────────────────────────────────────────────────────────────

  async listNodeRuns(runId: string): Promise<NodeRun[]> {
    const data = await _get<{ nodeRuns: NodeRun[] }>(`/runs/${encodeURIComponent(runId)}/nodes`);
    return data.nodeRuns;
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

  async listRecentWorkflowEvents(runId: string, limit = 200): Promise<RunEvent[]> {
    const data = await _get<{ events: RunEvent[] }>(`/runs/${encodeURIComponent(runId)}/events?limit=${limit}`);
    return data.events;
  }

  subscribeEvents(runId?: string): AsyncIterable<RunEvent> {
    // Delegate to plugin-client.sse.ts helper
    return pluginSseStream(`${PLUGIN_BASE}/events${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`);
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

  async listPhaseTransitions(runId: string): Promise<PhaseTransition[]> {
    const data = await _get<{ phaseTransitions: PhaseTransition[] }>(`/runs/${encodeURIComponent(runId)}/phase-transitions`);
    return data.phaseTransitions;
  }

  // ── Approvals ────────────────────────────────────────────────────────────

  async approve(
    runId: string,
    nodeId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<void> {
    // The plugin /approve endpoint expects node_run_id not dag_node_id.
    // For compatibility, find the node_run first via nodeId as dag_node_id lookup.
    await _send('POST', `/runs/${encodeURIComponent(runId)}/approve`, {
      node_run_id: nodeId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      response: comment,
    });
  }

  async tryClaimApprovalForResume(
    nodeRunId: string,
    decision: 'approved' | 'rejected',
    approvalResponse: string,
  ): Promise<ApprovalClaimResult> {
    return _send<ApprovalClaimResult>(
      'POST',
      `/runs/${encodeURIComponent('')}/approval-claim`,
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
    // Browser — yield nothing; UI layer uses EventSource directly
    return;
  }
  const { dashboardFetch: df } = await import('../../gateway-capabilities.js');
  const res = await df(PLUGIN_BASE + url.replace(PLUGIN_BASE, ''));
  if (!res.ok || !res.body) return;
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
