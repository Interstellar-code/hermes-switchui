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
