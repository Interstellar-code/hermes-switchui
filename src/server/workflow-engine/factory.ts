/**
 * factory.ts — pick WorkflowEngineInterface implementation based on the
 * X-Workflow-Backend request header (or default 'native').
 *
 * NativeEngine: thin adapter over the existing SwitchUiWorkflowStore +
 *   getWorkflowEngine() — zero behaviour change for the existing routes.
 * PluginClient: delegates all calls to the Python plugin via HTTP.
 */
import type { WorkflowEngineInterface, WorkflowRun, WorkflowDefinitionRow, NodeRun, TriggerInfo, RunEvent, PhaseTransition, ApprovalClaimResult } from './interface.js';
import { getWorkflowEngine } from './index.js';
import { PluginClient } from './clients/plugin-client.js';

// ---------------------------------------------------------------------------
// NativeEngine — wraps existing SwitchUiWorkflowStore
// ---------------------------------------------------------------------------

class NativeEngine implements WorkflowEngineInterface {
  // ── Definitions ──────────────────────────────────────────────────────────

  async listDefinitions(filter?: { source?: string }): Promise<WorkflowDefinitionRow[]> {
    const { store } = await getWorkflowEngine();
    return store.listWorkflowDefinitions(filter?.source ? { source: filter.source } : undefined);
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionRow | null> {
    const { store } = await getWorkflowEngine();
    return store.getWorkflowDefinition(id);
  }

  async upsertDefinition(_yaml: string, _sourcePath?: string): Promise<WorkflowDefinitionRow> {
    // NativeEngine: upsert goes through the existing POST /api/workflow-definitions route
    // which handles YAML parsing. This method is only needed by PluginClient path.
    throw new Error('NativeEngine.upsertDefinition: use POST /api/workflow-definitions route directly');
  }

  async parseDefinition(id: string): Promise<Record<string, unknown> | null> {
    const { store } = await getWorkflowEngine();
    const def = store.getWorkflowDefinition(id);
    if (!def) return null;
    // Delegate to the existing parsed route's logic is complex — return raw def
    return def as unknown as Record<string, unknown>;
  }

  async deleteWorkflowDefinition(id: string): Promise<number> {
    const { store } = await getWorkflowEngine();
    return store.deleteWorkflowDefinition(id);
  }

  // ── Runs ─────────────────────────────────────────────────────────────────

  async listRuns(opts?: { workflowId?: string; limit?: number }): Promise<WorkflowRun[]> {
    const { store } = await getWorkflowEngine();
    return store.listWorkflowRuns({
      workflowId: opts?.workflowId,
      limit: opts?.limit,
    }) as WorkflowRun[];
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    const { store } = await getWorkflowEngine();
    return store.getWorkflowRun(runId);
  }

  async startRun(
    workflowId: string,
    inputs: Record<string, unknown>,
    trigger: TriggerInfo,
  ): Promise<WorkflowRun> {
    const { store } = await getWorkflowEngine();
    return store.createWorkflowRun({
      workflow_name: workflowId,
      conversation_id: trigger.conversation_id,
      user_message: trigger.user_message,
      working_path: trigger.working_path,
      parent_conversation_id: trigger.parent_conversation_id,
      codebase_id: trigger.codebase_id,
      metadata: { inputs },
    });
  }

  async cancelRun(runId: string): Promise<void> {
    const { store } = await getWorkflowEngine();
    await store.cancelWorkflowRun(runId);
  }

  async resumeWorkflowRun(id: string): Promise<WorkflowRun> {
    const { store } = await getWorkflowEngine();
    return store.resumeWorkflowRun(id);
  }

  async findRunByConversationId(conversationId: string): Promise<WorkflowRun | null> {
    const { store } = await getWorkflowEngine();
    return store.findRunByConversationId(conversationId);
  }

  async getActiveWorkflowRunByPath(path: string): Promise<WorkflowRun | null> {
    const { store } = await getWorkflowEngine();
    return store.getActiveWorkflowRunByPath(path);
  }

  // ── Node Runs ────────────────────────────────────────────────────────────

  async listNodeRuns(runId: string): Promise<NodeRun[]> {
    const { store } = await getWorkflowEngine();
    return store.listNodeRuns(runId) as NodeRun[];
  }

  async findNodeRunById(nodeRunId: string): Promise<NodeRun | null> {
    const { store } = await getWorkflowEngine();
    return store.findNodeRunById(nodeRunId);
  }

  // ── Events ───────────────────────────────────────────────────────────────

  async appendWorkflowEvent(event: RunEvent): Promise<void> {
    const { store } = await getWorkflowEngine();
    // store.appendWorkflowEvent expects the same shape — cast needed since
    // RunEvent uses optional created_at while store type uses number|undefined
    await store.appendWorkflowEvent(event as Parameters<typeof store.appendWorkflowEvent>[0]);
  }

  async listRecentWorkflowEvents(runId: string, limit = 200): Promise<RunEvent[]> {
    const { store } = await getWorkflowEngine();
    return store.listRecentWorkflowEvents(runId, limit) as RunEvent[];
  }

  subscribeEvents(runId?: string): AsyncIterable<RunEvent> {
    // emitter.subscribe is callback-based; wrap it in an async generator
    let resolve: ((value: IteratorResult<RunEvent>) => void) | null = null;
    const queue: RunEvent[] = [];
    let done = false;

    const unsub = (async () => {
      const { emitter } = await getWorkflowEngine();
      return emitter.subscribe((evt) => {
        if (runId && (evt as { run_id?: string }).run_id !== runId) return;
        const item = evt as unknown as RunEvent;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: item, done: false });
        } else {
          queue.push(item);
        }
      });
    })();

    return {
      [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
        return {
          next(): Promise<IteratorResult<RunEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) return Promise.resolve({ value: undefined as unknown as RunEvent, done: true });
            return new Promise((res) => { resolve = res; });
          },
          async return(): Promise<IteratorResult<RunEvent>> {
            done = true;
            const unsubFn = await unsub;
            unsubFn();
            return { value: undefined as unknown as RunEvent, done: true };
          },
        };
      },
    };
  }

  // ── Phase Transitions ────────────────────────────────────────────────────

  async recordPhaseTransition(input: {
    runId: string;
    toPhase: string;
    decidedBy: string;
    decisionData?: Record<string, unknown>;
  }): Promise<{ from: string; to: string }> {
    const { store } = await getWorkflowEngine();
    return store.recordPhaseTransition(input as Parameters<typeof store.recordPhaseTransition>[0]);
  }

  async listPhaseTransitions(runId: string): Promise<PhaseTransition[]> {
    const { store } = await getWorkflowEngine();
    return store.listPhaseTransitions(runId) as PhaseTransition[];
  }

  // ── Approvals ────────────────────────────────────────────────────────────

  async approve(
    _runId: string,
    nodeId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<void> {
    const { store } = await getWorkflowEngine();
    const nodeRun = store.findNodeRunById(nodeId);
    if (!nodeRun) throw new Error(`node_run not found: ${nodeId}`);
    const tsDecision = decision === 'approve' ? 'approved' : 'rejected';
    store.tryClaimApprovalForResume(nodeId, tsDecision, comment ?? '');
  }

  async tryClaimApprovalForResume(
    nodeRunId: string,
    decision: 'approved' | 'rejected',
    approvalResponse: string,
  ): Promise<ApprovalClaimResult> {
    const { store } = await getWorkflowEngine();
    return store.tryClaimApprovalForResume(nodeRunId, decision, approvalResponse);
  }
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let _nativeEngine: NativeEngine | null = null;
let _pluginClient: PluginClient | null = null;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate WorkflowEngineInterface based on the
 * X-Workflow-Backend header value ('native' | 'plugin').
 * Defaults to 'native' if the header is absent or unknown.
 */
export function getEngine(request: Request): WorkflowEngineInterface {
  const backend = request.headers.get('X-Workflow-Backend') ?? 'native';
  if (backend === 'plugin') {
    if (!_pluginClient) _pluginClient = new PluginClient();
    return _pluginClient;
  }
  if (!_nativeEngine) _nativeEngine = new NativeEngine();
  return _nativeEngine;
}

export type { WorkflowEngineInterface };
