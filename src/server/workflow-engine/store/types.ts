// ============================================================
// Status enum unions — as const, matching upstream archon values.
// Codex review note: use 'completed', NEVER 'done'.
// ============================================================

export const WORKFLOW_RUN_STATUS = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUS)[number];

export const NODE_RUN_STATUS = [
  "pending",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type NodeRunStatus = (typeof NODE_RUN_STATUS)[number];

export const CURRENT_PHASE = [
  "plan",
  "route",
  "execute",
  "review",
  "report",
] as const;
export type CurrentPhase = (typeof CURRENT_PHASE)[number];

// ============================================================
// Row shapes (what better-sqlite3 returns)
// ============================================================

export interface WorkflowDefinitionRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  scope_path: string | null;
  yaml: string;
  checksum: string;
  version: string | null;
  tags: string | null; // JSON array<string>
  created_at: number;
  updated_at: number;
  // Derived/joined — populated by listWorkflowDefinitions; optional elsewhere.
  node_count?: number;
  run_count?: number;
  last_used_at?: number | null;
}

export interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  conversation_id: string;
  parent_conversation_id: string | null;
  codebase_id: string | null;
  working_path: string;
  user_message: string;
  status: WorkflowRunStatus;
  current_phase: CurrentPhase;
  metadata: string | null; // JSON
  started_at: number;
  completed_at: number | null;
  last_heartbeat: number;
  error: string | null;
}

export interface NodeRunRow {
  id: string;
  workflow_run_id: string;
  dag_node_id: string;
  node_type: string;
  depends_on: string | null; // JSON array
  status: NodeRunStatus;
  skip_reason: string | null;
  assigned_agent: string | null;
  agent_profile_hint: string | null;
  skills: string | null; // JSON array
  model_hint: string | null;
  allowed_tools: string | null; // JSON array
  denied_tools: string | null; // JSON array
  kanban_task_id: string | null;
  retries: number;
  max_retries: number;
  retry_delay_ms: number;
  retry_on_error: string;
  started_at: number | null;
  completed_at: number | null;
  idle_timeout_ms: number | null;
  max_runtime_seconds: number | null;
  summary: string | null;
  error: string | null;
  artifact_refs: string | null; // JSON array
  loop_iteration: number | null;
  loop_parent_node_run_id: string | null;
  approval_message: string | null;
  approval_response: string | null;
  approval_target: string | null;
  metadata: string | null; // JSON
}

export interface WorkflowEventRow {
  id: string;
  workflow_run_id: string;
  node_run_id: string | null;
  event_type: string;
  step_index: number | null;
  step_name: string | null;
  data: string | null; // JSON
  created_at: number;
}

export interface GatewayCursorRow {
  consumer_id: string;
  last_event_id: string | null;
  last_seen_at: number;
  updated_at: number;
}

// ============================================================
// Typed error for duplicate node run
// ============================================================

export class DuplicateNodeRunError extends Error {
  constructor(
    public readonly workflowRunId: string,
    public readonly dagNodeId: string,
    public readonly loopIteration: number | null
  ) {
    super(
      `NodeRun already exists: workflow_run_id=${workflowRunId} dag_node_id=${dagNodeId} loop_iteration=${loopIteration ?? "NULL"}`
    );
    this.name = "DuplicateNodeRunError";
  }
}

// ============================================================
// WorkflowRun domain type (what IWorkflowStore returns)
// ============================================================

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
  depends_on?: string[] | null;
  status: NodeRunStatus;
  skip_reason?: string | null;
  assigned_agent?: string | null;
  agent_profile_hint?: string | null;
  skills?: string[] | null;
  model_hint?: string | null;
  allowed_tools?: string[] | null;
  denied_tools?: string[] | null;
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
  approval_message?: string | null;
  approval_response?: string | null;
  approval_target?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ApprovalContext {
  message: string;
  target?: "conductor" | "kanban_comment";
  capture_response?: boolean;
}

// Filter types
export interface ListWorkflowDefinitionsFilter {
  source?: string;
  scope_path?: string;
}
