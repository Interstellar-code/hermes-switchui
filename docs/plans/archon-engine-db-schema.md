# Switch UI Workflow Engine — Database Schema (Skeleton)

> **Status:** Draft v1. Owned by Workstream A.1.1 (Engine Workflow Store).
> **Location:** `~/.hermes/switchui-workflows.db` (SQLite, single file).
> **Owner process:** Switch UI TanStack Start server (`src/server/workflow-engine/`). Single-writer.
> **Scope:** Delta tables only. Anything Hermes Kanban already owns (`tasks`, `task_events`, `task_links`, `task_runs`, `task_comments`) is **read via gateway HTTP API**. `node_runs.kanban_task_id` is the join column.

## Design principles

1. **Single writer** — Switch UI server is the only process touching this DB. WAL mode for concurrent readers (Conductor UI subscribers, Operations page).
2. **TEXT primary keys (UUIDs)** — matches Hermes Kanban convention; cross-DB references are free-text pointers (no SQL FK across DBs).
3. **Unix-ms timestamps** — `INTEGER` columns store epoch milliseconds. Display layer formats.
4. **JSON in TEXT** — metadata blobs stored as JSON-encoded TEXT, parsed at boundary. SQLite json1 extension available for ad-hoc filters.
5. **Schema versioning** — `schema_meta` row drives migrations.
6. **Cascade deletes on logical parents** — purging a `workflow_runs` row cascades `phase_transitions`, `node_runs`, `workflow_events`. Definitions never auto-delete.

---

## DDL

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. Workflow Definitions (registry of YAMLs)
-- ============================================================

CREATE TABLE workflow_definitions (
  id            TEXT PRIMARY KEY,        -- e.g. 'archon-fix-github-issue' or 'switchui-feature-spec'
  name          TEXT NOT NULL,           -- display name
  description   TEXT,
  source        TEXT NOT NULL,           -- 'bundled' | 'user' | 'project'
  scope_path    TEXT,                    -- working_path for 'project'-scoped defs; NULL for bundled/user
  yaml          TEXT NOT NULL,           -- raw YAML source-of-truth
  checksum      TEXT NOT NULL,           -- sha256(yaml) for change detection / cache busting
  version       TEXT,                    -- semver-ish, from YAML or auto-bumped
  tags          TEXT,                    -- JSON array<string>
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_wd_source ON workflow_definitions(source);
CREATE INDEX idx_wd_scope  ON workflow_definitions(scope_path);


-- ============================================================
-- 2. Workflow Runs (one row per dispatch)
-- ============================================================

CREATE TABLE workflow_runs (
  id                      TEXT PRIMARY KEY,        -- UUID
  workflow_id             TEXT NOT NULL REFERENCES workflow_definitions(id),
  conversation_id         TEXT NOT NULL,           -- ties to Switch UI chat session
  parent_conversation_id  TEXT,                    -- nested runs
  codebase_id             TEXT,                    -- v1: nullable; v1.1: maps to Hermes workspace
  working_path            TEXT NOT NULL,
  user_message            TEXT NOT NULL,           -- the original trigger message (plan-phase input)
  status                  TEXT NOT NULL DEFAULT 'pending',
                          -- pending | running | paused | completed | failed | cancelled
  current_phase           TEXT NOT NULL DEFAULT 'plan',
                          -- plan | route | execute | review | report
  metadata                TEXT,                    -- JSON: arbitrary engine metadata
  started_at              INTEGER NOT NULL,
  completed_at            INTEGER,
  last_heartbeat          INTEGER NOT NULL,        -- for orphan reaper
  error                   TEXT                     -- terminal error message
);

CREATE INDEX idx_wr_status        ON workflow_runs(status);
CREATE INDEX idx_wr_phase         ON workflow_runs(current_phase, status);
CREATE INDEX idx_wr_workflow      ON workflow_runs(workflow_id);
CREATE INDEX idx_wr_path          ON workflow_runs(working_path);
CREATE INDEX idx_wr_conversation  ON workflow_runs(conversation_id);
CREATE INDEX idx_wr_heartbeat     ON workflow_runs(status, last_heartbeat);  -- orphan scan


-- ============================================================
-- 3. Phase Transitions (audit trail per run)
-- ============================================================

CREATE TABLE phase_transitions (
  id                TEXT PRIMARY KEY,
  workflow_run_id   TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  from_phase        TEXT,                          -- NULL for initial enter-plan
  to_phase          TEXT NOT NULL,
  decided_by        TEXT NOT NULL,                 -- 'user' | 'engine' | 'router' | 'system'
  decision_data     TEXT,                          -- JSON: route payload, approval result, review verdict
  at                INTEGER NOT NULL
);

CREATE INDEX idx_pt_run ON phase_transitions(workflow_run_id, at);


-- ============================================================
-- 4. Node Runs (per-node execution record)
-- ============================================================

CREATE TABLE node_runs (
  id                       TEXT PRIMARY KEY,
  workflow_run_id          TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  dag_node_id              TEXT NOT NULL,          -- node `id:` from YAML
  node_type                TEXT NOT NULL,          -- command | prompt | bash | script | loop | approval | cancel
  depends_on               TEXT,                   -- JSON array<dag_node_id>
  status                   TEXT NOT NULL DEFAULT 'pending',
                           -- pending | ready | running | paused | completed | failed | cancelled | skipped
  skip_reason              TEXT,                   -- when_condition | when_condition_parse_error | trigger_rule | prior_success

  -- Routing / agent assignment (set during route phase)
  assigned_agent           TEXT,                   -- agent profile id: 'switch' | 'neo' | 'trinity' | 'morpheus' | <custom>
  agent_profile_hint       TEXT,                   -- from YAML hermes_task.agent_hint
  skills                   TEXT,                   -- JSON array<string>, from hermes_task.skills
  model_hint               TEXT,                   -- from hermes_task.model_hint
  allowed_tools            TEXT,                   -- JSON array<string>
  denied_tools             TEXT,                   -- JSON array<string>

  -- Kanban join (set when execute phase materializes a Hermes task)
  kanban_task_id           TEXT,                   -- pointer to gateway-owned tasks.id; NULL for local-exec nodes

  -- Retry / lifecycle
  retries                  INTEGER NOT NULL DEFAULT 0,
  max_retries              INTEGER NOT NULL DEFAULT 2,
  retry_delay_ms           INTEGER NOT NULL DEFAULT 3000,
  retry_on_error           TEXT NOT NULL DEFAULT 'transient',  -- 'transient' | 'all'

  started_at               INTEGER,
  completed_at             INTEGER,
  idle_timeout_ms          INTEGER,                -- per-node override
  max_runtime_seconds      INTEGER,

  -- Output
  summary                  TEXT,                   -- final output text or JSON
  error                    TEXT,
  artifact_refs            TEXT,                   -- JSON array<{type,label,url?,path?}>

  -- Loop iteration support
  loop_iteration           INTEGER,                -- NULL for non-loop nodes; iteration index for loop children
  loop_parent_node_run_id  TEXT REFERENCES node_runs(id) ON DELETE CASCADE,
                           -- pointer to the loop-wrapper node_run

  -- Approval support
  approval_message         TEXT,                   -- the prompt shown to user
  approval_response        TEXT,                   -- captured response (when approval.capture_response=true)
  approval_target          TEXT,                   -- 'conductor' (default) | 'kanban_comment'

  metadata                 TEXT,                   -- JSON: anything else

  UNIQUE(workflow_run_id, dag_node_id, loop_iteration)
);

CREATE INDEX idx_nr_run        ON node_runs(workflow_run_id);
CREATE INDEX idx_nr_run_status ON node_runs(workflow_run_id, status);
CREATE INDEX idx_nr_kanban     ON node_runs(kanban_task_id);
CREATE INDEX idx_nr_agent      ON node_runs(assigned_agent, status);
CREATE INDEX idx_nr_loop       ON node_runs(loop_parent_node_run_id);


-- ============================================================
-- 5. Workflow Events (append-only event log)
-- ============================================================

CREATE TABLE workflow_events (
  id                TEXT PRIMARY KEY,
  workflow_run_id   TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_run_id       TEXT REFERENCES node_runs(id) ON DELETE CASCADE,  -- NULL for run-level events
  event_type        TEXT NOT NULL,
                    -- One of WORKFLOW_EVENT_TYPES (19 strings, see store.ts):
                    -- workflow_started | workflow_completed | workflow_failed | workflow_cancelled | workflow_artifact
                    -- node_started | node_completed | node_failed | node_skipped | node_skipped_prior_success
                    -- loop_iteration_started | loop_iteration_completed | loop_iteration_failed
                    -- tool_called | tool_completed
                    -- ralph_story_started | ralph_story_completed
                    -- approval_requested | approval_received
  step_index        INTEGER,
  step_name         TEXT,
  data              TEXT,                          -- JSON payload (varies by event_type)
  created_at        INTEGER NOT NULL
);

CREATE INDEX idx_we_run  ON workflow_events(workflow_run_id, created_at);
CREATE INDEX idx_we_node ON workflow_events(node_run_id);
CREATE INDEX idx_we_type ON workflow_events(event_type, created_at);


-- ============================================================
-- 6. Gateway Event Cursor (resumable consumer)
-- ============================================================

CREATE TABLE gateway_event_cursor (
  consumer_id    TEXT PRIMARY KEY,                 -- e.g. 'workflow-engine.task-events'
  last_event_id  TEXT,                             -- last seen gateway event id
  last_seen_at   INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);


-- ============================================================
-- 7. Schema Metadata
-- ============================================================

CREATE TABLE schema_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1');
INSERT INTO schema_meta (key, value) VALUES ('created_at', strftime('%s', 'now') || '000');
```

---

## Notes on key design choices

### Why `assigned_agent` lives on `node_runs`, not in a separate table

Agent profiles (Switch / Neo / Trinity / Morpheus / custom) are not exclusively owned by one node — they can be invoked in parallel/concurrent multiple times. The assignment is just a routing decision, not a lock. Storing inline on `node_runs.assigned_agent` keeps queries simple ("show me all Neo's current work" = `WHERE assigned_agent='neo' AND status IN ('running','paused','ready')`).

### Why no `agents` / `agent_profiles` table

Hermes Agent already owns agent profile definitions. Switch UI workflow engine treats `assigned_agent` as a free-text profile id and trusts Hermes to know what `neo` means. If the agent doesn't exist on the Hermes side at dispatch time, the gateway `POST /api/tasks` will fail loudly. No DB-level FK across the cross-process boundary.

### Why `node_runs.kanban_task_id` is nullable

Three node-type categories:
- **Execute-phase AI nodes** (`command:`, `prompt:`) → Hermes Kanban task created → `kanban_task_id` set
- **Local-exec nodes** (`bash:`, `script:`) → executed in engine process directly → `kanban_task_id` stays NULL
- **Control-flow nodes** (`loop:`, `approval:`, `cancel:`) → no Kanban task; `kanban_task_id` stays NULL

### Loop iterations and the UNIQUE constraint

`UNIQUE(workflow_run_id, dag_node_id, loop_iteration)` lets a single DAG node (e.g. inside a `loop:` block) have one `node_runs` row per iteration. The wrapper loop node itself has `loop_iteration = NULL`; its children have `loop_iteration = 0, 1, 2, ...` and `loop_parent_node_run_id` pointing back to the wrapper.

### Resume reads against `node_runs`

`getCompletedDagNodeOutputs(runId)` from `IWorkflowStore` becomes:
```sql
SELECT dag_node_id, summary
  FROM node_runs
 WHERE workflow_run_id = ?
   AND status = 'completed'
   AND loop_iteration IS NULL    -- for non-loop nodes; loop output handling is custom
```
Loop output reconstruction is per-iteration; the engine collapses into the `nodeOutputs` map at executor entry.

### Heartbeats and orphan reaper

`workflow_runs.last_heartbeat` updated every 60s while engine is running. On Switch UI server boot, `failOrphanedRuns()` does:
```sql
UPDATE workflow_runs
   SET status = 'failed',
       error  = 'orphaned: no heartbeat',
       completed_at = ?now
 WHERE status IN ('pending', 'running')
   AND last_heartbeat < (?now - 300000);  -- 5 min threshold
```

### Gateway event cursor

Single row per consumer (likely just `'workflow-engine.task-events'` for v1). Stores last successfully-processed gateway event id so the consumer can resume after Switch UI restart without losing or double-processing events. Cursor advance happens AFTER `workflow_events` insert + `node_runs` update commit.

### Why no separate `agent_assignments` table

Could split out `(node_run_id, agent_profile, assigned_at, reassignment_reason)` for richer audit. v1 keeps it inline on `node_runs` for simplicity. If/when re-routing during run becomes a feature, promote to a separate table.

---

## v1 → v1.1 evolution hooks

- **`codebase_id` mapping** — v1 nullable, v1.1 will point to a Hermes workspace identifier once that concept stabilizes upstream
- **Per-codebase env vars** — v1 returns `{}` from `getCodebaseEnvVars`; v1.1 proxies to Hermes settings env block via gateway
- **Workflow templates as JSON-Schema-validated objects** — v1 stores raw YAML; v1.1 may add a parsed-AST column for faster filter/lookup
- **Cross-run dependencies** (workflow A blocked on workflow B's completion) — not modeled in v1; would add `workflow_run_dependencies(child_run_id, parent_run_id)` table

---

## Migration notes

- Initial DDL ships as `migrations/001_init.sql`
- Migration runner reads `schema_meta.schema_version`, applies pending migrations in numeric order
- Idempotent — re-running `001_init.sql` against fresh DB is a no-op (CREATE IF NOT EXISTS, but we use plain CREATE to fail loud on accidental overwrite)
- Reset script: `pnpm engine:db:reset` drops the file and re-runs migrations (dev only)

---

## Open questions for review

1. **`node_runs.depends_on` as JSON vs separate `node_run_deps` table** — JSON is simpler, separate table allows indexed reverse lookups. Plan to start with JSON; promote later if traversal queries become hot.
2. **`workflow_events` retention** — append-only grows forever. Add retention policy (e.g. archive after 30 days for completed runs)? v1 = no policy, manual cleanup via maintenance script.
3. **`metadata` JSON columns** — should we extract well-known keys (e.g. `loopIteration`, `approvalContext`) into typed columns at write time? Trade: typed columns = faster queries, but tighter coupling to engine internals. v1 = keep JSON, add typed columns only if a query pattern emerges.
4. **Multi-tenant** — currently the DB is per-host (one Switch UI install). If we ever need per-user isolation, add `tenant_id TEXT` to every table. Not in v1 scope.
5. **Backups** — SQLite WAL means `cp` is safe with `wal_checkpoint(TRUNCATE)`. Document a backup script under `scripts/`.

---

## Cross-reference

- `IWorkflowStore` 17 methods → mapped in `docs/plans/archon-hermes-integration.md` A.1.1
- Event taxonomy (19 types) → from `packages/workflows/src/store.ts` `WORKFLOW_EVENT_TYPES`
- Gateway HTTP contract for Kanban → consumed via Hermes Agent's existing `/api/tasks` + `/api/task_events` endpoints (no new endpoints needed)
