/**
 * WorkflowEngineInterface — contract implemented by PluginClient, which
 * proxies workflow operations to the hermes-agent workflow-engine plugin.
 */

export const WORKFLOW_RUN_STATUS = [
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUS)[number];

export const NODE_RUN_STATUS = [
  'pending',
  'ready',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'skipped',
] as const;
export type NodeRunStatus = (typeof NODE_RUN_STATUS)[number];

export const CURRENT_PHASE = ['plan', 'route', 'execute', 'review', 'report'] as const;
export type CurrentPhase = (typeof CURRENT_PHASE)[number];
export type Phase = CurrentPhase;

export const VALID_TRANSITIONS: Record<Phase, Array<Phase>> = {
  plan: ['route', 'execute'],
  route: ['execute'],
  execute: ['review', 'report'],
  review: ['execute', 'report'],
  report: [],
};

export interface WorkflowDefinitionRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  scope_path: string | null;
  yaml: string;
  checksum: string;
  /** 1 once a user has edited this bundled row; absent on legacy rows = treat as 0. */
  user_modified?: 0 | 1;
  /** sha256 of the factory yaml this row was seeded/reset from; null for pure user rows. */
  bundled_checksum?: string | null;
  version: string | null;
  tags: string | null;
  kind?: 'workflow' | 'subgraph';
  created_at: number;
  updated_at: number;
  node_count?: number;
  run_count?: number;
  last_used_at?: number | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  conversation_id: string;
  parent_conversation_id?: string | null;
  codebase_id?: string | null;
  working_path: string;
  user_message: string;
  status: WorkflowRunStatus;
  current_phase: CurrentPhase;
  metadata?: Record<string, unknown> | null;
  started_at: Date;
  completed_at?: Date | null;
  last_heartbeat: Date;
  error?: string | null;
}

export interface NodeRun {
  id: string;
  workflow_run_id: string;
  dag_node_id: string;
  node_type: string;
  depends_on?: Array<string> | null;
  status: NodeRunStatus;
  skip_reason?: string | null;
  assigned_agent?: string | null;
  agent_profile_hint?: string | null;
  skills?: Array<string> | null;
  model_hint?: string | null;
  allowed_tools?: Array<string> | null;
  denied_tools?: Array<string> | null;
  kanban_task_id?: string | null;
  retries: number;
  max_retries: number;
  retry_delay_ms: number;
  retry_on_error: string;
  started_at?: Date | null;
  completed_at?: Date | null;
  idle_timeout_ms?: number | null;
  max_runtime_seconds?: number | null;
  summary?: string | null;
  error?: string | null;
  artifact_refs?: Array<{ type: string; label: string; url?: string; path?: string }> | null;
  loop_iteration?: number | null;
  loop_parent_node_run_id?: string | null;
  parent_subgraph_node_run_id?: string | null;
  approval_message?: string | null;
  approval_response?: string | null;
  approval_target?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TriggerInfo {
  kind: string;
  conversation_id: string;
  working_path?: string;
  user_message: string;
  parent_conversation_id?: string;
  codebase_id?: string;
  schedule?: { type: 'now' | 'at' | 'cron'; at?: string; cron?: string };
  priority?: number;
  maxRuntimeSeconds?: number;
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
  listDefinitions: (filter?: { source?: string }) => Promise<Array<WorkflowDefinitionRow>>;
  getDefinition: (id: string) => Promise<WorkflowDefinitionRow | null>;
  upsertDefinition: (
    yaml: string,
    sourcePath?: string,
    opts?: { id?: string; name?: string; expected_checksum?: string },
  ) => Promise<WorkflowDefinitionRow>;
  resetFactoryDefinition: (id: string) => Promise<WorkflowDefinitionRow>;
  parseDefinition: (id: string) => Promise<Record<string, unknown> | null>;
  deleteWorkflowDefinition: (id: string) => Promise<number>;

  // ── Runs ───────────────────────────────────────────────────────────────
  listRuns: (opts?: { workflowId?: string; limit?: number }) => Promise<Array<WorkflowRun>>;
  getRun: (runId: string) => Promise<WorkflowRun | null>;
  startRun: (
    workflowId: string,
    inputs: Record<string, unknown>,
    trigger: TriggerInfo,
  ) => Promise<WorkflowRun>;
  cancelRun: (runId: string) => Promise<void>;
  resumeWorkflowRun: (id: string) => Promise<WorkflowRun>;
  findRunByConversationId: (conversationId: string) => Promise<WorkflowRun | null>;
  getActiveWorkflowRunByPath: (path: string) => Promise<WorkflowRun | null>;

  // ── Node Runs ──────────────────────────────────────────────────────────
  listNodeRuns: (runId: string) => Promise<Array<NodeRun>>;
  findNodeRunById: (nodeRunId: string) => Promise<NodeRun | null>;

  // ── Events ─────────────────────────────────────────────────────────────
  appendWorkflowEvent: (event: RunEvent) => Promise<void>;
  listRecentWorkflowEvents: (runId: string, limit?: number) => Promise<Array<RunEvent>>;
  subscribeEvents: (runId?: string) => AsyncIterable<RunEvent>;

  // ── Phase transitions ──────────────────────────────────────────────────
  recordPhaseTransition: (input: {
    runId: string;
    toPhase: string;
    decidedBy: string;
    decisionData?: Record<string, unknown>;
  }) => Promise<{ from: string; to: string }>;
  listPhaseTransitions: (runId: string) => Promise<Array<PhaseTransition>>;

  // ── Approvals ──────────────────────────────────────────────────────────
  approve: (
    runId: string,
    nodeRunId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ) => Promise<void>;
  tryClaimApprovalForResume: (
    runId: string,
    nodeRunId: string,
    decision: 'approved' | 'rejected',
    approvalResponse: string,
  ) => Promise<ApprovalClaimResult>;
}
