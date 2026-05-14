import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  WorkflowRun,
  WorkflowRunRow,
  NodeRun,
  NodeRunRow,
  WorkflowDefinitionRow,
  DuplicateNodeRunError,
  ListWorkflowDefinitionsFilter,
  ApprovalContext,
} from "./types.js";

// ============================================================
// Helpers
// ============================================================

function nowMs(): number {
  return Date.now();
}

function rowToWorkflowRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    conversation_id: row.conversation_id,
    parent_conversation_id: row.parent_conversation_id,
    codebase_id: row.codebase_id,
    working_path: row.working_path,
    user_message: row.user_message,
    status: row.status,
    current_phase: row.current_phase,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    started_at: new Date(row.started_at),
    completed_at: row.completed_at != null ? new Date(row.completed_at) : null,
    last_heartbeat: new Date(row.last_heartbeat),
    error: row.error,
  };
}

function rowToNodeRun(row: NodeRunRow): NodeRun {
  return {
    id: row.id,
    workflow_run_id: row.workflow_run_id,
    dag_node_id: row.dag_node_id,
    node_type: row.node_type,
    depends_on: row.depends_on ? (JSON.parse(row.depends_on) as string[]) : null,
    status: row.status,
    skip_reason: row.skip_reason,
    assigned_agent: row.assigned_agent,
    agent_profile_hint: row.agent_profile_hint,
    skills: row.skills ? (JSON.parse(row.skills) as string[]) : null,
    model_hint: row.model_hint,
    allowed_tools: row.allowed_tools ? (JSON.parse(row.allowed_tools) as string[]) : null,
    denied_tools: row.denied_tools ? (JSON.parse(row.denied_tools) as string[]) : null,
    kanban_task_id: row.kanban_task_id,
    retries: row.retries,
    max_retries: row.max_retries,
    retry_delay_ms: row.retry_delay_ms,
    retry_on_error: row.retry_on_error,
    started_at: row.started_at != null ? new Date(row.started_at) : null,
    completed_at: row.completed_at != null ? new Date(row.completed_at) : null,
    idle_timeout_ms: row.idle_timeout_ms,
    max_runtime_seconds: row.max_runtime_seconds,
    summary: row.summary,
    error: row.error,
    artifact_refs: row.artifact_refs
      ? (JSON.parse(row.artifact_refs) as Array<{ type: string; label: string; url?: string; path?: string }>)
      : null,
    loop_iteration: row.loop_iteration,
    loop_parent_node_run_id: row.loop_parent_node_run_id,
    approval_message: row.approval_message,
    approval_response: row.approval_response,
    approval_target: row.approval_target,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
  };
}

// ============================================================
// IWorkflowStore — 17 methods + 6 helpers
// ============================================================

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

function isTerminal(status: string): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export class SwitchUiWorkflowStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ----------------------------------------------------------
  // Helper: withTransaction
  // ----------------------------------------------------------

  // line: withTransaction
  withTransaction<T>(fn: (db: Database.Database) => T): T {
    return this.db.transaction(fn)(this.db);
  }

  // ----------------------------------------------------------
  // 1. createWorkflowRun
  // ----------------------------------------------------------

  async createWorkflowRun(data: {
    workflow_name: string;
    conversation_id: string;
    codebase_id?: string;
    user_message: string;
    metadata?: Record<string, unknown>;
    working_path?: string;
    parent_conversation_id?: string;
  }): Promise<WorkflowRun> {
    const id = randomUUID();
    const now = nowMs();
    const workingPath = data.working_path ?? "";

    // workflow_id references workflow_definitions.id. Use workflow_name as id here.
    // Callers must ensure definition is registered via upsertWorkflowDefinition before dispatch.
    this.db
      .prepare(
        `INSERT INTO workflow_runs
           (id, workflow_id, conversation_id, parent_conversation_id, codebase_id,
            working_path, user_message, status, current_phase, metadata,
            started_at, last_heartbeat)
         VALUES (?,?,?,?,?,?,?,'pending','plan',?,?,?)`
      )
      .run(
        id,
        data.workflow_name,
        data.conversation_id,
        data.parent_conversation_id ?? null,
        data.codebase_id ?? null,
        workingPath,
        data.user_message,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
        now
      );

    return rowToWorkflowRun(
      this.db.prepare("SELECT * FROM workflow_runs WHERE id=?").get(id) as WorkflowRunRow
    );
  }

  // ----------------------------------------------------------
  // 2. getWorkflowRun
  // ----------------------------------------------------------

  async getWorkflowRun(id: string): Promise<WorkflowRun | null> {
    const row = this.db
      .prepare("SELECT * FROM workflow_runs WHERE id=?")
      .get(id) as WorkflowRunRow | undefined;
    return row ? rowToWorkflowRun(row) : null;
  }

  // ----------------------------------------------------------
  // 3. getActiveWorkflowRunByPath
  // ----------------------------------------------------------

  async getActiveWorkflowRunByPath(
    workingPath: string,
    self?: { id: string; startedAt: Date }
  ): Promise<WorkflowRun | null> {
    const STALE_MS = 5 * 60 * 1000;
    const staleThreshold = nowMs() - STALE_MS;

    let row: WorkflowRunRow | undefined;
    if (self) {
      row = this.db
        .prepare(
          `SELECT * FROM workflow_runs
           WHERE working_path=?
             AND status IN ('pending','running','paused')
             AND id != ?
             AND (status != 'pending' OR last_heartbeat >= ?)
           ORDER BY started_at ASC, id ASC
           LIMIT 1`
        )
        .get(workingPath, self.id, staleThreshold) as WorkflowRunRow | undefined;
    } else {
      row = this.db
        .prepare(
          `SELECT * FROM workflow_runs
           WHERE working_path=?
             AND status IN ('pending','running','paused')
             AND (status != 'pending' OR last_heartbeat >= ?)
           ORDER BY started_at ASC, id ASC
           LIMIT 1`
        )
        .get(workingPath, staleThreshold) as WorkflowRunRow | undefined;
    }
    return row ? rowToWorkflowRun(row) : null;
  }

  // ----------------------------------------------------------
  // 4. findResumableRun
  // ----------------------------------------------------------

  async findResumableRun(
    workflowName: string,
    workingPath: string
  ): Promise<WorkflowRun | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM workflow_runs
         WHERE workflow_id=? AND working_path=? AND status='paused'
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(workflowName, workingPath) as WorkflowRunRow | undefined;
    return row ? rowToWorkflowRun(row) : null;
  }

  // ----------------------------------------------------------
  // 5. failOrphanedRuns
  // ----------------------------------------------------------

  async failOrphanedRuns(thresholdMs = 300_000): Promise<{ count: number }> {
    const now = nowMs();
    const cutoff = now - thresholdMs;
    const result = this.db
      .prepare(
        `UPDATE workflow_runs
         SET status='failed',
             error='orphaned: no heartbeat',
             completed_at=?
         WHERE status IN ('pending','running')
           AND last_heartbeat < ?`
      )
      .run(now, cutoff);
    return { count: result.changes };
  }

  // ----------------------------------------------------------
  // 6. resumeWorkflowRun
  // ----------------------------------------------------------

  async resumeWorkflowRun(id: string): Promise<WorkflowRun> {
    this.db
      .prepare("UPDATE workflow_runs SET status='running' WHERE id=? AND status='paused'")
      .run(id);
    const run = await this.getWorkflowRun(id);
    if (!run) throw new Error(`WorkflowRun not found: ${id}`);
    return run;
  }

  // ----------------------------------------------------------
  // 7. updateWorkflowRun
  // ----------------------------------------------------------

  private static readonly WR_WHITELIST = new Set([
    "status",
    "current_phase",
    "metadata",
    "error",
    "completed_at",
    "last_heartbeat",
  ]);

  async updateWorkflowRun(
    id: string,
    updates: Partial<Pick<WorkflowRun, "status" | "metadata">>
  ): Promise<void> {
    const entries = Object.entries(updates);
    if (entries.length === 0) return;

    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [key, val] of entries) {
      if (!SwitchUiWorkflowStore.WR_WHITELIST.has(key)) {
        throw new Error(`updateWorkflowRun: unknown column '${key}'`);
      }
      cols.push(`${key}=?`);
      vals.push(key === "metadata" && val != null ? JSON.stringify(val) : val);
    }
    vals.push(id);
    this.db.prepare(`UPDATE workflow_runs SET ${cols.join(",")} WHERE id=?`).run(...vals);
  }

  // ----------------------------------------------------------
  // 8. updateWorkflowActivity (heartbeat alias)
  // ----------------------------------------------------------

  async updateWorkflowActivity(id: string): Promise<void> {
    await this.heartbeatWorkflowRun(id);
  }

  // ----------------------------------------------------------
  // 9. getWorkflowRunStatus
  // ----------------------------------------------------------

  async getWorkflowRunStatus(id: string): Promise<WorkflowRun["status"] | null> {
    const row = this.db
      .prepare("SELECT status FROM workflow_runs WHERE id=?")
      .get(id) as { status: WorkflowRun["status"] } | undefined;
    return row ? row.status : null;
  }

  // ----------------------------------------------------------
  // 10. completeWorkflowRun — transaction required
  // ----------------------------------------------------------

  async completeWorkflowRun(id: string, metadata?: Record<string, unknown>): Promise<void> {
    const now = nowMs();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE workflow_runs
           SET status='completed', completed_at=?, metadata=COALESCE(?,metadata)
           WHERE id=?`
        )
        .run(now, metadata ? JSON.stringify(metadata) : null, id);
      this._insertEvent(id, null, "workflow_completed", undefined, undefined, undefined);
    })();
  }

  // ----------------------------------------------------------
  // 11. failWorkflowRun — transaction required
  // ----------------------------------------------------------

  async failWorkflowRun(id: string, error: string): Promise<void> {
    const now = nowMs();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE workflow_runs SET status='failed', error=?, completed_at=? WHERE id=?`
        )
        .run(error, now, id);
      this._insertEvent(id, null, "workflow_failed", undefined, undefined, { error });
    })();
  }

  // ----------------------------------------------------------
  // 12. pauseWorkflowRun
  // ----------------------------------------------------------

  async pauseWorkflowRun(id: string, approvalContext: ApprovalContext): Promise<void> {
    this.db
      .prepare("UPDATE workflow_runs SET status='paused' WHERE id=?")
      .run(id);
    // Store approval context in metadata for reference by engine
    const existing = this.db
      .prepare("SELECT metadata FROM workflow_runs WHERE id=?")
      .get(id) as { metadata: string | null } | undefined;
    const meta: Record<string, unknown> = existing?.metadata
      ? (JSON.parse(existing.metadata) as Record<string, unknown>)
      : {};
    meta._approvalContext = approvalContext;
    this.db
      .prepare("UPDATE workflow_runs SET metadata=? WHERE id=?")
      .run(JSON.stringify(meta), id);
  }

  // ----------------------------------------------------------
  // 13. cancelWorkflowRun — transaction required, idempotent
  // ----------------------------------------------------------

  async cancelWorkflowRun(id: string): Promise<void> {
    const current = await this.getWorkflowRunStatus(id);
    if (!current || isTerminal(current)) return; // idempotent no-op
    const now = nowMs();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE workflow_runs SET status='cancelled', completed_at=? WHERE id=?`
        )
        .run(now, id);
      this._insertEvent(id, null, "workflow_cancelled", undefined, undefined, undefined);
    })();
  }

  // ----------------------------------------------------------
  // 14. createWorkflowEvent
  // ----------------------------------------------------------

  async createWorkflowEvent(data: {
    workflow_run_id: string;
    event_type: string;
    step_index?: number;
    step_name?: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    try {
      this._insertEvent(
        data.workflow_run_id,
        null,
        data.event_type,
        data.step_index,
        data.step_name,
        data.data
      );
    } catch (err) {
      // Must NOT throw — observable only per IWorkflowStore contract.
      console.error("[workflow-store] createWorkflowEvent failed:", err);
    }
  }

  // ----------------------------------------------------------
  // 15. getCompletedDagNodeOutputs
  // ----------------------------------------------------------

  async getCompletedDagNodeOutputs(workflowRunId: string): Promise<Map<string, string>> {
    const rows = this.db
      .prepare(
        `SELECT dag_node_id, summary FROM node_runs
         WHERE workflow_run_id=? AND status='completed' AND loop_iteration IS NULL`
      )
      .all(workflowRunId) as Array<{ dag_node_id: string; summary: string | null }>;

    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.summary != null) {
        map.set(row.dag_node_id, row.summary);
      }
    }
    return map;
  }

  // ----------------------------------------------------------
  // 16. getCodebaseEnvVars
  // ----------------------------------------------------------

  async getCodebaseEnvVars(_codebaseId: string): Promise<Record<string, string>> {
    // v1: returns empty. v1.1 will proxy to Hermes gateway settings env block.
    return {};
  }

  // ----------------------------------------------------------
  // 17. getCodebase
  // ----------------------------------------------------------

  async getCodebase(
    _id: string
  ): Promise<{ id: string; name: string; repository_url: string | null; default_cwd: string } | null> {
    // v1: not stored locally. Returns null; callers (executor) own degradation.
    return null;
  }

  // ----------------------------------------------------------
  // Helper: heartbeatWorkflowRun (used by updateWorkflowActivity)
  // ----------------------------------------------------------

  async heartbeatWorkflowRun(id: string): Promise<number> {
    const now = nowMs();
    const result = this.db
      .prepare(
        `UPDATE workflow_runs SET last_heartbeat=? WHERE id=? AND status IN ('pending','running')`
      )
      .run(now, id);
    return result.changes;
  }

  // ----------------------------------------------------------
  // Helper: createNodeRun
  // ----------------------------------------------------------

  async createNodeRun(input: {
    workflow_run_id: string;
    dag_node_id: string;
    node_type: string;
    depends_on?: string[];
    loop_iteration?: number;
    loop_parent_node_run_id?: string;
    max_retries?: number;
    retry_delay_ms?: number;
    retry_on_error?: string;
    idle_timeout_ms?: number;
    max_runtime_seconds?: number;
    assigned_agent?: string;
    agent_profile_hint?: string;
    skills?: string[];
    model_hint?: string;
    allowed_tools?: string[];
    denied_tools?: string[];
    approval_message?: string;
    approval_target?: string;
    metadata?: Record<string, unknown>;
  }): Promise<NodeRun> {
    const id = randomUUID();
    // SQLite UNIQUE constraints treat NULL != NULL, so two rows with
    // loop_iteration=NULL on the same (workflow_run_id, dag_node_id) don't
    // conflict at the DB level. We do an explicit pre-check for this case.
    const loopIter = input.loop_iteration ?? null;
    if (loopIter === null) {
      const existing = this.db
        .prepare(
          `SELECT id FROM node_runs
           WHERE workflow_run_id=? AND dag_node_id=? AND loop_iteration IS NULL`
        )
        .get(input.workflow_run_id, input.dag_node_id);
      if (existing) {
        throw new DuplicateNodeRunError(input.workflow_run_id, input.dag_node_id, null);
      }
    }

    try {
      this.db
        .prepare(
          `INSERT INTO node_runs
             (id, workflow_run_id, dag_node_id, node_type, depends_on, status,
              loop_iteration, loop_parent_node_run_id,
              max_retries, retry_delay_ms, retry_on_error,
              idle_timeout_ms, max_runtime_seconds,
              assigned_agent, agent_profile_hint, skills, model_hint,
              allowed_tools, denied_tools,
              approval_message, approval_target, metadata)
           VALUES (?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          input.workflow_run_id,
          input.dag_node_id,
          input.node_type,
          input.depends_on ? JSON.stringify(input.depends_on) : null,
          loopIter,
          input.loop_parent_node_run_id ?? null,
          input.max_retries ?? 2,
          input.retry_delay_ms ?? 3000,
          input.retry_on_error ?? "transient",
          input.idle_timeout_ms ?? null,
          input.max_runtime_seconds ?? null,
          input.assigned_agent ?? null,
          input.agent_profile_hint ?? null,
          input.skills ? JSON.stringify(input.skills) : null,
          input.model_hint ?? null,
          input.allowed_tools ? JSON.stringify(input.allowed_tools) : null,
          input.denied_tools ? JSON.stringify(input.denied_tools) : null,
          input.approval_message ?? null,
          input.approval_target ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null
        );
    } catch (err) {
      if (
        (err as NodeJS.ErrnoException).message?.includes("UNIQUE constraint failed")
      ) {
        throw new DuplicateNodeRunError(
          input.workflow_run_id,
          input.dag_node_id,
          loopIter
        );
      }
      throw err;
    }

    return rowToNodeRun(
      this.db.prepare("SELECT * FROM node_runs WHERE id=?").get(id) as NodeRunRow
    );
  }

  // ----------------------------------------------------------
  // Helper: updateNodeRun
  // ----------------------------------------------------------

  private static readonly NR_WHITELIST = new Set([
    "status",
    "kanban_task_id",
    "started_at",
    "completed_at",
    "summary",
    "error",
    "retries",
    "assigned_agent",
    "approval_response",
    "artifact_refs",
    "metadata",
    "skip_reason",
  ]);

  async updateNodeRun(
    id: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const entries = Object.entries(patch);
    if (entries.length === 0) return;

    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [key, val] of entries) {
      if (!SwitchUiWorkflowStore.NR_WHITELIST.has(key)) {
        throw new Error(`updateNodeRun: unknown column '${key}'`);
      }
      cols.push(`${key}=?`);
      const jsonCols = new Set(["artifact_refs", "metadata"]);
      vals.push(jsonCols.has(key) && val != null ? JSON.stringify(val) : val);
    }
    vals.push(id);
    this.db.prepare(`UPDATE node_runs SET ${cols.join(",")} WHERE id=?`).run(...vals);
  }

  // ----------------------------------------------------------
  // Helper: appendWorkflowEvent (alias for createWorkflowEvent with node_run_id)
  // ----------------------------------------------------------

  async appendWorkflowEvent(event: {
    id?: string;
    workflow_run_id: string;
    node_run_id?: string;
    event_type: string;
    step_index?: number;
    step_name?: string;
    data?: Record<string, unknown>;
    created_at?: number;
  }): Promise<void> {
    const eventId = event.id ?? randomUUID();
    const now = event.created_at ?? nowMs();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO workflow_events
           (id, workflow_run_id, node_run_id, event_type, step_index, step_name, data, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        eventId,
        event.workflow_run_id,
        event.node_run_id ?? null,
        event.event_type,
        event.step_index ?? null,
        event.step_name ?? null,
        event.data ? JSON.stringify(event.data) : null,
        now
      );
  }

  // ----------------------------------------------------------
  // 6 Additional Helpers
  // ----------------------------------------------------------

  /**
   * Helper 0 (A.11 cold-start reconciliation): list node_runs that were
   * dispatched to Kanban but haven't reached a terminal status yet. Used by
   * the engine boot path to repopulate the task-event consumer's in-memory
   * tracking map after a Switch UI server restart.
   */
  listInFlightDispatches(): Array<{
    nodeRunId: string;
    workflowRunId: string;
    kanbanTaskId: string;
  }> {
    return this.db
      .prepare(
        `SELECT id AS nodeRunId, workflow_run_id AS workflowRunId, kanban_task_id AS kanbanTaskId
           FROM node_runs
          WHERE kanban_task_id IS NOT NULL
            AND status IN ('running', 'ready')`
      )
      .all() as Array<{ nodeRunId: string; workflowRunId: string; kanbanTaskId: string }>;
  }

  // Helper 1: getLoopChildOutputs
  getLoopChildOutputs(
    parentNodeRunId: string
  ): Array<{ dag_node_id: string; summary: string | null; loop_iteration: number }> {
    return this.db
      .prepare(
        `SELECT dag_node_id, summary, loop_iteration FROM node_runs
         WHERE loop_parent_node_run_id=?
         ORDER BY loop_iteration ASC`
      )
      .all(parentNodeRunId) as Array<{
        dag_node_id: string;
        summary: string | null;
        loop_iteration: number;
      }>;
  }

  // Helper 2: getCursor
  getCursor(consumerId: string): string | null {
    const row = this.db
      .prepare("SELECT last_event_id FROM gateway_event_cursor WHERE consumer_id=?")
      .get(consumerId) as { last_event_id: string | null } | undefined;
    return row?.last_event_id ?? null;
  }

  // Helper 3: setCursor
  setCursor(consumerId: string, eventId: string): void {
    const now = nowMs();
    this.db
      .prepare(
        `INSERT INTO gateway_event_cursor (consumer_id, last_event_id, last_seen_at, updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(consumer_id) DO UPDATE SET
           last_event_id=excluded.last_event_id,
           last_seen_at=excluded.last_seen_at,
           updated_at=excluded.updated_at`
      )
      .run(consumerId, eventId, now, now);
  }

  // Helper 4: getWorkflowDefinition
  getWorkflowDefinition(id: string): WorkflowDefinitionRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM workflow_definitions WHERE id=?")
        .get(id) as WorkflowDefinitionRow | undefined) ?? null
    );
  }

  // Helper 5: upsertWorkflowDefinition
  upsertWorkflowDefinition(def: {
    id: string;
    name: string;
    description?: string;
    source: string;
    scope_path?: string;
    yaml: string;
    checksum: string;
    version?: string;
    tags?: string[];
  }): void {
    const now = nowMs();
    // Short-circuit: skip write if checksum unchanged.
    const existing = this.getWorkflowDefinition(def.id);
    if (existing && existing.checksum === def.checksum) return;

    this.db
      .prepare(
        `INSERT INTO workflow_definitions
           (id, name, description, source, scope_path, yaml, checksum, version, tags, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=excluded.description,
           source=excluded.source,
           scope_path=excluded.scope_path,
           yaml=excluded.yaml,
           checksum=excluded.checksum,
           version=excluded.version,
           tags=excluded.tags,
           updated_at=excluded.updated_at`
      )
      .run(
        def.id,
        def.name,
        def.description ?? null,
        def.source,
        def.scope_path ?? null,
        def.yaml,
        def.checksum,
        def.version ?? null,
        def.tags ? JSON.stringify(def.tags) : null,
        existing ? existing.created_at : now,
        now
      );
  }

  // Helper 6: listWorkflowDefinitions
  listWorkflowDefinitions(filter?: ListWorkflowDefinitionsFilter): WorkflowDefinitionRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.source) {
      conditions.push("source=?");
      params.push(filter.source);
    }
    if (filter?.scope_path) {
      conditions.push("scope_path=?");
      params.push(filter.scope_path);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM workflow_definitions ${where} ORDER BY created_at ASC`)
      .all(...params) as WorkflowDefinitionRow[];
  }

  // ----------------------------------------------------------
  // Private: _insertEvent
  // ----------------------------------------------------------

  private _insertEvent(
    workflowRunId: string,
    nodeRunId: string | null,
    eventType: string,
    stepIndex?: number,
    stepName?: string,
    data?: Record<string, unknown>
  ): void {
    const id = randomUUID();
    const now = nowMs();
    this.db
      .prepare(
        `INSERT INTO workflow_events
           (id, workflow_run_id, node_run_id, event_type, step_index, step_name, data, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        workflowRunId,
        nodeRunId,
        eventType,
        stepIndex ?? null,
        stepName ?? null,
        data ? JSON.stringify(data) : null,
        now
      );
  }
}
