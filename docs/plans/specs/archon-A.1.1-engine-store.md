# Spec: A.1.1 — Engine SQLite Schema + IWorkflowStore Implementation

> **Workstream:** A (Archon engine port)
> **Owner:** Executor subagent (Sonnet 4.6)
> **Status:** Ready for implementation
> **Depends on:** A.0 (stubs available so engine types compile)
> **Blocks:** A.2 (executor wiring), A.5 (resume), A.11 (reliability contract)
> **Archon source pin:** `78d32cfb751f1da433d1a81b89a9747f7d0167f8`
> **Authoritative DB schema:** `docs/plans/archon-engine-db-schema.md`
> **Authoritative store contract:** `archon/packages/workflows/src/store.ts` (lines 34-113)

## Goal

Create the SQLite-backed `IWorkflowStore` implementation that the ported Archon engine writes to. The DB lives at `~/.hermes/switchui-workflows.db` (single file, WAL mode, single-writer = Switch UI TanStack Start server).

This module is the **only** place SQL hits the engine DB. All `node_runs` / `workflow_runs` / `workflow_events` / `phase_transitions` / `gateway_event_cursor` writes funnel through here. No other module opens a connection to this file.

## Scope

### Files to create

```
src/server/workflow-engine/
├── db/
│   ├── client.ts              # better-sqlite3 connection singleton + WAL setup + single-instance lock
│   ├── migrations/
│   │   └── 001_init.sql       # verbatim DDL from archon-engine-db-schema.md §DDL
│   ├── migrate.ts             # migration runner (reads schema_meta.schema_version, applies pending)
│   └── migrate.test.ts        # idempotency + version-bump tests
├── store/
│   ├── workflow-store.ts      # `class SwitchUiWorkflowStore implements IWorkflowStore`
│   ├── workflow-store.test.ts # full method coverage against in-memory DB
│   ├── types.ts               # row-shape types + JSON-field interfaces
│   └── index.ts               # barrel + factory `createWorkflowStore({ dbPath })`
```

### Files NOT in scope

- Engine executor / DAG executor (A.1)
- Kanban event consumer + cursor advance logic (A.2.3)
- Idempotency key threading on dispatch (A.11; this spec exposes the columns, A.11 owns the state machine)
- SSE bridge (A.1.2)

## DB schema

**Source of truth:** `docs/plans/archon-engine-db-schema.md` §DDL. Migration `001_init.sql` is a **verbatim copy** of that DDL — no edits. If a column needs to change, edit the schema doc first, then regenerate the migration.

Migration runner contract:
- Read `schema_meta.schema_version` (string).
- Compare against the highest numeric prefix in `migrations/`.
- Apply pending migrations in `BEGIN; ... COMMIT;` transactions.
- Fail loud if a migration file is missing or out-of-order.
- On a fresh DB, run `001_init.sql` then insert `schema_meta` rows.

## `IWorkflowStore` method-by-method mapping

Source: `archon/packages/workflows/src/store.ts:34-113`. Executor must read that file before implementing. The 17 methods and their SQL targets:

| Method (signature) | Implementation |
|---|---|
| `createWorkflowRun(input)` | `INSERT INTO workflow_runs (...)` with `status='pending'`, `current_phase='plan'`, `started_at=now`, `last_heartbeat=now`. Returns full row. |
| `getWorkflowRun(id)` | `SELECT * FROM workflow_runs WHERE id=?`. Return null if not found. |
| `updateWorkflowRun(id, patch)` | Dynamic `UPDATE workflow_runs SET <col>=? ... WHERE id=?`. Only allow whitelisted columns (`status`, `current_phase`, `metadata`, `error`, `completed_at`, `last_heartbeat`). Reject unknown keys. |
| `completeWorkflowRun(id, metadata?)` | Transaction: `UPDATE workflow_runs SET status='completed', completed_at=now, metadata=? WHERE id=?` + append `workflow_events` row of type `workflow_completed`. |
| `failWorkflowRun(id, error, metadata?)` | Transaction: `UPDATE ... status='failed', error=?, completed_at=now` + append `workflow_failed` event. |
| `cancelWorkflowRun(id)` | Transaction: `UPDATE ... status='cancelled', completed_at=now` + `workflow_cancelled` event. Idempotent — if already terminal, no-op. |
| `pauseWorkflowRun(id)` | `UPDATE ... status='paused'`. No event (engine emits separately). |
| `resumeWorkflowRun(id)` | `UPDATE ... status='running'`. Idempotent. |
| `getActiveWorkflowRunByPath(path)` | `SELECT * FROM workflow_runs WHERE working_path=? AND status IN ('pending','running','paused') ORDER BY started_at DESC LIMIT 1`. **Split-brain guard:** callers must invoke this before `createWorkflowRun`. |
| `heartbeatWorkflowRun(id)` | `UPDATE workflow_runs SET last_heartbeat=? WHERE id=? AND status IN ('pending','running')`. Returns affected row count. |
| `failOrphanedRuns(thresholdMs=300000)` | `UPDATE workflow_runs SET status='failed', error='orphaned: no heartbeat', completed_at=now WHERE status IN ('pending','running') AND last_heartbeat < (now - ?)`. Returns affected rows. Called on Switch UI server boot (cold-start sweep, A.11). |
| `createNodeRun(input)` | `INSERT INTO node_runs` with `status='pending'`. Returns full row. Honor `UNIQUE(workflow_run_id, dag_node_id, loop_iteration)` — on conflict, throw a typed `DuplicateNodeRunError` (callers decide whether to load existing). |
| `updateNodeRun(id, patch)` | Dynamic `UPDATE` like `updateWorkflowRun`. Whitelisted columns include `status`, `kanban_task_id`, `started_at`, `completed_at`, `summary`, `error`, `retries`, `assigned_agent`, `approval_response`, `artifact_refs`, `metadata`. |
| `getCompletedDagNodeOutputs(runId)` | `SELECT dag_node_id, summary FROM node_runs WHERE workflow_run_id=? AND status='completed' AND loop_iteration IS NULL`. Loop-output reconstruction is a separate helper (see below). |
| `appendWorkflowEvent(event)` | `INSERT INTO workflow_events`. Caller supplies UUID + `created_at`. Idempotent on `(id)`. |
| `listWorkflowEvents(runId, opts?)` | `SELECT * FROM workflow_events WHERE workflow_run_id=? ORDER BY created_at ASC`. Optional `afterId` / `eventTypes` filters. Used by SSE bridge for replay. |
| `recordPhaseTransition({runId, fromPhase, toPhase, decidedBy, decisionData})` | `INSERT INTO phase_transitions`. UUID + `at=now`. |

### Additional helpers (not on the interface, but engine needs)

| Helper | Purpose |
|---|---|
| `getLoopChildOutputs(parentNodeRunId)` | `SELECT dag_node_id, summary, loop_iteration FROM node_runs WHERE loop_parent_node_run_id=? ORDER BY loop_iteration ASC`. For loop-output map reconstruction during resume. |
| `getCursor(consumerId)` | `SELECT last_event_id FROM gateway_event_cursor WHERE consumer_id=?`. |
| `setCursor(consumerId, eventId)` | `INSERT INTO gateway_event_cursor ... ON CONFLICT(consumer_id) DO UPDATE SET last_event_id=?, last_seen_at=?, updated_at=?`. Atomic with the consumer's batch transaction. |
| `getWorkflowDefinition(id)` | `SELECT * FROM workflow_definitions WHERE id=?`. |
| `upsertWorkflowDefinition(def)` | `INSERT ... ON CONFLICT(id) DO UPDATE` with `checksum` short-circuit (skip write if checksum unchanged). |
| `listWorkflowDefinitions(filter?)` | Optional filter by `source` / `scope_path`. |

## Connection management

```ts
// db/client.ts
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { homedir } from "node:os";

const DB_PATH = join(homedir(), ".hermes", "switchui-workflows.db");
const LOCK_PATH = `${DB_PATH}.lock`;

let dbInstance: Database.Database | null = null;
let lockFd: number | null = null;

export function openDb(dbPath: string = DB_PATH): Database.Database {
  if (dbInstance) return dbInstance;
  mkdirSync(join(homedir(), ".hermes"), { recursive: true });

  // Single-instance lock (A.11 reliability — required, not optional).
  // O_CREAT | O_EXCL: open succeeds only if file doesn't exist.
  // Throws EEXIST if another process holds the lock.
  try {
    lockFd = openSync(LOCK_PATH, "wx");
    process.on("exit", releaseLock);
    process.on("SIGINT", () => { releaseLock(); process.exit(0); });
    process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Switch UI workflow engine: another instance holds ${LOCK_PATH}. Refusing to start.`);
    }
    throw err;
  }

  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  dbInstance.pragma("busy_timeout = 5000");
  return dbInstance;
}

function releaseLock() {
  if (lockFd !== null) { try { closeSync(lockFd); } catch {} ; lockFd = null; }
  try { require("node:fs").unlinkSync(LOCK_PATH); } catch {}
}

export function closeDb() {
  if (dbInstance) { dbInstance.close(); dbInstance = null; }
  releaseLock();
}
```

**Single-instance lock note:** This is the lock A.11 requires. Implementing it here (not deferring to A.11) is intentional — the DB cannot be safely shared, so the moment we open it we must claim ownership.

## Status enum — canonical values

From `archon/packages/workflows/src/schemas/workflow-run.ts:10` (verified by Codex review):

- `workflow_runs.status` ∈ `{ pending, running, paused, completed, failed, cancelled }` — use `completed`, **never** `done`.
- `node_runs.status` ∈ `{ pending, ready, running, paused, completed, failed, cancelled, skipped }`.
- `current_phase` ∈ `{ plan, route, execute, review, report }`.

Encode these as `as const` TypeScript unions in `store/types.ts`. Runtime validators (Zod) live in A.1 schema port — do not duplicate here.

## Transaction discipline

- All multi-statement methods (`completeWorkflowRun`, `failWorkflowRun`, `cancelWorkflowRun`) MUST wrap in `db.transaction(() => { ... })()`.
- Cursor advance + event append (called by A.2.3) MUST be one transaction — store exposes `withTransaction<T>(fn: (tx) => T): T` helper.
- No nested transactions.

## Tests required

Vitest, in-memory DB (`new Database(":memory:")` + run migrations on it before each test).

### `migrate.test.ts`
1. Fresh in-memory DB → run migrations → `schema_meta.schema_version='1'`.
2. Re-running migration runner is a no-op (idempotent).
3. Tampered `schema_meta` → migration runner detects + throws.

### `workflow-store.test.ts`
1. `createWorkflowRun` then `getWorkflowRun` round-trip.
2. `getActiveWorkflowRunByPath` returns only active statuses; ignores completed/failed/cancelled.
3. `createNodeRun` with duplicate `(run, dag_node, loop_iteration)` throws `DuplicateNodeRunError`.
4. `updateNodeRun` rejects non-whitelisted column → throw.
5. `completeWorkflowRun` is atomic: kill in middle of transaction (simulated via Vitest mock throwing on event insert) → status NOT flipped (transaction rollback).
6. `failOrphanedRuns(300_000)` flips only runs whose `last_heartbeat < now - 300s`.
7. `getCompletedDagNodeOutputs` excludes loop-iteration children.
8. `getLoopChildOutputs` returns iterations in order.
9. Cursor: `setCursor` then `getCursor` round-trip; `setCursor` upsert (second call updates same row).
10. Concurrent reads + single writer: open second connection in read-only mode, confirm WAL allows reads while a write transaction is open (smoke).

### Single-instance lock test
1. Open DB once → second `openDb()` call from same process returns cached instance.
2. Spawn a child Node process that opens the DB → child fails with the explicit "another instance holds" message. (Use `child_process.spawn` in a test.)

## Verification gates (verifier subagent)

1. Migration file is byte-identical to the DDL in `archon-engine-db-schema.md` §DDL (run `diff` between the two).
2. Every `IWorkflowStore` method on `store.ts:34-113` is implemented. Verifier greps the engine source and confirms no method is missing.
3. Status enum strings match upstream — no `'done'`, no `'success'` (use `'completed'`).
4. `pnpm tsc --noEmit` clean.
5. All vitest cases above pass.
6. Lock-file test: kill the test process with `SIGKILL` mid-run → next `openDb()` works (lock cleanup on EXIT is best-effort; explicit recovery is a documented operational step, not a test invariant for SIGKILL).
7. No raw `Database()` constructor calls outside `db/client.ts`. (Grep gate.)

## Deliverables checklist

- [ ] `db/client.ts` with single-instance lock
- [ ] `db/migrations/001_init.sql` verbatim from schema doc
- [ ] `db/migrate.ts` + tests (3 cases)
- [ ] `store/workflow-store.ts` implementing all 17 `IWorkflowStore` methods + 6 helpers
- [ ] `store/workflow-store.test.ts` covering all method behaviors above
- [ ] `store/types.ts` with `as const` enum unions matching upstream
- [ ] `store/index.ts` barrel exporting `createWorkflowStore` factory
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm vitest run src/server/workflow-engine` green
- [ ] PR description lists which 17 `IWorkflowStore` methods exist and points at line in `workflow-store.ts` for each

## Open questions deferred to A.2 / A.11

- Idempotency key generation strategy on `node_runs` (the column exists per schema doc, but threading it through dispatch is A.11's job).
- Reaper cadence / who calls `failOrphanedRuns` on boot (A.11 wires the boot sequence).
- Heartbeat tick frequency (60s per schema doc design notes — A.1 executor wires it).

## Non-goals

- No engine logic (DAG executor, condition evaluator, etc.) — A.1.
- No event emitter or SSE — A.1.2.
- No gateway HTTP client — A.2.
- No dispatcher — A.3.
- No reaper cron — A.11.
