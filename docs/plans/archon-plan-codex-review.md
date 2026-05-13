# Archon-Hermes Integration Plan — Independent Review

> Reviewer: Codex (second-opinion pass, read-only)
> Date: 2026-05-13
> Primary doc: `docs/plans/archon-hermes-integration.md`
> Supporting: `archon-engine-research.md`, `archon-workflows-research.md`, `archon-engine-db-schema.md`
> Archon source cross-referenced at: `/Volumes/Ext-nvme/Development/archon`

---

## 1. Soundness Check

### Engine in TanStack Start server (not Hermes gateway plugin)
**Defensible**, under a strict single-instance assumption. The plan explicitly wants a "Single-writer" DB owned by the Switch UI server (`archon-engine-db-schema.md:10`) and argues Switch UI is the only consumer (`archon-hermes-integration.md:618`). That is a reasonable v1 trade if you commit to "one server process owns the engine." It is **not safe** if TanStack Start gets horizontally scaled — the DB path is a flat file and SQLite WAL does not handle multi-process writers across machines.

### Engine-owned SQLite vs Kanban-only
**Defensible and necessary.** Upstream Archon requires an `IWorkflowStore` with run lifecycle, pause/resume, orphan reaping, and completed-node lookup (`archon/packages/workflows/src/store.ts:34`). Kanban alone does not cover route-phase state, phase transitions, resumable node outputs, or engine-local metadata. Trying to squeeze this into the Kanban tables would require invasive gateway schema changes — exactly what the plan wants to avoid.

### No provider port + kanban-dispatcher.ts replacement
**Defensible, and probably the right cut.** The upstream provider port cost is real: 14 files / ~2,694 LOC (`archon-engine-research.md:277`). The workflow catalog shows Codex is only materially present in `archon-workflow-builder`, which the plan already defers (`archon-workflows-research.md:297`, `archon-hermes-integration.md:391`). Skipping the port and routing through the gateway dispatcher is the lower-risk path.

### 5-phase wrapper (plan → route → execute → review → report) around every run
**Directionally defensible as a product shell, but overdesigned as a hard invariant.** Upstream Archon has a DAG engine and a router prompt, not a built-in five-phase state machine (`archon/packages/workflows/src/router.ts:73`). Making this wrapper mandatory for every run creates a second orchestration layer you now have to prove correct alongside the DAG executor. For v1, making `review` and `report` optional capabilities rather than universal phases would reduce state-machine surface and keep the initial engine simpler to validate.

### 20 YAML adjustment pass
**Not defensible for v1 as written.** The same document says v1 is an 8-workflow subset (`archon-hermes-integration.md:373`) but A.9 still frames a broad 20-YAML pass (`archon-hermes-integration.md:427`). That is scope inflation, not architecture. Adjust 8 YAMLs for v1; defer the remaining 12.

---

## 2. Risks the Plan Underweights or Misses

### Cross-DB consistency (HIGH — biggest implementation risk)
The plan explicitly splits state between engine DB and gateway-owned Kanban rows (`archon-hermes-integration.md:146`, `archon-engine-db-schema.md:6`). A `node_run` can be created and the `POST /api/tasks` call can fail after partial progress, or vice versa. There is no two-phase commit and no idempotency key threading in the plan.

**Mitigation:** Add a dispatch state machine with `pending_dispatch` → `dispatched` → `reconciled` per node run. Thread an idempotency key through the gateway task body/metadata. Add a startup reconciliation sweep that queries the gateway for any known `kanban_task_id` still in an open state.

### Event ordering races (HIGH)
The plan says the consumer starts from `now` on a missing cursor (`archon-hermes-integration.md:224`). That can silently lose completion events for tasks created before the consumer becomes healthy — e.g., after a crash mid-run or a deployment restart.

**Mitigation:** Persist cursor before launch. Add a poll-by-`kanban_task_id` repair path that does not rely on event ordering. Add a reconciliation sweep on startup that scans open `node_runs` and back-fills their terminal status from the gateway.

### Schema instability / migration strategy (MEDIUM)
The main doc uses `~/.hermes/switchui-workflows.db` (`archon-hermes-integration.md:7`); the schema doc uses `~/.hermes/switchui-workflow-engine.db` (`archon-engine-db-schema.md:4`). The main doc uses `status='done'` (`archon-hermes-integration.md:160`); upstream's terminal enum value is `completed`, not `done` (`archon/packages/workflows/src/schemas/workflow-run.ts:10`). These inconsistencies will produce migration conflicts before the first line of production code is written.

**Mitigation:** Lock the canonical DB filename, status enum values, and table names in one authoritative schema document before writing any migrations. Use `better-sqlite3-migrations` or equivalent from day 1.

### Resume edge cases — split-brain design (HIGH)
A.1.1 says completed outputs come from `node_runs` (`archon-hermes-integration.md:165`). A.5 switches to querying gateway `task_runs` (`archon-hermes-integration.md:329`). That is split-brain in the design itself — two sources of truth for resume state.

**Mitigation:** Pick one canonical resume source. For this architecture it must be engine-owned `node_runs`. Delete the `task_runs`-based resume path from A.5.

### Loop iteration state machine (HIGH)
Upstream interactive loops carry `iteration` and `sessionId` in approval metadata (`archon/packages/workflows/src/schemas/workflow-run.ts:110`) and the DAG executor explicitly threads fresh-vs-resumed loop state (`archon/packages/workflows/src/dag-executor.ts:1831`). The plan's claim "resume re-enters loop at next iteration" is a hypothesis not backed by upstream source — the source shows loop state is woven into the executor's mutable run object, not a simple counter increment.

**Mitigation:** Define the persisted loop state schema precisely (which fields survive a pause, how they map to `node_runs` rows) and test pause/resume mid-loop on a simple loop workflow before porting any multi-iteration workflow.

### YAML schema versioning (MEDIUM)
`hermes_task`, `approval_target`, `when_to_use`, and (proposed) `schedule` are all plan-added fields. Upstream schema does not define them (`archon/packages/workflows/src/schemas/workflow.ts:56`). As more YAMLs get adjusted, schema drift becomes hard to audit and forward-compatible parsing becomes fragile.

**Mitigation:** Namespace all Switch-specific extension fields under one key (e.g., `x-hermes:`) and stamp a schema version field. Validate against a Zod extension schema on load.

### Hermes worker capacity vs DAG fan-out (MEDIUM)
The plan wants 5-agent review fan-out reused across six workflows (`archon-workflows-research.md:314`, `archon-hermes-integration.md:401`). Concurrent fan-out layers will queue up against the gateway's worker pool with no backpressure.

**Mitigation:** Add per-run concurrency caps. Add queue-aware admission control before launching fan-out layers (check gateway queue depth before dispatching a batch node).

### Observability gaps (MEDIUM)
SSE is tied to the in-memory emitter (`archon-hermes-integration.md:182`), but events only exist in the in-process emitter — a crash loses all in-flight updates. Some important lifecycle transitions (orphan reap, loop re-entry, approval expiry) have no surface in the event stream.

**Mitigation:** Correlation IDs on every node run. Persist events to the engine DB before emitting. Add consumer-lag metrics, stuck-run alerts, and a reconciliation-errors counter visible in the Conductor UI.

---

## 3. Sequencing Red Flags

### A.2.1 contradicts the no-provider-port decision
`archon-hermes-integration.md:204–205` still reads: "For execute-phase Claude/Codex-provider nodes: invoke the ported provider's `sendQuery()` directly." That directly contradicts A.3 ("Providers: NOT PORTED") and the key architectural decision at `archon-hermes-integration.md:623`. This section was not updated after the decision was made. If an implementer reads A.2.1 literally, they will port the providers.

### A.8 is sequenced before its dependencies exist
A.8 (phase transition locks) is listed as P0 after A.1/A.1.1, but execute/review semantics depend on A.2 (executor wiring) and A.3 (dispatcher contract). You cannot define valid phase transitions before the dispatch and reconciliation contracts exist.

### A.10 assumes features that do not exist upstream
A.10 includes `subworkflow:` and YAML `schedule:` launch paths (`archon-hermes-integration.md:477–478`). Upstream schema has neither. Repo grep found no usage. These are hidden feature proposals embedded in a "launch pass" section — they need to be separated into a distinct design spike before they enter any implementation order table.

### Workstream B is mis-scoped
The task brief says two pages: existing Conductor and a new Workflows CRUD page. The plan spends Workstream B on Conductor, Operations, and Settings (`archon-hermes-integration.md:534`). The Workflows CRUD page does not appear by name. That is both a sequencing and a scope miss.

---

## 4. Scope Creep / Over-Engineering

| Item | Verdict |
|---|---|
| Mandatory `review` and `report` phases for every run | Cut for v1. Make them optional workflow capabilities. |
| Operations page wiring | Cut. Not in stated scope. |
| Settings page | Cut. Not in stated scope. |
| Manifest file + Hermes "workflow awareness" boot flow | Cut unless chat-based launch is a hard requirement. UI-triggered launch does not need it. |
| YAML `schedule:` self-registration | Cut. Pick one scheduler (Hermes cron). Local timers are another coordination problem. |
| `approval_target: kanban_comment` | Cut for v1. Standard approval flow is sufficient. |
| `subworkflow:` launch path | Cut. Not upstream, not needed for 8-workflow v1. |
| Full 20-YAML metadata pass (A.9) | Cut to 8-YAML pass matching v1 subset. |
| `when_to_use:` field on all YAMLs | Cut for now. Chat-routing metadata is a later feature. |

---

## 5. Scope Under-Engineering (Missing for v1 Ship)

### Server API contracts
Workstream B assumes backend routes exist, but Workstream A never defines the full backend route surface (method, path, request/response shape, auth) for engine-trigger, run-status, pause/resume, and approval endpoints. Without explicit contracts, B and A will build mismatched surfaces.

### Test strategy
The plan hand-waves "a separate test plan" (`archon-hermes-integration.md:612`). That is not enough for a design this stateful. Missing test cases that must be called out:
- Restart mid-dispatch (node dispatched, server dies, restarts — does it re-dispatch or reconcile?)
- Duplicate gateway event received (idempotent completion handling)
- Partial fan-out failure (2 of 5 review agents fail)
- YAML changed between run creation and resume
- Paused-approval expiry with no human response

### Ops playbooks
Missing: cursor reset procedure, orphan task reconciliation runbook, migration rollback, stuck-paused-run cleanup, DB backup/restore procedure. Without these, first production incident will be manual archaeology.

### Dev DB seeding
No mention of seeded fixtures: example workflow definitions, a fake gateway event stream (for offline dev), synthetic paused/failed/completed runs, and a local "review fan-out saturation" test case. Without fixtures, development requires a live gateway for every code change.

### Deployment invariant: single-instance only
The DB doc says single-writer; the plan never turns that into an explicit operational constraint. This needs to be documented as a hard deployment rule and enforced with a startup lock (e.g., SQLite application lock or a PID file).

---

## 6. Section-Level Critiques

### Introduction / framing (L5–L7 vs L33–L37)
> "Keep only: the YAML DAG engine, Claude Code/Codex providers..." (`archon-hermes-integration.md:5`)

> "Providers: NOT PORTED" (`archon-hermes-integration.md:33`)

These two statements are in direct conflict. They are in the same document, 28 lines apart. Delete all provider-porting language from the introduction.

### L48 — stated goal contradicts A.3
> "add Claude Code/Codex provider support" (`archon-hermes-integration.md:48`)

A.3 says the opposite. This line was not updated after the architectural decision. Delete it.

### A.1.1 — wrong status enum
> `status='done'` (`archon-hermes-integration.md:160`)

Upstream terminal status is `completed`, not `done` (`archon/packages/workflows/src/schemas/workflow-run.ts:10`). Using `done` will silently break any code that checks terminal state against the upstream enum.

### A.2.1 — stale execution model
> "For execute-phase Claude/Codex-provider nodes: invoke the ported provider's `sendQuery()` directly" (`archon-hermes-integration.md:204–205`)

This section was not updated after the no-provider-port decision. It will mislead an implementer. Rewrite to describe kanban-dispatcher invocation only.

### A.2.3 — cursor table name mismatch
> `engine_state` table (`archon-hermes-integration.md:224`)

Schema doc defines `gateway_event_cursor` (`archon-engine-db-schema.md:186`). Pick one name and use it everywhere.

### A.5 — cross-attempt `task_runs` query
> "Query gateway `task_runs` for prior attempt outputs" (`archon-hermes-integration.md:329–331`)

This invents a `task_runs.kind='resume'` convention not defined anywhere in the plan or upstream. It also breaks the single-source-of-truth rule for resume state. Delete this path; use engine-owned `node_runs` exclusively.

### A.5 — loop resume overclaim
> "Resume re-enters loop at next iteration" (`archon-hermes-integration.md:336`)

This is stated as fact. Upstream source shows loop state is carried in the executor's mutable run object and approval metadata, not as a simple iteration counter (`archon/packages/workflows/src/dag-executor.ts:1831`). Label this as a design hypothesis and add a required test gate.

### A.7 — count mismatch
The heading says "v1 port subset (8 workflows)" but the list has 9 numbered entries, one of which is marked "deferred to v1.1." Reconcile the count before implementation.

### A.8 — self-contradictory phase contract
> "This is the only phase that can write `node_runs` rows" (`archon-hermes-integration.md:423`)

> Review phase creates new `node_runs` (`archon-hermes-integration.md:418`)

Two sentences apart, the contract contradicts itself. Specify which phases are allowed to create `node_runs` rows and which can only update them.

### A.10 — invented YAML keys
> `subworkflow:` and `schedule:` as launch paths (`archon-hermes-integration.md:477–478`)

Neither key exists in upstream schema. Neither appears in the Archon source. These are undeclared scope additions embedded in a "launch pass" section. Move them to a separate design spike or explicitly mark as out-of-scope for v1.

### A.10 — `when_to_use:` schema extension
> "Add `when_to_use:` to all YAMLs" (`archon-hermes-integration.md:518`)

Schema change with no versioning plan, no Zod extension, and no migration story. Needs a schema extension section before this can be implemented.

### DB schema doc — filename mismatch
> `switchui-workflow-engine.db` (`archon-engine-db-schema.md:4`)

Main plan uses `switchui-workflows.db` (`archon-hermes-integration.md:7`). This is the kind of inconsistency that breaks tooling, migrations, and ops runbooks. Pick one canonical name before implementation.

---

## 7. Final Verdict

**Do not start broad implementation from this document as-is.**

The core architectural direction is sound and green-lightable:
- Engine in TanStack Start server: ✓
- Engine-owned SQLite: ✓
- kanban-dispatcher instead of provider port: ✓

**Implementation is blocked until four things are fixed in the plan:**

1. **Remove all stale provider-port language.** Every mention of "ported provider's `sendQuery()`", "Claude Code/Codex provider support", and "Keep only: the YAML DAG engine, Claude Code/Codex providers" must be deleted or rewritten to match the actual decision.

2. **Lock the DB contract.** One canonical filename, one canonical status enum (use upstream `completed` not `done`), one cursor table name, one resume source of truth (`node_runs` only). Write it in the schema doc, reference it everywhere else.

3. **Cut v1 scope explicitly.** Conductor + Workflows CRUD + 8-workflow subset. Drop Operations, Settings, manifest boot flow, local schedule, subworkflow, and the full 20-YAML pass. Put the cut items in a v1.1 backlog section.

4. **Write the reliability contract.** Dispatch idempotency key threading, event-consumer cold-start reconciliation, single-instance deployment rule (with startup lock), and the missing test cases for restart/resume/duplicate-event/partial-fan-out scenarios.

After those four fixes, the plan is implementable. Before them, it is not.

---

*Review complete. Archon source cross-referenced at `/Volumes/Ext-nvme/Development/archon/packages/workflows/src/`.*
