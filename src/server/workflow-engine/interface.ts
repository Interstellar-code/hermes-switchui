/**
 * WorkflowEngineInterface — the 18-method contract that both NativeEngine
 * (wrapping SwitchUiWorkflowStore) and PluginClient (fetching over HTTP) satisfy.
 *
 * Phase 4: factory.ts picks the implementation per-request based on the
 * X-Workflow-Backend header.
 */
import type {
  WorkflowRun,
  WorkflowDefinitionRow,
  NodeRun,
} from './store/types.js';

export type { WorkflowRun, WorkflowDefinitionRow, NodeRun };

export interface TriggerInfo {
  kind: string;
  conversation_id: string;
  working_path?: string;
  user_message: string;
  parent_conversation_id?: string;
  codebase_id?: string;
  [key: string]: unknown;
}

export interface RunEvent {
  id?: string;
  workflow_run_id: string;
  node_run_id?: string | null;
  event_type: string;
  step_index?: number | null;
  step_name?: string | null;
  data?: Record<string, unknown> | null;
  created_at?: number;
}

export interface PhaseTransition {
  id: string;
  from_phase: string | null;
  to_phase: string;
  decided_by: string;
  decision_data: Record<string, unknown> | null;
  at: number;
}

export interface ApprovalClaimResult {
  claimed: boolean;
  terminalStatus: 'completed' | 'failed';
}

export interface WorkflowEngineInterface {
  // ── Definitions ────────────────────────────────────────────────────────
  listDefinitions(filter?: { source?: string }): Promise<WorkflowDefinitionRow[]>;
  getDefinition(id: string): Promise<WorkflowDefinitionRow | null>;
  upsertDefinition(yaml: string, sourcePath?: string): Promise<WorkflowDefinitionRow>;
  parseDefinition(id: string): Promise<Record<string, unknown> | null>;
  deleteWorkflowDefinition(id: string): Promise<number>;

  // ── Runs ───────────────────────────────────────────────────────────────
  listRuns(opts?: { workflowId?: string; limit?: number }): Promise<WorkflowRun[]>;
  getRun(runId: string): Promise<WorkflowRun | null>;
  startRun(
    workflowId: string,
    inputs: Record<string, unknown>,
    trigger: TriggerInfo,
  ): Promise<WorkflowRun>;
  cancelRun(runId: string): Promise<void>;
  resumeWorkflowRun(id: string): Promise<WorkflowRun>;
  findRunByConversationId(conversationId: string): Promise<WorkflowRun | null>;
  getActiveWorkflowRunByPath(path: string): Promise<WorkflowRun | null>;

  // ── Node Runs ──────────────────────────────────────────────────────────
  listNodeRuns(runId: string): Promise<NodeRun[]>;
  findNodeRunById(nodeRunId: string): Promise<NodeRun | null>;

  // ── Events ─────────────────────────────────────────────────────────────
  appendWorkflowEvent(event: RunEvent): Promise<void>;
  listRecentWorkflowEvents(runId: string, limit?: number): Promise<RunEvent[]>;
  subscribeEvents(runId?: string): AsyncIterable<RunEvent>;

  // ── Phase transitions ──────────────────────────────────────────────────
  recordPhaseTransition(input: {
    runId: string;
    toPhase: string;
    decidedBy: string;
    decisionData?: Record<string, unknown>;
  }): Promise<{ from: string; to: string }>;
  listPhaseTransitions(runId: string): Promise<PhaseTransition[]>;

  // ── Approvals ──────────────────────────────────────────────────────────
  approve(
    runId: string,
    nodeId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): Promise<void>;
  tryClaimApprovalForResume(
    nodeRunId: string,
    decision: 'approved' | 'rejected',
    approvalResponse: string,
  ): Promise<ApprovalClaimResult>;
}
