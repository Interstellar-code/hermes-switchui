# Archon-Hermes Integration Plan

> **Status:** Planning doc — split into two workstreams. Reviewed by Codex (via Neo). Reviewed by Switch (May 13). Gaps closed.
> **Implementation status (May 15, 2026):** Workstream A complete except A.7 (workflow-content polish). Runtime + content shipped: A.0–A.6, A.8–A.11. **7-bundle Codex audit cycle cleared** (22 findings, 22 fixes). Branch: `feat/conductor-ops-wiring`. 36 commits ahead of `b7d140d4`. 135 vitest passing, 0 tsc errors. See § Implementation Status below.

---

## Implementation Status (auto-tracked)

| Item | Status | Notes |
|---|---|---|
| **A.0** Dependency stubs | ✅ shipped | `src/server/workflow-engine/stubs/{paths,git,providers,providers-types}.ts`. tsconfig path aliases. |
| **A.1** Engine port (~8800 LOC) | ✅ shipped | `core/` + `schemas/` + `validation/` + `discovery/` + `emitter/` + `routing/` + `wiring/` + `utils/` + `defaults/`. 30 files, archon SHA 78d32cfb. |
| **A.1.1** SQLite store | ✅ shipped | `~/.hermes/switchui-workflows.db`. 7 tables. Single-instance file lock. 17 IWorkflowStore methods + helpers. |
| **A.1.2** SSE bridge | ✅ shipped | `GET /api/workflow-events?conversation_id=X`. Per-conversation filtering. Heartbeat at 25s. |
| **A.2.1** Boot factory | ✅ shipped | `createWorkflowEngine()` singleton. Wires store + dispatcher + consumer + emitter + platform + deps + projector + cron poller. |
| **A.2.3** Task event consumer | ✅ shipped | Per-task polling. Cold-start reconciliation re-tracks in-flight dispatches. (Live dispatches now resolve inline via dispatcher polling — see A.3.) |
| **A.3** Kanban dispatcher | ✅ shipped | `IAgentProvider` impl. Inline polling until terminal (done/blocked/archived). Provider aliases: hermes-kanban, claude, codex. |
| **A.4** Cron triggers | ✅ shipped | PULL-based. `payload.switchui_workflow_id` convention. Per-job cursor in `gateway_event_cursor`. Zero gateway changes. |
| **A.5** Resume semantics | ✅ shipped | Approval API + `resumeMode` re-entry. `POST /api/workflow-runs/:runId/approve` flips node_run, resumes the run, re-launches DAG. Engine boot warns on lingering paused runs. End-to-end integration tested. |
| **A.6** Port 20 bundled YAMLs | ✅ shipped | Auto-seeded on engine boot via `seedBundledWorkflows()`. All 20 parse + insert. |
| **A.7** v1 subset polish (8 flows + 5-agent review subgraph) | ⏳ pending | YAMLs ship unmodified from upstream archon. |
| **A.8** 5-phase wrapper | ✅ shipped | `plan → route → execute → review → report`. `recordPhaseTransition` sole writer of `workflow_runs.current_phase`. `launchWorkflowRun` orchestrates the lifecycle. |
| **A.9** Annotate 8 v1 YAMLs with `hermes_task:` | ✅ shipped | 23 `hermes_task:` blocks across the 8 v1 YAMLs in `bundled-defaults.generated.ts`. Zod schema extended with optional `hermes_task` field on `dagNodeBaseSchema`. |
| **A.10** Launch surfaces + Hermes manifest | ✅ shipped | `writeWorkflowsManifest()` writes `~/.hermes/switchui-workflows.json` on every engine boot. Surfaces id/name/description/source/version/tags/node_count/has_loop/has_approval/when_to_use/checksum for every workflow definition. Cron trigger path also shipped (A.4). |
| **A.11** Reliability contract | ✅ shipped | Single-instance lock (A.1.1), cold-start orphan reaper, cold-start dispatch reconciliation, idempotency key threading via `node_run.id` + Kanban `idempotency_key`. |
| **B.0** API client layer | ✅ shipped | `src/screens/workflows/api-client.ts` + `use-workflows.ts` (TanStack Query hooks). |
| **B.1** Conductor page wiring | ⏳ pending | Still on mock data. |
| **B.2** Operations page wiring | ⏳ pending | Still on mock data. |
| **B.3** Settings page (dispatcher/worker status) | ⏳ pending | — |
| **B.4** Workflows page wiring | ✅ shipped | Library/Grid (Path A) + Editor/Wizard/RunDetail (Path B). `mock-workflows.ts` deleted. |
| **Bonus** Run-detail panel | ✅ shipped | `?run=<id>` URL → live status + phase timeline + node_runs table + SSE feed. |
| **Bonus** node_runs projector | ✅ shipped | Subscribes to emitter, materialises `node_runs` rows from `node_started/completed/failed/skipped/loop_iteration_*` events. |
| **Bonus** Parsed-YAML endpoint | ✅ shipped | `GET /api/workflow-definitions/:id/parsed` returns `{ definition, parsed: { nodes[], edges[], has_loop, has_approval, ... } }`. |

**Tests:** 135 passing across 20 vitest files. 0 tsc errors in workflow-engine + routes.

**Codex audit cycle (May 14-15, 2026):** 6 bundle audits completed; 14 findings resolved.

| Bundle | Scope | Findings | Fixes (commits) |
|---|---|---|---|
| 1 | Engine foundation (A.0 + A.1 + A.1.1) | 1 important | 6e311930 — stale DB lock reap on PID check |
| 2 | Execution path (A.3 + A.2.3 + projector) | 4 important | bf2a79ac — Q1 wall-time cap, Q2 idempotency guard, Q4 canonical Kanban→node status mapper, Q5 cancellable poll sleep |
| 3 | 5-phase wrapper (A.8 + runtime) | 3 important | 1d017084 — Q3 nested catch, Q4 parse-before-phase, Q6 CRLF checksum |
| 4 | Boot + reliability (A.2.1 + A.11 + A.4) | 1 blocker + 3 important | 9887ddb0 — Q6 lock-on-fail try/catch, Q5 deterministic cron conversation_id, Q4 disabled-interval suppression |
| 5 | HTTP API surface | 5 important | 57890ff9 — Q3 upsert validation, Q4 launch security, Q6 ETag/Cache-Control, Q7 array caps |
| 6 | UI wiring (B.0 + B.4 + run-detail) | 1 important | d012f2f5 — Q3 double-submit guard |
| 7 | A.5 + A.9 + A.10 follow-up | 8 important | 882702ed — A5.Q1 atomic claim, A5.Q2 resume-safe parse, A5.Q4 SSE emitter call, A9.Q1 transform fix, A9.Q3 77 new annotations (23→100), A10.Q1 manifest refresh on upsert, A10.Q2 outputPath sanitization, A10.Q3 real YAML parse for when_to_use |

**Open gaps (priority order — revised May 15):**

> **Priority shift:** /workflows page is the core surface for everything we just built. Tighten it end-to-end BEFORE touching Conductor/Operations. Only after /workflows is polished + tested do we tackle the Mission-bridge design decisions for Conductor.

### B.4-extended — /workflows page deep wiring (NEXT)

1. **Approval action in Run-Detail Panel** — when run.status === 'paused' AND a node_run has approval_message set, show Approve / Reject buttons calling `POST /api/workflow-runs/:runId/approve`. Surface approval_message + capture optional response text. Critical UX: currently A.5 backend is wired but no UI to drive it.
2. **Definition CRUD UI** — "+ New Workflow" button currently logs to console. Build: YAML editor modal → POST /api/workflow-definitions → reload list. "Import YAML" button similar with file picker. Add delete confirm (backend currently 501 — also implement the DELETE on store + route).
3. **Per-workflow run history** — Editor's "History" tab (currently shows live events for the active conversation) should also list ALL runs of THIS workflow_id. Add `GET /api/workflow-runs?workflow_id=X` already works; wire a hook + table.
4. **Library card stats** — `last_used_at`, `run_count` are zero today. Need a stats endpoint OR include aggregate in list response.
5. **Launch Wizard variable form** — `required_inputs` / `optional_inputs` from parsed endpoint are empty arrays today. Either ship a `vars:` schema extension on workflow YAML and parse it OR leave wizard with the free-form "user message" only (current).
6. **YAML editor UX** — syntax highlighting + inline validation feedback (call POST /api/workflow-definitions with a "validate-only" mode that returns parse errors without writing).
7. **Cron schedule UI** — schedule a workflow from /workflows. Surfaces the A.4 cron triggers feature.

### Workstream B continued (AFTER /workflows lock-in)

1. **B.1 Conductor page** — bridge engine workflow_runs into the existing Mission concept (Conductor is NOT mocked — has own `/api/conductor/*` backend; integration is a design decision).
2. **B.2 Operations page** — same model question.
3. **B.3 Settings page** — dispatcher health + worker pool surfaces.
4. **A.7 v1 subset polish** — 5-agent review subgraph + workflow-content design for the 8 v1 flows. Not engine work; YAML iteration.

---

**Goal:** Port the Archon workflow engine into Hermes Switch UI as a native subsystem. Strip what we don't need (platform adapters, chat UI, layout shell, dashboard, **Claude Code / Codex providers**, **upstream DAG builder UI**). Keep only: the YAML DAG engine + schemas + validators. Providers are replaced by a thin `kanban-dispatcher.ts` that routes execute-phase AI work to Hermes Kanban; Hermes Agent already drives `claude` / `codex` CLIs natively. Conductor + Workflows CRUD UI is built in Switch UI's existing Matrix-themed design system, not ported.

**Architecture philosophy:** Take the pieces, not the package. Archon's core engine becomes a Switch UI server module running inside the **TanStack Start server runtime**. It gets its own SQLite database — `~/.hermes/switchui-workflows.db` — containing only workflow-engine-owned tables. Anything that overlaps with Hermes Kanban remains gateway-owned and is accessed over the existing HTTP API. **Hermes Agent gateway stays untouched** — Switch UI engine consumes task lifecycle events (`task_events`), creates Kanban tasks, and reads `task_links` exclusively via the existing gateway HTTP API. No new RPC into the gateway, no engine code inside the gateway. Providers and upstream UI are NOT ported.

**Runtime topology:**

```
SwitchUI (TanStack Start, :3000)
├── Frontend: React pages (Conductor UI, Operations UI)
└── Server functions / API routes (TanStack Start server runtime)
    ├── Existing: gateway proxy → :9119, gateway-capabilities probe, etc.
    └── NEW: workflow engine (src/server/workflow-engine/)
        ├── DAG resolver (ported Archon dag-executor + scheduler)
        ├── Event consumer (subscribes/polls gateway task_events; long-poll or SSE)
        ├── Engine state DB (own SQLite at `~/.hermes/switchui-workflows.db` — tables: workflow_definitions,
        │   workflow_runs, node_runs, workflow_events, phase_transitions, gateway_event_cursor)
        └── kanban-dispatcher.ts (routes execute-phase AI work to Hermes via gateway HTTP)

Hermes Agent Gateway (:9119)
├── UNTOUCHED
├── Kanban DB owns tasks, task_events, task_links, task_runs, task_comments
├── Dashboard API
├── Dispatcher
└── Cron
```

**The 5-phase orchestration wrapper:** Every Switch UI workflow run flows through `plan → route → execute → review → report`. The 20 ported Archon YAMLs are templates whose internal DAG runs during the **execute** phase — their nodes are adjusted to map to Hermes Kanban task creation rather than direct provider invocation. The plan phase is a conversational chat with Hermes; the route phase is the engine's translation of the agreed plan into a workflow instantiation. Details in A.8.

**Strip audit:** ~85% of Archon is redundant with Switch UI or Hermes Agent. We import only:
- Workflow engine: ~30 non-test files from `packages/workflows/src/`
- Internal deps: ~18 utility/hook/store files to port or bridge
- **Providers: NOT PORTED.** Hermes Agent already drives `claude` CLI + `codex` CLI + other agentic coding tools. Execute-phase AI nodes go through Hermes Kanban tasks; Hermes workers shell out to the CLIs. Strips ~2,700 LOC of provider code + parallel-mechanism complexity. Engine import sites that referenced `@archon/providers` are rewritten to call a thin `kanban-dispatcher.ts` instead.
- **UI: NOT PORTED.** Switch UI already has its own Conductor page, Operations page, **Workflows page** (`/workflows` — Library rail + Grid + Editor + Launch Wizard, shipped on `feat/conductor-ops-wiring` as `src/routes/workflows.tsx` + `src/screens/workflows/`, currently mock-data only), and Matrix-themed design system. No Archon React components, DAG builder, workflow store, or design tokens are ported. Workstream B covers wiring existing Switch UI pages to Workstream A APIs — not building new UI from Archon source.

**Codex review outcome:** The old JSON Kanban store was identified as a gap — this is a non-issue. Hermes Kanban is SQLite with `task_links` (199 rows), `task_runs` (1,671 rows), `task_events` (6,981 rows), `task_comments`, and `tasks` (186 rows). The DAG execution layer, event streaming, and run lifecycle tracking already exist. The review's practical findings (dependency stubs, component count, routing migration) are folded in below.

---

## Workstream A: Archon Backend Integration

**Owner:** Switch (Tier 1) + Neo (Tier 2)
**Location:** `hermes-switchui/src/server/workflow-engine/`

**Goal:** Port the Archon workflow engine into Hermes Switch UI's server, wire it to the Hermes Agent (Kanban via gateway HTTP API) for execute-phase task dispatch. No upstream provider port — `kanban-dispatcher.ts` is the single execution channel. This is the backend that powers the Conductor + Workflows pages.

### A.0: Dependency Stub Module

**Goal:** Create `src/server/workflow-engine/archon-stubs.ts` providing drop-in replacements for Archon's two internal package dependencies (`@archon/paths`, `@archon/git`) plus a type-only stub for `@archon/providers/types` so A.1 can compile before A.3 ports the real providers. `@archon/isolation` is **NOT** needed — research confirmed zero engine/provider imports from it.

**`@archon/paths` symbols to stub** (used by 9 workflow files + 7 provider files):
- `createLogger(ns: string)` → Hermes internal logger facade
- `captureWorkflowInvoked()` → no-op (analytics call)
- `getHomeWorkflowsPath()` → `path.join(HERMES_HOME, 'workflows')`
- `getHomeScriptsPath()` → `path.join(HERMES_HOME, 'scripts')` (used by `script-discovery.ts:9`)
- `getArchonHome()` → `HERMES_HOME` (used by `codex/binary-resolver.ts:21` for vendor dir)
- `BUNDLED_VERSION` → constant string (used by `executor.ts:9`)
- `BUNDLED_IS_BINARY` → boolean from build flag (used by `defaults/bundled-defaults.ts` + both `binary-resolver.ts` files)
- **Action item before locking the stub:** three files do `import * as archonPaths from '@archon/paths'` (`executor-shared.ts:11`, `executor.ts:8`, `workflow-discovery.ts:27`). Enumerate every member-access on these star imports before freezing the stub surface.

**`@archon/git` symbols to stub** (3 use-sites):
- `execFileAsync` → `util.promisify(child_process.execFile)` (used by `dag-executor.ts:10`, `validator.ts:22`)
- `getDefaultBranch()` → returns `'main'` (used by `executor.ts:10`; no git worktrees in Hermes)
- `toRepoPath(p)` → identity (used by `executor.ts:10`; no git isolation)

**`@archon/providers` replacement — `agent-provider-types.ts` + Kanban dispatcher** (per A.3 strip decision):
- `dag-executor.ts`, `executor.ts`, `loader.ts`, `validator.ts` import `IAgentProvider`, `MessageChunk`, `TokenUsage`, `SendQueryOptions`, `NodeConfig`, `ProviderDefaultsMap`, `ProviderCapabilities`, `ProviderRegistration`, `ProviderInfo`, `AgentRequestOptions` from `@archon/providers/types`, AND registry helpers `isRegisteredProvider`, `getRegisteredProviders`, `getProviderCapabilities` from `@archon/providers`.
- Rather than port Archon's providers, we ship a tiny local types module + Kanban-backed dispatcher:
  - `agent-provider-types.ts` — type-only re-exports of the interfaces above (copied verbatim from Archon types.ts). No runtime code.
  - `kanban-dispatcher.ts` (A.3) — single implementation of `IAgentProvider` that talks to Hermes Kanban via gateway HTTP. `getAgentProvider(name)` returns this for any name; `getProviderCapabilities(name)` returns a static descriptor.
- Engine import sites rewritten to point at these local modules. No upstream Archon provider code ported.

**Bun → Node swap (single call site):**
- Only one Bun API in the entire engine: `Bun.YAML.parse(content)` at `loader.ts:29`. Replace with `yaml` (or `js-yaml`) npm package. One-line change. No other Bun-specific code anywhere in workflows or providers.

**Why first:** These imports are touched by 16+ engine/provider files. Porting once here means zero changes to ported source — only `import` rewrites.

### A.1: Core Engine Port

**Goal:** Extract and adapt Archon's workflow engine into Switch UI's server module. No UI dependencies.

- **Build A.0 first** (Dependency Stub Module above)

- **Files to port from `packages/workflows/src/` (30 non-test files, corrected per research):**
  - **Engine core (8 files, ~5,827 LOC):**
    - `dag-executor.ts` (3,184 LOC) — DAG executor: topological layers via Kahn's algorithm, `Promise.allSettled` per layer, all emitter `emit()` sites for node/loop/tool/workflow events, pause/cancel/approval transitions. Entry: `executeDagWorkflow()` at L2486.
    - `executor.ts` (850 LOC) — per-node provider dispatch wrapper
    - `executor-shared.ts` (534 LOC) — shared helpers: `classifyError`, `loadCommandPrompt` (lives here, NOT a standalone file), `substituteWorkflowVariables` (DAG-aware substitution, the real one), `detectCompletionSignal`, `stripCompletionTags`, `isInlineScript`, `formatSubprocessFailure`, `buildPromptWithContext`
    - `loader.ts` (504 LOC) — YAML → typed `WorkflowDefinition`. **Single Bun call here** (line 29: `Bun.YAML.parse`).
    - `router.ts` (266 LOC) — natural-language → workflow selection (whole-mission router, not per-node)
    - `event-emitter.ts` (261 LOC) — singleton `WorkflowEventEmitter` over `events.EventEmitter`. 15 emitter event variants. `runId → conversationId` map. Single channel: `'workflow_event'`.
    - `store.ts` (113 LOC) — `IWorkflowStore` interface + `WORKFLOW_EVENT_TYPES` constant (19 DB event names). **Definitions only — no impl.**
    - `deps.ts` (115 LOC) — `WorkflowDeps`, `IWorkflowPlatform`, `WorkflowConfig`, `AgentProviderFactory` — DI contract
  - **Schemas (7 files, ~1,234 LOC):**
    - `schemas/dag-node.ts` (638 LOC) — per-node Zod schema. `superRefine` enforces mutual exclusivity of `command/prompt/bash/loop/approval/cancel/script`. Exports `dagNodeBaseSchema`, per-variant schemas, `dagNodeSchema`, AI-field warning lists.
    - `schemas/workflow.ts` (162 LOC) — top-level `workflowDefinitionSchema`, worktree policy, result-type unions
    - `schemas/workflow-run.ts` (169 LOC) — `WorkflowRun`, `WorkflowRunStatus` (6 values), `NodeState`, `NodeOutput`, `ApprovalContext`, `ArtifactType`, `RESUMABLE_WORKFLOW_STATUSES` (`['failed','paused']`)
    - `schemas/index.ts` (121 LOC) — **the barrel** (re-exports). Plan previously omitted; required.
    - `schemas/hooks.ts` (88 LOC) — per-node `workflowNodeHooksSchema` (mirrors Claude SDK 21 hook events)
    - `schemas/loop.ts` (33 LOC) — `loopNodeConfigSchema`: `prompt`, `until`, `max_iterations`, `fresh_context`, `until_bash`, `interactive`, `gate_message`
    - `schemas/retry.ts` (23 LOC) — `stepRetryConfigSchema`: `max_attempts` (1–5), `delay_ms` (1000–60000), `on_error` ('transient' | 'all')
  - **Validators (4 files, ~933 LOC):**
    - `validator.ts` (680 LOC) — post-parse DAG structural validation, cycle detection, `depends_on` ref checks, `$nodeId.output` ref validation, provider/MCP capability warnings
    - `condition-evaluator.ts` (174 LOC) — evaluate `when:` expressions against accumulated `nodeOutputs`
    - `validation-parser.ts` (64 LOC) — parse `validate:` sub-block from YAML
    - `command-validation.ts` (15 LOC) — `isValidCommandName(s)` regex
  - **Discovery (2 files, ~542 LOC):**
    - `workflow-discovery.ts` (372 LOC) — filesystem scan with precedence bundled < global (`~/.archon/workflows/`) < project (`<repo>/.archon/workflows/`)
    - `script-discovery.ts` (170 LOC) — discover scripts for `script:` nodes (`runtime: bun | uv`)
  - **Utilities (4 files, ~294 LOC):**
    - `utils/idle-timeout.ts` (116 LOC) — `withIdleTimeout()` wraps AsyncGenerator with idle-deadline detection
    - `utils/tool-formatter.ts` (98 LOC) — `formatToolCall()` for display
    - `utils/duration.ts` (47 LOC) — `formatDuration`, `parseDbTimestamp`
    - `utils/variable-substitution.ts` (33 LOC) — **command-arg substitution only** (`$1..$9`, `$ARGUMENTS`, `\$`). NOT workflow vars — those live in `executor-shared.ts:365`.
  - **Defaults (3 files, ~148 LOC):**
    - `defaults/bundled-defaults.ts` (42 LOC) — loader for embedded YAMLs
    - `defaults/bundled-defaults.generated.ts` (78 LOC) — auto-generated TS bundle of 20 default workflow YAMLs as string literals. Port-or-regenerate at our build.
    - `defaults/text-imports.d.ts` (28 LOC) — TS ambient module for text imports
  - **Misc (1 file, ~237 LOC):**
    - `logger.ts` (237 LOC) — `logNodeStart`, `logNodeComplete`, `logTool`, etc. on top of `createLogger`. **Plan previously omitted; widely used.**
  - **Files in old plan that DO NOT EXIST and were dropped:** `script-node-deps.ts`, `load-command-prompt.ts`, `types.ts`, `index.ts` (no barrel — consumers import from sub-paths).
  - **Exclude (test-only):** `test-utils.ts` (33 LOC).

- **Adaptations for Switch UI:**
  - Swap `import from '@archon/paths'` → `import from './archon-stubs'`
  - Swap `import from '@archon/git'` → `import from './archon-stubs'`
  - Swap `import from '@archon/isolation'` → `import from './archon-stubs'` (worktree isolation not needed)
  - Remove Bun-specific imports (use Node.js `child_process`, `fs` equivalents)
  - Keep `@hono/zod-openapi` for schema generation if used by engine internals; strip if only used by Archon's web API

- **A.1.1: Engine Workflow Store (`IWorkflowStore` implementation)**
  - Create `workflow-store.ts` implementing the **17 methods** of `IWorkflowStore` (correction: plan previously said "20+"; actual surface is 17 — verbatim signatures in `docs/plans/archon-engine-research.md` §2). Real method names differ from prior plan: `updateWorkflowRun` (not `updateWorkflowStatus`), `createWorkflowEvent` (not `logWorkflowEvent`).
  - Backed by the **engine's own SQLite DB** at `~/.hermes/switchui-workflows.db` (delta-only — does NOT duplicate fields owned by Hermes Kanban). **Full DDL skeleton in `docs/plans/archon-engine-db-schema.md`** (7 tables, indexes, design notes). Summary:

  | Table | Owns | Notes |
  |---|---|---|
  | `workflow_definitions` | YAML registry rows (`id, name, source, yaml, checksum, version, scope`) | Source-of-truth for parsed defs; supports bundled + user/project scopes |
  | `workflow_runs` | Run lifecycle (`id, workflow_id, conversation_id, status, started_at, completed_at, metadata, working_path, parent_conversation_id, codebase_id, last_heartbeat, current_phase`) | `current_phase` enum: `plan|route|execute|review|report` |
  | `node_runs` | Per-node execution record (`id, workflow_run_id, dag_node_id, provider, provider_config, status, retries, started_at, completed_at, summary, error, kanban_task_id, logs`) | `kanban_task_id` is FK-like pointer to gateway-owned Kanban row (no DB-level FK across DBs) |
  | `workflow_events` | Append-only event log (`id, workflow_run_id, event_type, step_index, step_name, data, created_at`) | Mirrors emitter taxonomy (15 events) + DB-only deltas (`node_skipped_prior_success`, etc.); 19 total types |
  | `phase_transitions` | Per-run phase history (`id, workflow_run_id, from_phase, to_phase, decided_by, decision_data, at`) | Records plan→route→execute boundaries with the routing decision payload |

  - Anything Hermes Kanban already owns (task body, task status, task events, task_links, claim history, comments) is **read via the gateway HTTP API**, not duplicated. The engine's `node_runs.kanban_task_id` is the join.
  - Full method → store mapping:

  | `IWorkflowStore` method | Maps to |
  |---|---|
  | `createWorkflowRun(data)` | Insert `workflow_runs` row + initial `phase_transitions(to_phase='plan')` |
  | `getWorkflowRun(id)` | Read `workflow_runs` |
  | `getActiveWorkflowRunByPath(workingPath, self?)` | **Split-brain prevention.** Query `workflow_runs` WHERE working_path = ? AND status IN ('pending','running','paused') AND id ≠ self.id |
  | `findResumableRun(workflowName, workingPath)` | Query `workflow_runs` WHERE workflow_name = ? AND working_path = ? AND status IN ('failed','paused') ORDER BY started_at DESC LIMIT 1 |
  | `failOrphanedRuns()` | Startup reaper. UPDATE `workflow_runs` SET status='failed' WHERE status IN ('pending','running') AND last_heartbeat < now - threshold. Returns `{count}`. |
  | `resumeWorkflowRun(id)` | UPDATE `workflow_runs.status='running'`; new `phase_transitions` row |
  | `updateWorkflowRun(id, {status?, metadata?})` | Partial UPDATE `workflow_runs` |
  | `updateWorkflowActivity(id)` | UPDATE `workflow_runs.last_heartbeat=now()` every `ACTIVITY_HEARTBEAT_INTERVAL_MS=60_000` |
  | `getWorkflowRunStatus(id)` | Read `workflow_runs.status` |
  | `completeWorkflowRun(id, metadata?)` | `workflow_runs.status='completed'`; append final `workflow_events` |
  | `failWorkflowRun(id, error)` | `workflow_runs.status='failed'`, error stored on `node_runs` |
  | `pauseWorkflowRun(id, approvalContext)` | `workflow_runs.status='paused'`, `approvalContext` in `workflow_runs.metadata.approval` |
  | `cancelWorkflowRun(id)` | `workflow_runs.status='cancelled'`. Engine then issues gateway `DELETE/PATCH` calls to cancel each mapped Kanban task by `node_runs.kanban_task_id`. |
  | `createWorkflowEvent(data)` | INSERT `workflow_events`. **MUST NOT throw** — log internally. |
  | `getCompletedDagNodeOutputs(runId)` | `SELECT dag_node_id, summary FROM node_runs WHERE workflow_run_id=? AND status='completed'` |
  | `getCodebaseEnvVars(codebaseId)` | v1: stub returns `{}`; v1.1: proxy to Hermes settings env block via gateway |
  | `getCodebase(id)` | v1: stub returns synthetic row derived from `working_path`; v1.1: read workspace metadata from gateway |
  - **Resume invariant**: each resume creates a new `workflow_runs` event chain entry (status transitions tracked in `workflow_events`). Already-completed `node_runs` rows are read via `getCompletedDagNodeOutputs` and pre-populated into the executor's `nodeOutputs` map. See A.5.
  - Edge cases: split-brain prevention via `getActiveWorkflowRunByPath` (call BEFORE create); all writes within the engine DB use a single SQLite writer (no cross-DB transactions needed — Kanban changes flow through gateway HTTP); orphan reaper (`failOrphanedRuns`) called on Switch UI server boot.

- **A.1.2: SSE / Event Bridge** — resolve dual event taxonomy

  Research surfaced a critical issue: the engine has **two parallel event taxonomies** that don't match.

  | Source | Count | Where |
  |---|---:|---|
  | `WorkflowEmitterEvent` discriminated union (in-memory) | 15 | `event-emitter.ts` |
  | `WORKFLOW_EVENT_TYPES` (persisted to DB) | 19 | `store.ts` |

  Name mismatches: emitter `tool_started/completed` vs DB `tool_called/completed`; emitter `approval_pending` vs DB `approval_requested` + `approval_received`. DB-only events: `node_skipped_prior_success`, `ralph_story_started`, `ralph_story_completed`. The prior plan's named events (`workflow:started`, etc.) match neither taxonomy verbatim.

  **Decision:** SSE bridge subscribes to the **in-memory emitter** (`WorkflowEventEmitter`) — it is the canonical real-time source and is fire-and-forget (listener errors logged, not thrown). The DB-only events (resume re-skip, ralph story markers, approval lifecycle delta) are surfaced by polling `task_events` via `GET /api/conductor/missions/:id/events?since=cursor` rather than by trying to unify the two taxonomies.

  - Bridge module: `src/server/workflow-engine/sse-bridge.ts` — calls `getWorkflowEventEmitter().subscribeForConversation(conversationId, listener)` per active conversation. Translates `WorkflowEmitterEvent` payloads into the Switch UI SSE event shape consumed by the chat/conductor stores.
  - Verbatim emitter event names that flow through SSE: `workflow_started`, `workflow_completed`, `workflow_failed`, `workflow_cancelled`, `workflow_artifact`, `node_started`, `node_completed`, `node_failed`, `node_skipped`, `loop_iteration_started`, `loop_iteration_completed`, `loop_iteration_failed`, `tool_started`, `tool_completed`, `approval_pending`.
  - Conductor "Now Playing" subscribes per-active-mission; Operations roster subscribes per-agent (filter by `workerId` from event payload metadata).
  - **No event renaming in the bridge.** Switch UI client code uses the emitter names directly to stay aligned with Archon upstream. If we cherry-pick upstream engine fixes, taxonomy stays portable.

**Location:** `hermes-switchui/src/server/workflow-engine/`

### A.2: Kanban Execution Adapter

**Goal:** Bridge engine's `node_runs` (own SQLite) ↔ Hermes Kanban tasks (gateway-owned). When a workflow enters the **execute** phase, each DAG node that needs a Hermes worker materializes as a Kanban task via the gateway HTTP API. The engine watches `task_events` via the gateway event stream and flips its own `node_runs.status` accordingly. **No engine code runs inside the gateway.**

- **A.2.1: Switch UI workflow runner (TanStack Start server module)**
  - Module: `src/server/workflow-engine/runner.ts` — invoked by Conductor API routes when route phase finalizes
  - Input: `workflow_definitions.id` + variable overrides + working_path/conversation_id
  - Process:
    1. Create `workflow_runs` row in engine DB (phase=plan or route depending on entry point)
    2. Load YAML from `workflow_definitions.yaml` via Archon's `loader.ts`
    3. For each DAG node, create a `node_runs` row (status='pending', provider from YAML)
    4. Engine's DAG executor (`dag-executor.ts`) runs in-process; topological layers as Archon does today
    5. For **execute-phase AI nodes (`prompt:` / `command:`)**: `kanban-dispatcher.ts` calls gateway `POST /api/tasks` with an idempotency key (`Idempotency-Key: <node_run.id>`) so retries don't duplicate. Store returned task id in `node_runs.kanban_task_id`. Hermes worker decides which CLI (`claude` / `codex` / other) to drive per skill + model_hint.
    6. For **local-exec nodes (`bash:` / `script:`)**: engine runs them in-process via `child_process.execFile` (bash) or `Bun`/`uv` runtime (script). No Kanban task. Output goes directly to `node_runs.summary`.
    7. Event consumer (A.2.3) listens to gateway `GET /api/task_events?since=<cursor>` (long-poll or SSE) and reconciles `node_runs.status` with Kanban `tasks.status`.
    8. Loop nodes: re-create child `node_runs` per iteration until `max_iterations` or completion signal; loop iteration index in `node_runs.metadata.loopIteration`.
    9. Approval nodes: `node_runs.status='paused'`, `workflow_runs.status='paused'`, emit `approval_pending` event. Conductor unblocks via `POST /api/conductor/missions/:id/approve` (Switch UI route, not gateway).
    10. Cancel: engine flips `workflow_runs.status='cancelled'`, walks all `node_runs.kanban_task_id`, issues gateway cancel calls per task.

- **A.2.2: Execute-phase node → Kanban task mapping** (single dispatch channel — `kanban-dispatcher.ts`)

| Archon Node Type | Kanban Mapping (all execute-phase AI nodes route here) |
|---|---|
| `prompt:` | Task with `skills: ['archon-prompt-worker']`, content in `body` |
| `bash:` | Task with `skills: ['archon-bash-worker']`, script in `body` |
| `script:` | Task with `skills: ['archon-script-worker']`, code + runtime in `body` |
| `loop:` | Parent task with children per iteration, re-created until done; uses `completion_check`, `max_iterations`, `user_input_prompt` from Archon schema |
| `approval:` | Task set to `status: 'blocked'`, unblocked via `POST /api/conductor/missions/:id/approve` |
| `command:` | Task that loads a command file from `.archon/commands/` via `loadCommandPrompt()` in `executor-shared.ts:199` |
| `cancel:` | Terminate parent workflow run with reason string. Emits `workflow_cancelled` event + cascades `tasks.status='cancelled'` to children via `task_links`. **Used by routing logic in several bundled workflows (e.g. `archon-create-issue` when reproduction fails). Previously missing from plan.** |

- **A.2.3: Event consumer + DAG advancement (crash-safe)**
  - Long-polling/SSE subscriber to gateway `GET /api/task_events?since=<cursor>` (event kinds: `completed`, `failed`, `blocked`, `claimed`, `comment_added`). Runs as a long-lived async loop inside the TanStack Start server process — not a separate service.
  - **Cursor persistence:** the consumer's last-processed event ID is written to `switchui-workflows.db` (table: `gateway_event_cursor`, `consumer_id='workflow-engine.task-events'`) after every successful batch. On server restart, the consumer replays from the stored cursor.
  - **Cold start (cursor missing):** consumer does NOT start from `now` (would silently lose events). Instead: (a) reconciliation sweep first — query every open `node_runs.kanban_task_id` via gateway `GET /api/tasks/:id`, back-fill terminal status into `node_runs`; (b) THEN initialize cursor to the latest gateway event id and begin streaming. Operator log line emitted for the gap.
  - **Batch processing:** events are consumed in ordered batches (not one-by-one). Each batch is processed as a transaction against `node_runs` — all status flips for that batch commit together. If the batch processing crashes mid-way, the cursor hasn't advanced, so the next restart replays the same batch. At-most-once semantics for status transitions; idempotent by design (flipping an already-completed `node_run` to `completed` is a no-op).
  - **Recovery on server restart:**
    1. Acquire single-instance startup lock (file lock on `~/.hermes/switchui-workflows.db.lock` — see A.11). Refuse to start if held.
    2. Orphan reaper runs: `failOrphanedRuns()` marks stale `running` rows as `failed` (heartbeat threshold exceeded).
    3. Reconciliation sweep: for every `node_runs` row with `status IN ('dispatched','running')` and a `kanban_task_id`, poll gateway for current task state and back-fill. Closes any gap accumulated during downtime.
    4. Event consumer starts, reads cursor from `gateway_event_cursor`, begins polling.
    5. For each `workflow_runs` row still in status `running`, the engine re-enters the DAG executor at the layer containing the first non-completed `node_run`.
    6. Approval-gated runs (status `paused`) stay paused — they require explicit user action to resume.
  - **Heartbeat:** the engine writes `workflow_runs.last_heartbeat = now()` every 60 seconds while active. The orphan reaper uses this to detect crashes: if `last_heartbeat` is older than 5 minutes and the server process is not running, the run is flagged as `failed`.
  - **In-flight Kanban tasks after crash:** if the server crashes while Kanban tasks are mid-execution, those tasks continue running inside Hermes gateway (they're independent processes). When the consumer restarts and replays events, it will see their `completed`/`failed` events and reconcile the corresponding `node_runs`. No lost work.
  - On Kanban `completed` event: look up `node_runs WHERE kanban_task_id=?`, flip `node_runs.status='completed'`, store result in `node_runs.summary` from event payload. The Archon dag-executor (in-process) sees the `node_runs` update and advances the DAG to the next topological layer.
  - On Kanban `failed` event: `node_runs.status='failed'`, apply retry policy from YAML `retry:` block, otherwise propagate failure upward.
  - On Kanban `blocked` event (manual hold from Hermes side): `node_runs.status='paused'`, surface to Conductor UI for resolution.
  - The engine's DAG state (the source of truth for "is this node ready") lives in `node_runs`. Hermes Kanban `tasks.status` is the **execution mirror** of `node_runs`, not the dependency graph. `task_links` are populated for human/Operations visibility only.
  - Edge cases: cycle detection (engine `validator.ts` at YAML parse time, before any Kanban write); failure propagation through `node_runs.depends_on`; cancel cascade walks `node_runs.kanban_task_id` and issues per-task gateway cancels.

- **A.2.4: Variable substitution** — three distinct layers (research correction)

  **Layer 1 — Command-arg substitution** (`utils/variable-substitution.ts:14`):
  - `$1`..`$9` → positional args
  - `$ARGUMENTS` → all args joined by space
  - `\$` → literal `$` (only layer that supports escape)
  - Used by `loadCommandPrompt()` when expanding `.archon/commands/` markdown files.

  **Layer 2 — Workflow-variable substitution** (`executor-shared.ts:365`, `substituteWorkflowVariables`):

  | Variable | Source |
  |---|---|
  | `$WORKFLOW_ID` | Run id |
  | `$USER_MESSAGE` | User trigger message |
  | `$ARGUMENTS` | Alias for `$USER_MESSAGE` |
  | `$ARTIFACTS_DIR` | External artifacts dir for this run |
  | `$BASE_BRANCH` | Resolved base branch (throws if referenced and unresolved) |
  | `$DOCS_DIR` | From config or `'docs/'` default |
  | `$CONTEXT` / `$EXTERNAL_CONTEXT` / `$ISSUE_CONTEXT` | GitHub issue/PR context; `''` when none |
  | `$LOOP_USER_INPUT` | Interactive-loop approval payload (first iteration of resumed loop only) |
  | `$REJECTION_REASON` | Reviewer feedback on `on_reject` prompts |
  | `$LOOP_PREV_OUTPUT` | Cleaned prior-iteration output (empty on first iteration) |

  Returns `{ prompt, contextSubstituted }` so `buildPromptWithContext()` can decide whether to append context separately (no duplication). **No escape support at this layer** — literal `$VARNAME` is regex-replaced.

  **Layer 3 — `$nodeId.output` references** (`dag-executor.ts:286`, `substituteNodeOutputRefs`):
  - Reads from accumulated `nodeOutputs: Map<string, NodeOutput>` populated as upstream nodes complete in the run
  - Validator pre-checks references at parse time
  - Maps to engine DB: `nodeOutputs.get(nodeId)` ← `node_runs.summary` for the corresponding `dag_node_id` within the same `workflow_run_id`

**Engine DB vs Kanban DB:** The Switch UI workflow engine owns `~/.hermes/switchui-workflows.db` (`workflow_definitions`, `workflow_runs`, `node_runs`, `workflow_events`, `phase_transitions`). Hermes Kanban (`~/.hermes/kanban.db`, owned by the gateway) owns `tasks`, `task_events`, `task_links`, `task_runs`, `task_comments`. The engine never opens the Kanban DB directly — it talks to the gateway over HTTP. `node_runs.kanban_task_id` is the join column.

### A.3: Kanban Dispatcher (replaces provider port)

**Decision:** **NOT porting `ClaudeProvider` or `CodexProvider`.** Hermes Agent already has access to `claude` CLI + `codex` CLI + other coding tools and drives them as part of its worker runtime. Porting Archon's providers would create a parallel mechanism (engine spawns CLI vs Hermes spawns CLI) with no product value — flagship workflow analysis showed 95% generic agentic coding, 5% CC-flavored (just `provider: claude` selector + model strings). Zero use of Claude-Code-specific advanced features (sub-agents, MCP, hooks, WebFetch) in the YAMLs themselves.

**Stripped from prior plan:**
- 14 provider files / ~2,694 LOC port
- Pi provider import cleanup
- `registerBuiltinProviders()` bootstrap
- Binary resolution + env-var configuration (`CLAUDE_BIN_PATH`, `CODEX_BIN_PATH`)
- `hermes-workflow-config.ts` for provider config

**What replaces it: `kanban-dispatcher.ts`** in `src/server/workflow-engine/`. Tiny module (target: ~200 LOC). Responsibilities:

- Implements the `IAgentProvider`-shaped surface that engine code (`executor.ts`, `dag-executor.ts`) expects — same async generator signature, same `MessageChunk` output shape — so engine imports flip from `@archon/providers` to `./kanban-dispatcher` with minimal code churn
- For each `sendQuery()` call (`sendQuery` is the dispatcher's own method implementing the `IAgentProvider` surface — NOT a ported Archon provider call):
  1. Create Kanban task via gateway `POST /api/tasks` with `Idempotency-Key: <node_run.id>` header + `skills: [...]` + body containing resolved prompt + structured options (model hint, allowed_tools, output_format, sandbox config). Idempotency key prevents duplicate task creation on retry/restart.
  2. Store `kanban_task_id` in `node_runs.kanban_task_id`
  3. Subscribe to gateway `task_events` filtered by that task id; long-poll or SSE
  4. Translate Hermes task event payloads into `MessageChunk` shape (text chunks → `assistant_text`; tool invocations → `tool_use` / `tool_result`; final completion → terminal `result`)
  5. Yield `MessageChunk` async iterator to caller (the engine's `executor.ts`)
- Maps Archon's `NodeConfig` to Hermes task fields: `model` → task hint, `allowed_tools` / `denied_tools` → task constraints, `effort` / `thinking` → task hint, `systemPrompt` → prepended to body, `mcp` → task MCP config (if Hermes worker supports MCP), `sandbox` → task sandbox spec
- Capability descriptor: returns a static `ProviderCapabilities` describing what Hermes workers support (broadly the union of claude-code + codex capabilities since Hermes can drive either). The single registered "provider" is effectively `hermes`; YAML `provider: claude` and `provider: codex` route to the same dispatcher with the model hint forwarded to the Hermes worker.

**Engine import-site rewrites (this IS the real port cost of stripping):**
- `dag-executor.ts`, `executor.ts`, `loader.ts`, `validator.ts` import `IAgentProvider`, `MessageChunk`, registry helpers from `@archon/providers` and `@archon/providers/types`. Rewrite these to import from `./kanban-dispatcher` (impl) + a tiny local `./agent-provider-types.ts` (the type-only shim mentioned in A.0).
- `validator.ts` calls `getProviderCapabilities()` for MCP/tool validation warnings — point at the dispatcher's static capabilities table.
- `deps.ts` `AgentProviderFactory` type stays identical; `getAgentProvider(name)` returns the single Kanban dispatcher regardless of `name`.

**What we gain by stripping:**
- ~2,700 LOC not ported, not maintained, not tested
- No parallel CLI-spawning mechanism — one path, one execution channel
- Tier 1/2 agents (Switch, Neo, Trinity, Morpheus) own all execute-phase work → real team capacity tracking, real Operations rollup
- No binary resolution / auth-mode / vendor-SDK upgrade churn
- Upstream Archon provider changes don't require backporting

**Caveats locked in by user confirmation:**
- Hermes Agent confirmed has access to `claude` CLI + coding tools — execute-phase coding nodes will route through Hermes workers
- The 5-agent PR review fan-out becomes 5 parallel Kanban tasks; Hermes worker capacity must handle the concurrency (or A.7 v1 subset accepts serial review)
### A.4: Cron / Event Trigger Integration

**Goal:** Hermes Agent cron jobs and Kanban events can trigger Archon workflows. Trigger arrives in Switch UI server via existing gateway event stream (SSE / WS); Switch UI server invokes the local engine. Gateway never calls the engine directly — Switch UI is the only client.

- Cron job UI (gateway-side) extended to support picking a workflow YAML as the action
- Trigger path: gateway fires cron → emits cron event on existing gateway event stream → Switch UI server subscriber receives event → calls Kanban-dispatched workflow runner (A.2.1) locally → engine executes
- Additional trigger sources Switch UI server subscribes to: task lifecycle events (`task_events` kind=`created|completed|failed`), task start-time triggers, Kanban label/skill triggers
- Cron output = workflow run summary (from `task_runs.summary`), surfaced back through gateway
- Workflow YAMLs can have optional `schedule:` field (cron expression) — Conductor registers these with Hermes Agent cron on load via gateway API
- **If Switch UI server is down when a trigger fires:** event is durable in the gateway event log; Switch UI replays from last-seen cursor on reconnect. No silent loss.

### A.5: Resume Semantics

**Goal:** Surface engine's rich resume capability (`resumeWorkflowRun`, `findResumableRun`, `getCompletedDagNodeOutputs`, `RESUMABLE_WORKFLOW_STATUSES = ['failed', 'paused']`) as a first-class workflow lifecycle feature. Engine already supports this; the integration must wire UI + Kanban.

- **Resume entry points:**
  1. **User-initiated resume** — Conductor "Resume" button on a `failed` or `paused` mission card → `POST /api/conductor/missions/:id/resume` → `deps.store.resumeWorkflowRun(id)` → engine reloads workflow, populates `nodeOutputs` from `getCompletedDagNodeOutputs(runId)`, re-runs from the layer containing the first non-completed node.
  2. **Approval resume** — User approves a `paused` approval node via `POST /api/conductor/missions/:id/approve` → store transitions `paused → running` with approval payload, engine continues.
  3. **Orphan resume on boot** — Switch UI server startup calls `failOrphanedRuns()` (marks stale `running` rows as `failed`) then optionally auto-resumes `paused` runs that user explicitly subscribed for auto-resume (off by default).

- **Resume source of truth — engine-owned `node_runs` ONLY.** No cross-DB query into gateway `task_runs`. Reasoning: engine DB owns the DAG state; Kanban `task_runs` are an execution mirror. Querying Kanban for resume state introduces split-brain.
  - `getCompletedDagNodeOutputs(runId)` implementation: `SELECT dag_node_id, summary FROM node_runs WHERE workflow_run_id=? AND status='completed' AND loop_iteration IS NULL`. For loop nodes, custom reconstruction (see Loop note below).
  - Resume creates no new row in `workflow_runs` — same row, status flips `failed|paused → running`, and a new `phase_transitions` audit entry is appended. The DAG executor re-enters at the first non-completed layer, pre-populating `nodeOutputs` from `getCompletedDagNodeOutputs`.
  - Already-done child node_runs emit `node_skipped_prior_success` via the in-memory emitter on resume; UI shows them visually distinct from freshly-completed nodes.

- **Edge cases:**
  - Workflow YAML changed between original run and resume → engine re-parses (using stored `workflow_definitions.yaml` snapshot from the original dispatch, NOT the current registry row) → if any completed node id no longer exists in the new YAML, fail-fast and require user to start a new run. **Stores YAML snapshot in `workflow_runs.metadata.yaml_snapshot` at dispatch time.**
  - **Loop nodes mid-iteration — design hypothesis, requires test gate before v1 release.** Upstream `dag-executor.ts:1831` threads loop state through the executor's mutable run object plus approval-context metadata (`workflow-run.ts:110`), not a simple iteration counter. v1 approach: persist `iteration`, `sessionId`, and `fresh_context_flag` into `node_runs.metadata` for loop-wrapper nodes; on resume, replay loop entry at the recorded iteration with the recorded sessionId. **Validate via dedicated pause/resume mid-loop test on `archon-piv-loop` before any multi-iteration workflow ships.** If validation fails, fall back to "restart loop from iteration 0" with documented caveat.
  - Cancelled runs are NOT resumable (`RESUMABLE_WORKFLOW_STATUSES` excludes `cancelled`).

### A.6: Workflow YAML — Schema Correction & Porting Surface

**Schema correction (was wrong in prior plan):** Workflow YAML nodes do **NOT** carry a `type:` field. Node type is inferred from which payload key is present per node:

```yaml
nodes:
  - id: pick-plan
    command: archon-create-plan       # → command node
  - id: classify
    prompt: "Is this a bug or feature?"  # → prompt node
  - id: run-tests
    bash: "pnpm test"                 # → bash node
  - id: count
    script: "..."                     # → script node
    runtime: bun
  - id: refine
    loop: { prompt: "...", until: "...", max_iterations: 5 }
  - id: gate
    approval: { message: "Approve?" }
  - id: bail
    cancel: "Reproduction failed"
```

Mutual exclusivity enforced by `dagNodeSchema.superRefine` at `schemas/dag-node.ts:418`. Exactly one of `command | prompt | bash | script | loop | approval | cancel` per node.

**Porting surface inventory:**
- **20 workflow YAMLs** in `/Volumes/Ext-nvme/Development/archon/.archon/workflows/defaults/`
- **~30–50 markdown command files** in `/Volumes/Ext-nvme/Development/archon/.archon/commands/defaults/` — the `command:` nodes are thin pointers that delegate heavy lifting (prompts, bash, fan-outs) to these markdowns
- True porting surface = YAMLs + their referenced command markdowns. A workflow with 9 command nodes typically pulls in 9–15 command markdowns (some shared).

### A.7: v1 Workflow Subset & Reusable Subgraphs

Research catalogued all 20 workflows. Risk distribution: 9 High, 6 Med, 3 Low (full table in `docs/plans/archon-workflows-research.md`). Not every workflow ships in v1.

**v1 port subset (8 workflows, count verified):**
1. `archon-resolve-conflicts` (Low — 1 node, git mechanics)
2. `archon-feature-development` (Med — 3 nodes, wraps implement-tasks + finalize-pr)
3. `archon-smart-pr-review` (Med — 5-agent fan-out + classifier router)
4. `archon-fix-github-issue` (High but core — 22 nodes, depth 17; largest workflow)
5. `archon-plan-to-pr` (High — existing-plan → PR pipeline)
6. `archon-idea-to-pr` (High — idea → autonomous plan → PR; flagship demo)
7. `archon-interactive-prd` (Med — 3 approval gates; validates approval-flow UI)
8. `archon-piv-loop` (High — plan-implement-validate with loop + user_input_prompt; validates loop UI)

**Drop / defer rationale:**
- `archon-test-loop-dag`, `archon-assist`, `archon-workflow-builder` → drop / convert to engine self-test
- `archon-comprehensive-pr-review` → redundant with smart (smart = comprehensive with classifier). Ship only smart; "comprehensive" becomes `smart --force-all`.
- `archon-issue-review-full` → redundant with `fix-github-issue` + `smart-pr-review` chain
- `archon-validate-pr` → defer (needs sandboxed worktree/devserver runner)
- `archon-create-issue` → defer (agent-browser + area-specific repro tooling)
- `archon-architect`, `archon-refactor-safely` → defer (engine must support PreToolUse + PostToolUse hooks with self-review loops first)
- `archon-adversarial-dev` → defer (state-machine loop with score-threshold branching)
- `archon-ralph-dag` → defer (branching input detection + story-driven scheduling)
- `archon-remotion-generate` → drop (outside Switch UI scope; Remotion + ffmpeg deps)

**Workflow consolidation opportunities (post-v1):**
- Collapse `idea-to-pr` + `plan-to-pr` + `feature-development` into one workflow with `--skip-plan` / `--skip-review` flags
- Collapse `comprehensive-pr-review` + `smart-pr-review` (smart with `--force-all` = comprehensive)
- Collapse `fix-github-issue` + `issue-review-full` (single workflow with `--full-review` flag)
- Treat `piv-loop` as the canonical HITL-loop foundation; configure `interactive-prd` / `ralph-dag` as variants

**Reusable subgraph: the 5-agent PR review fan-out** — used by **6 workflows** (idea-to-pr, plan-to-pr, fix-github-issue, comprehensive-pr-review, smart-pr-review, issue-review-full). All call the same 5 review agents (`archon-code-review-agent`, `archon-comment-quality-agent`, `archon-test-coverage-agent`, `archon-docs-impact-agent`, `archon-error-handling-agent`) + synthesizer (`archon-pr-review-scope` + `archon-auto-fix-review`). **This is the single biggest reusable subgraph in the entire library.** Port the 5 review-agent command markdowns + the synthesizer once; every PR-review workflow rides on top.

**Other shared building blocks:**
1. **Plan-then-PR tail**: `archon-implement-tasks` → `archon-validate` → `archon-finalize-pr` (idea-to-pr, plan-to-pr, feature-development)
2. **PR-base setup**: `archon-verify-pr-base`, `archon-pr-review-scope` (all PR-review flows)
3. **Plan-setup + confirm-plan**: idea-to-pr, plan-to-pr
4. **PRD generation chain**: interactive-prd, ralph-dag, idea-to-pr (when seeded with idea)

### A.8: 5-Phase Orchestration Wrapper (plan → route → execute → review → report)

**Mandatory phases for v1: `plan`, `route`, `execute`.** Phases `review` and `report` are **OPTIONAL workflow capabilities** declared per workflow in YAML (`phases: [plan, route, execute]` or `phases: [plan, route, execute, review, report]`). Default = no review/report. Reasoning: review/report add state-machine surface that not every workflow needs (e.g., `archon-resolve-conflicts` is a one-shot, no review meaningful). Mandating them is over-engineering for v1.

When omitted, the run transitions directly `execute → completed` and emits a final summary event without entering the optional phases.

Phase state lives in engine DB column `workflow_runs.current_phase` and is recorded in `phase_transitions` table for audit.

| Phase | What runs | Who decides | UI surface | Engine state |
|---|---|---|---|---|
| **plan** | Conversational chat between user and Hermes — open-ended, iterative, backtracking. Hermes proposes a candidate workflow from the 20 ported YAMLs based on the conversation. | User + Hermes (via existing chat) | Conductor "Plan" panel — chat thread with workflow recommendation surfaced as a card the user accepts/rejects/edits | `workflow_runs.status='pending'`, `current_phase='plan'`. No DAG nodes created yet. |
| **route** | Engine translates the agreed plan into a concrete workflow instantiation: chooses YAML, fills variables (`$USER_MESSAGE`, `$BASE_BRANCH`, etc.), validates the DAG, splits execute-phase nodes that need Hermes workers into Kanban task templates, and decides the agent profile per node. | Engine + Hermes router (`router.ts`) | Conductor "Route" panel — shows chosen workflow YAML, resolved variables, planned task graph (before execution starts) | Insert `node_runs` rows with `status='pending'`. No Kanban tasks created yet. |
| **execute** | Archon DAG executor runs in-process. All AI nodes (`prompt:` / `command:`) dispatched via `kanban-dispatcher.ts` → gateway `POST /api/tasks`. Bash / script nodes execute locally in engine process. Event consumer reconciles `node_runs.status` with Kanban events. Loop / approval nodes pause and resume here. | Engine + Hermes workers | Conductor "Execute" panel — runtime DAG with per-node status, retries, blocking reasons | `workflow_runs.status='running'`, `current_phase='execute'`. Most `node_runs` activity. |
| **review** | Server-side AI evaluation of outputs from the execute phase. For coding workflows this is the 5-agent PR review fan-out (or smart-router variant) — runs as an inner DAG. For other workflows, a single review prompt against the final artifact. May loop back to execute if review fails. | Engine + review providers | Conductor "Review" panel — review verdicts, scope-aware findings, auto-fix queue | `current_phase='review'`. New `node_runs` for review nodes; same `workflow_run_id`. |
| **report** | Generate user-facing summary, surface artifacts, post to Kanban as a final comment, optionally fire notifications. Terminal phase. | Engine | Conductor "Report" panel — final summary, artifacts list, links to PR/issue/output | `workflow_runs.status='completed'`, `current_phase='report'`. |

**Plan-phase is NOT a DAG.** It is a free-form chat — variable length, backtracking, user-driven termination. It must NOT be modeled as Archon workflow nodes. The plan-phase output is a structured `RouteDecision` object (workflow_id + variable bindings + scope hints) that becomes the input to the route phase.

**Route-phase IS where the DAG comes into existence.** **Write permissions on `node_runs`:** route phase is the primary creator (initial DAG materialization). Review phase MAY append additional `node_runs` rows for review-specific nodes if the workflow declares them. Loop expansion creates per-iteration child rows during execute. Resume does NOT create new rows — it updates existing ones. All other phases are read-only on `node_runs`.

**Phase boundaries are checkpoints.** Phase transitions emit `phase_transition` events and are visible in the Conductor mission timeline. Cancel from any phase walks back to gateway and cancels any outstanding Kanban tasks for `current_phase='execute'|'review'`.

### A.9: Adjust 8 Archon YAMLs (v1 subset) for Hermes Trigger Integration

**Scope reduction:** v1 edits only the 8-workflow A.7 subset. The remaining 12 YAMLs are deferred to v1.1. The bundled Archon workflows assume direct provider invocation everywhere; in Switch UI all execute-phase AI work routes through `kanban-dispatcher.ts`.

**Per-workflow editing pass (~50 node edits across v1 subset, not 100):**

1. **All `prompt:` / `command:` nodes route to Hermes Kanban** (single execution channel since A.3 strip). Drop `provider: claude` and `provider: codex` annotations from YAMLs. Replace with `hermes_task:` blocks specifying which skill set should handle the node. Bash / script nodes execute locally in the engine process (no Kanban task) unless explicitly marked `hermes_task:`.

2. **For each AI node, add a `hermes_task:` block** in YAML:
   ```yaml
   - id: implement-tasks
     command: archon-implement-tasks
     hermes_task:
       skills: [coding]                   # routes to coding-skilled Hermes worker
       agent_hint: neo                    # optional: prefer T2 Technical agent
       model_hint: claude-sonnet-4-6      # hint forwarded to Hermes; Hermes picks CLI
       allowed_tools: [Read, Edit, Bash, Grep]
       priority: normal
       timeout_minutes: 60
       artifacts_dir: $ARTIFACTS_DIR/implement-tasks
   ```
   The `hermes_task` block is a Switch UI extension to Archon's schema — A.6's Zod schema additions live here. The Hermes worker reads `model_hint` and decides whether to drive `claude` CLI, `codex` CLI, or another coding tool it has plugged in. Engine doesn't care which CLI runs.

3. **Map `$nodeId.output` references**: output flows via `node_runs.summary`, populated by the event consumer from `task_events` completion payload. The Layer 3 substitution mechanism (A.2.4) is unchanged.

4. **Approval nodes** route through Conductor only (`approval_target: conductor`). `kanban_comment` alternative deferred to v1.1.

5. **Bundled-default regeneration**: after editing the YAMLs, regenerate `defaults/bundled-defaults.generated.ts` so the new annotations ship in the engine bundle.

**Scope of editing for v1 subset (8 workflows):** All AI nodes get `hermes_task:` blocks with `skills` + optional `agent_hint` + `model_hint`. No more provider switching in YAML.

- `archon-resolve-conflicts` (1 node) — `skills: [coding,git]`
- `archon-feature-development` (3 nodes) — `implement-tasks` + `finalize-pr` both `skills: [coding]`
- `archon-smart-pr-review` (12 nodes) — classifier `skills: [classification]`, 5 review agents `skills: [code-review]` parallel, auto-fix `skills: [coding]`, synthesizer `skills: [synthesis]`
- `archon-fix-github-issue` (22 nodes) — investigation `skills: [research]`, implementation `skills: [coding]`, PR draft `skills: [coding,git]`
- `archon-plan-to-pr` + `archon-idea-to-pr` — plan `skills: [planning]`, implementation `skills: [coding]`, review `skills: [code-review]`, PR `skills: [coding,git]`
- `archon-interactive-prd` (8 nodes) — all `skills: [planning,writing]` with 3 approval gates → Conductor
- `archon-piv-loop` (9 nodes) — loop body alternates: human-checkpoint `skills: [planning]` + implementation `skills: [coding]`

This editing pass is A.9. It is the largest **content** workstream after engine port. Track per-workflow PRs to keep diffs reviewable.

### A.10: Workflow Launch Surfaces + Hermes Awareness

Engine exposes a single internal entry point `engine.launchRun(workflowId, vars, ctx)` reached from three v1 trigger paths. All paths converge on the same code.

**v1 trigger paths:**

| # | Trigger source | Path | Coupling | Use case |
|---|---|---|---|---|
| 1 | **User in Conductor UI** | Click "Launch" → Switch UI route `POST /api/workflow-runs` → `engine.launchRun()` | direct in-process | Interactive launches (most common) |
| 2 | **Cron in Hermes Agent** | Gateway cron fires → emits cron event on existing event stream → Switch UI event consumer → `engine.launchRun()` | loose, event-driven | Scheduled workflows |
| 3 | **Hermes-initiated** (chat / skill / external integration) | Hermes posts Kanban task with `skill: launch-workflow`, body `{workflow_id, variables, working_path}` → Switch UI event consumer picks it up → `engine.launchRun()` → marks trigger task completed with the new `workflow_run_id` in its result | loose, event-driven | Hermes agent recommends + launches workflow during chat; external webhooks via Hermes |

**v1.1 backlog (deferred — new YAML schema, design spike required first):**

- **`subworkflow:` node type** — one workflow composing others. NOT in upstream Archon schema. Requires schema versioning + recursion-depth limit + cycle detection. Punt until v1.1.
- **`schedule:` top-level YAML field** — workflow self-registers a timer on load. Creates two parallel schedulers (Hermes cron + engine timer). Punt to v1.1 unless a concrete use case appears; for v1, scheduling lives only in Hermes cron (path #2).

**Canonical Hermes trigger convention (path #3):**

- Kanban task `skill: launch-workflow` is the contract. Body is a JSON document:
  ```json
  {
    "workflow_id": "archon-fix-github-issue",
    "variables": { "USER_MESSAGE": "...", "ISSUE_NUM": "42" },
    "working_path": "/Volumes/Ext-nvme/Development/hermes-switchui-a",
    "conversation_id": "<optional, links new workflow run back to a chat>",
    "parent_run_id": "<optional, for parent-child run hierarchy>"
  }
  ```
- Switch UI event consumer treats `launch-workflow` as a "self-claimed" skill — it's not picked up by a Hermes worker; the engine itself is the executor. On successful launch the trigger task is completed with `result: { workflow_run_id: "..." }`. On failure the task is marked failed with the error message.
- This requires **no new Hermes skill registration** — Switch UI just owns the convention. Hermes agents can be taught about it in their system prompts.

**Hermes awareness (so agents know what workflows exist during plan-phase chat):**

Engine writes a **manifest file** on every Switch UI server boot + on workflow_definition change:

- Path: `~/.hermes/switchui-workflows.json`
- Content: JSON array, one entry per workflow definition currently registered (bundled + user + project-scoped):
  ```json
  [
    {
      "id": "archon-fix-github-issue",
      "name": "Fix GitHub Issue",
      "description": "Classify, investigate, fix, PR, review pipeline for a GitHub issue.",
      "when_to_use": "When the user references a GitHub issue number and wants it fixed end-to-end.",
      "required_inputs": ["ISSUE_NUM"],
      "optional_inputs": ["BASE_BRANCH"],
      "tags": ["github", "coding", "pipeline"],
      "scope": "bundled",
      "phases_used": ["plan", "route", "execute", "review", "report"],
      "checksum": "sha256:..."
    }
  ]
  ```
- Hermes agents (especially T1 Switch in plan phase) read this file on boot + watch for change events. The `when_to_use` field is what agents use to decide which workflow to suggest during conversational planning.
- **v1 scope:** `when_to_use:` added to the 8 v1-subset YAMLs only (`x-hermes.when_to_use:` namespaced under an `x-hermes:` extension key — see A.6 schema-versioning note). Remaining 12 workflows omit the field in v1; manifest entry falls back to YAML description. Full 20-YAML pass deferred to v1.1.
- **Schema versioning:** all Switch-UI extension fields (`hermes_task:`, `approval_target:`, `when_to_use:`) live under a single `x-hermes:` top-level key in YAML, with `x-hermes.schema_version: 1`. Engine validates against a Zod extension schema on load. Forward-compatible: future fields added under `x-hermes` without touching upstream Archon schema.

**Plan-phase to launch handoff:**

1. User chats with Hermes T1 Switch agent about a goal
2. T1 reads `~/.hermes/switchui-workflows.json`, proposes one or more workflow ids that match the conversation
3. User agrees on workflow + variable values (still in chat)
4. T1 posts Kanban task `skill: launch-workflow` with the agreed `workflow_id` + `variables` + the current `conversation_id`
5. Switch UI event consumer picks it up, calls `engine.launchRun()`, creates `workflow_runs` row tied to the same conversation
6. T1 receives the trigger task's completion with the new `workflow_run_id`, surfaces "Workflow X is now running, view in Conductor" in chat
7. Subsequent updates flow via the conversation's existing chat event stream + the Conductor UI's own SSE subscription

**Schema impact:** none beyond what's already in `workflow_runs`. `conversation_id` already exists; `parent_conversation_id` already exists for nested handoffs.

### A.11: Reliability Contract (Codex blocker fix)

Locked invariants the engine MUST guarantee. Implementation cannot start until these are written down, agreed, and have corresponding tests.

**1. Dispatch idempotency.**
- Every gateway `POST /api/tasks` carries `Idempotency-Key: <node_run.id>`. Gateway must dedupe by this key.
- Engine never creates duplicate Kanban tasks for the same `node_run`, even across crashes mid-dispatch.
- Dispatch state machine per node_run: `pending → dispatched → reconciled (terminal)`. Transition `pending → dispatched` writes `kanban_task_id` + flips `dispatched_at` atomically. Crash between API call and DB write is recovered by reconciliation sweep using the idempotency key (gateway returns the existing task id).

**2. Event consumer cold-start.**
- Consumer NEVER starts from `now` on missing cursor — that silently loses events accumulated during downtime.
- Cold start runs the reconciliation sweep first: query gateway for current state of every `node_runs` with `status IN ('dispatched','running')` and a `kanban_task_id`; back-fill terminal status; THEN initialize cursor to latest gateway event id and begin streaming. See A.2.3.

**3. Single-instance deployment lock.**
- The DB is single-writer by design. Engine startup acquires a file lock at `~/.hermes/switchui-workflows.db.lock` (e.g., `proper-lockfile` package or `fs.openSync` with `O_EXLOCK`). Lock includes PID + boot timestamp.
- If lock is held by a live PID, refuse to start with operator-visible error. If lock is stale (PID dead), reclaim with a log entry.
- Document as hard operational constraint: no horizontal scaling of the TanStack Start workflow-engine process. UI server itself can scale if engine module is isolated to a designated leader process (future work).

**4. Status transition atomicity.**
- Every `node_runs` status update is a single SQLite transaction. Multi-row updates (e.g., layer completion + downstream readiness flips) use one transaction.
- `workflow_events` rows are inserted in the SAME transaction as the status update they describe — never persist event then crash before status, or vice versa.

**5. Reconciliation sweep frequency.**
- On cold start (always).
- On heartbeat-missed orphan detection (per-run, when a heartbeat is overdue).
- On user request via admin endpoint `POST /api/admin/reconcile?run_id=...`.
- NOT on every event batch — too noisy.

**6. Test gates (must pass before v1 release):**

| Test | What it proves |
|---|---|
| Restart mid-dispatch | Engine survives kill -9 between `POST /api/tasks` ack and `kanban_task_id` write; reconciliation discovers the orphaned dispatch via idempotency key, back-fills `node_runs.kanban_task_id`, resumes correctly. |
| Duplicate gateway event | Receiving `completed` twice for the same `kanban_task_id` is idempotent — second arrival is a no-op. |
| Partial fan-out failure | 2 of 5 review agents fail; engine applies retry policy to failures, downstream synthesizer waits for completion. |
| YAML changed during pause | Run paused at approval node; user edits the workflow YAML; resume detects schema delta vs `workflow_runs.metadata.yaml_snapshot` and fails fast with explicit error. |
| Paused-approval expiry | Approval node with `timeout` expires without human response; run transitions to `failed` with `error='approval_expired'`. |
| Pause/resume mid-loop | Loop at iteration 3 of 5 pauses on inner approval; resume continues iteration 3 (not restart from 0). This is the test that validates the A.5 loop-resume hypothesis. |
| Cold-start with missed events | Engine offline 10 minutes; tasks complete during downtime; on restart, reconciliation sweep back-fills before stream starts; no event lost. |
| Single-instance lock | Second Switch UI process fails to start while first is running; first dies, second starts cleanly with reclaim log line. |

**Detailed test plan lives in a companion document:** `docs/plans/archon-engine-test-plan.md` (to be drafted in parallel with A.0–A.3 implementation).

**7. Ops surfaces (minimum for v1):**

- `GET /api/admin/health` — returns event consumer lag, orphan count, lock-holder PID, last-reconciled-at, schema_version
- `POST /api/admin/reconcile?run_id=...` — force reconciliation of a single run
- `POST /api/admin/cursor/reset?to=<event_id>` — manually reset event cursor (operator escape hatch)
- Structured logs: every state transition + every gateway call + every reconciliation pass logged with `workflow_run_id`, `node_run_id` correlation IDs

**Out of scope for v1:** distributed tracing, metric export to external systems, automated PagerDuty alerting. Stuck-run / consumer-lag alerts in Conductor UI only.

---

## Workstream B: API Wiring for Existing Switch UI Pages

**Owner:** Switch (Tier 1) + Trinity (Tier 2)
**Location:** `hermes-switchui/src/components/conductor/`, `operations/`, and `hermes-switchui/src/screens/workflows/`.

**Goal:** Wire the existing Switch UI Conductor, Operations, and **Workflows** pages to the Workstream A backend APIs. No Archon UI components are ported — Switch UI has its own fully developed frontend. This workstream covers creating API client modules, SSE subscriptions, and connecting page components to real workflow engine data.

**Existing pages in scope (all already built, mock-data only):**
- **Conductor** (`/conductor`) — flow tab, org tab, now-playing strip, mission history
- **Operations** (`/operations`) — team roster, focus panel, dispatch, outputs strip
- **Workflows** (`/workflows`) — Library rail (search/filter/source/status), Workflow Grid (cards w/ last-used + run-count), Workflow Editor (metadata + YAML), Launch Wizard (variables → run). Shipped in commit `b7d140d4`, files: `src/routes/workflows.tsx`, `src/screens/workflows/{workflows-screen,workflows-layout,workflows-top-bar,workflow-library,workflow-grid,workflow-editor,workflow-actions,launch-wizard,mock-workflows}.tsx`.

### B.0: API Client Layer

**Goal:** Create the client-side API modules that Switch UI pages use to talk to the workflow engine running in the TanStack Start server.

- Create `src/components/conductor/lib/`:
  - `workflow-api.ts` — wraps Switch UI server calls (API client for workflow CRUD, run management, event streaming)
  - `workflow-types.ts` — TypeScript types for workflow definitions, runs, node runs, phase states, events — adapted from engine schemas for frontend consumption
  - `useWorkflowSSE.ts` — wraps Switch UI's existing SSE infrastructure for workflow events (subscribes to the SSE bridge from A.1.2)
  - `useWorkflowRuns.ts` — TanStack Query hooks for listing runs, fetching run detail, polling node status
  - `useWorkflowActions.ts` — mutations for launch, cancel, approve, resume operations

### B.1: Conductor Page API Wiring

**Goal:** Connect the existing Conductor page (flow tab + org tab + now-playing strip + mission history rail) to Workstream A backend APIs. The UI is already built — this is data integration only.

- **Flow tab:** wire to `GET /api/workflow-definitions`, `POST /api/workflow-runs`, `GET /api/workflow-runs/:id/nodes`. Existing DAG canvas reads node state from these endpoints.
- **Now Playing strip:** wire to SSE subscription from `useWorkflowSSE` — live phase badges, active node count, elapsed time, worker status.
  - Abort button → `POST /api/workflow-runs/:id/cancel`
  - Pause/Resume button → `POST /api/workflow-runs/:id/pause` / `resume`
- **Mission history rail:** wire to `GET /api/workflow-runs?status=done,failed,cancelled` grouped by date. Click past mission → fetch node graph for read-only DAG view.
- **Launch flow:** "Launch" button triggers `POST /api/workflow-runs` with workflow_id + variables → redirects to run detail view.

### B.2: Operations Page API Wiring

**Goal:** Connect the existing Operations page to Workstream A backend APIs for real agent and execution data.

- **Team Roster:** wire to `GET /api/operations/agents` — agent cards with status pulse, current task, capacity bar
- **Focus panel:** wire to `GET /api/operations/agents/:id` — hero section with current mission, activity timeline, tools used, outputs
- **Dispatch panel:** wire to `POST /api/operations/dispatch` — compose area routes through the engine's router, creates Kanban task group
- **Team outputs strip:** wire to `GET /api/operations/outputs` — horizontal scrolling artifact feed
- SSE stream for real-time agent status changes

### B.3: Settings Page (Dispatcher + Worker Status)

**Goal:** Surface Kanban dispatcher health, Hermes worker pool composition, and workflow defaults. **Scope reduced** from prior plan since A.3 was redefined — no Claude/Codex binary configuration (Hermes Agent owns CLI binary management).

- **Dispatcher status:** green/red indicator for gateway reachability, last successful task creation timestamp, current pending tasks count
- **Hermes worker pool:** list of registered agents, their skills, current capacity utilization, last-claimed task
- **Workflow defaults:** default `skills` set per workflow category, default timeouts, default artifact retention
- **Bundled workflows list:** read-only catalog of the 20 ported Archon YAMLs with their adjusted `hermes_task:` annotations
- Save to Hermes-side settings via gateway API

### B.4: Workflows Page API Wiring (`/workflows`)

**Goal:** Replace the mock data in `src/screens/workflows/mock-workflows.ts` with live engine-backed data, and wire the Editor + Launch Wizard to A.1 / A.8 endpoints. UI is already built — this is data + actions integration only.

- **Library rail** (`workflow-library.tsx`): wire to `GET /api/workflow-definitions` — populate list, search, source filter (bundled/global/project), v1/v1.1 status badge derived from A.6/A.9 manifest.
- **Workflow Grid** (`workflow-grid.tsx`): cards reflect real defs.
  - `last_used_at` ← `MAX(workflow_runs.created_at)` per `workflow_id` (engine DB).
  - `run_count` ← `COUNT(workflow_runs)` per `workflow_id`.
  - Sort comparators (last-used / name / runs) consume live values; existing null-safe sort retained.
- **Workflow Editor** (`workflow-editor.tsx`):
  - Load: `GET /api/workflow-definitions/:id` (metadata + raw YAML).
  - Save: `PUT /api/workflow-definitions/:id` — engine re-validates via ported schema validators (A.1) before persisting; surface validation errors inline.
  - Bundled defs are read-only (source=`bundled`); project/global defs are editable.
- **Launch Wizard** (`launch-wizard.tsx`): wire to `POST /api/workflow-runs` with `{ workflow_id, variables, source: 'workflows-page' }` → engine begins **plan** phase (A.8) → redirect to Conductor run-detail view. Variable form is driven by `workflow_definitions.variables_schema`.
- **Workflow actions** (`workflow-actions.tsx`): duplicate (`POST /api/workflow-definitions` w/ copy), delete (`DELETE /api/workflow-definitions/:id` — project/global only), export YAML.
- **Delete `mock-workflows.ts`** once live data is wired; until then it remains the dev fixture.

**Dependencies:** B.0 (API client), A.1 (engine + definition CRUD endpoints), A.6 (YAMLs to populate the catalog), A.8 (run creation enters plan phase).

---

## Implementation Order

|| Priority | Stream | Module | Depends On | Notes |
|---|---|---|---|---|
| **P0** | A | A.0 Dependency Stubs | — | Nothing — can start immediately |
| **P0** | A | A.1 Core Engine Port | A.0 | A.0 must finish first |
| **P0** | A | A.1.1 Engine Workflow Store | A.1 | Implement IWorkflowStore against switchui-workflows.db |
| **P0** | A | A.1.2 SSE / Event Bridge | A.1 | Wire to existing SSE infra |
| **P0** | A | A.2 Kanban Execution Adapter | A.1, A.1.1 | Store + engine must be ready |
| **P0** | A | A.3 Kanban Dispatcher | A.0, A.1 | ~200 LOC single channel to Hermes Kanban |
| **P0** | A | A.11 Reliability Contract | A.1.1, A.2, A.3 | Idempotency, cold-start reconciliation, single-instance lock, test gates. Must lock before broad implementation. |
| **P0** | B | B.0 API Client Layer | — | Create API modules, types, SSE hooks — no engine needed |
| **P0** | A | A.8 5-Phase Orchestration Wrapper | A.1, A.1.1 | Engine DB needs `current_phase`, `phase_transitions` |
| **P1** | A | A.5 Resume Semantics | A.1.1, A.2 | Store wiring + recovery logic |
| **P1** | A | A.6 Workflow YAML Port + Commands | A.1 | 20 YAMLs + ~30–50 command markdowns |
| **P1** | B | B.1 Conductor Page API Wiring | B.0, A.1* | API client (B.0) first; live data needs A.1 API routes |
| **P1** | B | B.2 Operations Page API Wiring | B.0, A.2, A.3 | APIs must be functional |
| **P1** | A | A.9 Adjust 8 YAMLs for Hermes Triggers | A.6, A.8 | Add `hermes_task:` blocks to v1 subset (8 workflows only; rest deferred to v1.1) |
| **P1** | A | A.7 v1 Workflow Subset (8 flows + shared subgraphs) | A.6, A.9, A.3 | Ship 5-agent review subgraph first |
| **P1** | A | A.10 Launch Surfaces + Hermes Manifest | A.1, A.8, A.11 | Three v1 trigger paths (subworkflow/schedule deferred to v1.1); manifest at `~/.hermes/switchui-workflows.json` |
| **P1** | B | B.4 Workflows Page API Wiring | B.0, A.1, A.6, A.8 | Replace `mock-workflows.ts`; wire Library/Grid/Editor/Launch Wizard to engine |
| **P2** | B | B.3 Settings Page | A.3 | Dispatcher health + worker pool status |
| **P3** | A | A.4 Cron / Event Trigger | A.2 | Adapter must be working |

**Parallel tracks:**
- **A.0 + B.0** — both start immediately, no dependencies
- **A.1 engine + B.1 wiring** — engine port doesn't block API client (B.0), but live data in B.1 depends on A.1 API routes
- **A.3 dispatcher** — independent of UI, can run alongside B.1/B.2

**Validation:** A separate test plan document covers per-module verification (engine port, Kanban adapter, dispatcher, SSE bridge, resume semantics, failure recovery). This plan focuses on architecture and implementation scope; the companion test plan defines verification gates.

---

## Key Decisions

- **Engine lives in Switch UI server, not Hermes Agent plugin.** `src/server/workflow-engine/` runs inside the **TanStack Start server runtime**. Rationale: (1) no multi-client roadmap — Switch UI is the only consumer; (2) gateway already exposes ample trigger surfaces (cron events, task lifecycle events, start-time triggers, Kanban skill/label events) that Switch UI server subscribes to over the existing event stream, so cron-when-UI-closed is solved by event durability + replay-on-reconnect rather than by relocating the engine; (3) single-repo iteration is materially faster — every engine change ships through the Switch UI release cycle instead of cross-repo PR coordination with hermes-agent; (4) keeping orchestration logic in the same server runtime as the UI avoids a second Node service and keeps Conductor/Operations API routes local. Hermes Agent plugin route (engine as Python plugin or Node sidecar under the gateway) was considered and explicitly rejected.
- **Engine has its own SQLite DB; Hermes Agent gateway stays untouched.** Engine state at `~/.hermes/switchui-workflows.db` with workflow-engine-owned tables (`workflow_definitions`, `workflow_runs`, `node_runs`, `workflow_events`, `phase_transitions`). Anything Hermes Kanban already owns (tasks, task_events, task_links, task_runs, task_comments) is read via the existing gateway HTTP API. Reads span both DB-backed systems; most writes land in `switchui-workflows.db`, while execution-side writes still happen in Kanban through the gateway when tasks are created, updated, cancelled, or completed. `archon.db` is replaced outright by `switchui-workflows.db`; there is no separate Archon DB in the final design. No new RPC into the gateway, no engine code inside the gateway. `node_runs.kanban_task_id` is the join column. Rationale: no upstream gateway forks, no Python re-implementation of engine concepts, Hermes Agent can absorb upstream changes cleanly.
- **Archon = engine, not adapter.** Switch UI's workflow capability IS the ported Archon engine, period. Not a generic Conductor engine with Archon as one ProviderAdapter among many. Trade: faster to v1 + reuse of Archon's 30-file engine + 20 YAMLs; cost: Switch UI Conductor inherits Archon's DAG-and-YAML semantics. Path B (generic engine + Archon-as-adapter) explicitly rejected as premature abstraction.
- **5-phase orchestration wrapper.** Every workflow run flows through `plan → route → execute → review → report` (A.8). The Archon DAG runs INSIDE the execute phase. Plan phase is a conversational chat (not a DAG). Route phase translates chat output → workflow instantiation. Review may loop back to execute.
- **No Archon UI port.** Switch UI has its own fully developed Conductor page, Operations page, Workflows page (`/workflows` — Library + Grid + Editor + Launch Wizard, shipped in `b7d140d4`, mock-data only), and Matrix-themed design system. No Archon React components, DAG builder, workflow store, or design tokens are ported. Workstream B wires existing Switch UI pages to Workstream A APIs — it does not build new UI from Archon source.
- **No provider port. Hermes Kanban is the only execution channel.** `ClaudeProvider` and `CodexProvider` (~2,700 LOC) explicitly NOT ported. Hermes Agent already drives `claude` CLI + `codex` CLI + other coding tools — porting providers into the engine creates a parallel CLI-spawning mechanism with no product value. Engine ships a thin `kanban-dispatcher.ts` (~200 LOC) implementing the `IAgentProvider` shape; all execute-phase AI work goes through Hermes Kanban tasks; Hermes workers decide which CLI to drive per their plugin/skill config. Saves ~2,700 LOC + binary-resolution / auth-mode / SDK-upgrade churn.
- **20 Archon YAMLs are templates, not contracts.** They get edited in A.9 to add `hermes_task:` blocks where execute-phase nodes should run on Hermes workers (Kanban). Switch UI ships its own flavor of these workflows — upstream Archon YAMLs are the starting point, not the deployed artifact.
- **YAML is the source of truth** for workflow definitions. Hermes Kanban DB (SQLite with 6 tables, 8K+ rows) owns task execution. Two sync points: the Engine Workflow Store (A.1.1) + gateway HTTP API.
- **Kanban store is SQLite, not JSON.** `task_links` (199 links) provides DAG support. `task_runs` (1,671 runs) provides execution lifecycle. `task_events` (6,981 events) provides the SSE stream. No schema changes needed.
- **Archon stays native.** We port source files, not npm packages. No runtime dependency on Archon packages. Port ~30 engine files out of ~400. Stub 2 internal packages (paths, git) via a single A.0 module.
- **SSE drives real-time updates.** A.1.2 bridges Archon's `WorkflowEventEmitter` → Switch UI's SSE channel. Both Conductor and Operations subscribe.
- **Provider types as local shim.** `IAgentProvider` types from `@archon/providers/types.ts` are imported by `deps.ts` — the engine's DI layer. These are copied as a local type-only module alongside A.1, not deferred.

---

## Phase Transition Rules

Every workflow run tracks its current phase in `workflow_runs.current_phase` and records transitions in `phase_transitions` for audit. Phase boundaries are checkpoints — they emit events visible in the Conductor mission timeline.

| Transition | Trigger | Who decides | Engine state |
|---|---|---|---|
| **→ plan** | Workflow run created | System (on launch) | `status='pending'`, `current_phase='plan'`. No DAG nodes exist yet. |
| **plan → route** | User accepts workflow recommendation in Conductor chat and confirms launch intent | User | `current_phase='route'`. Engine loads YAML, fills variables, validates DAG. |
| **route → execute** | Route phase commits `node_runs` rows and DAG is validated | Engine | `status='running'`, `current_phase='execute'`. Kanban tasks created for Hermes-provider nodes. |
| **execute → review** | All execute-phase `node_runs` reach terminal state (completed or skipped) | Engine | `current_phase='review'`. New review `node_runs` created (5-agent fan-out or single review prompt). |
| **review → execute** | Review finds issues requiring rework | Engine (review verdict) | `current_phase='execute'`. New rework `node_runs` created. Loops back. |
| **review → report** | Review passes (or no review needed) | Engine | `current_phase='report'`. Summary + artifacts generated. |
| **report → completed** | Final summary written, artifacts linked | Engine | `status='completed'`. Terminal state. |
| **any → cancelled** | User aborts from Conductor UI | User | `status='cancelled'`. Cascade cancels all outstanding Kanban tasks. |

**Plan phase is NOT a DAG.** It is a free-form chat — variable length, backtracking, user-driven termination. It must NOT be modeled as Archon workflow nodes. The plan-phase output is a structured `RouteDecision` object (workflow_id + variable bindings + scope hints) that becomes the input to the route phase.

**Route phase is where the DAG comes into existence.** **Write permissions on `node_runs`:** route phase is the primary creator (initial DAG materialization). Review phase MAY append additional `node_runs` rows for review-specific nodes if the workflow declares them. Loop expansion creates per-iteration child rows during execute. Resume does NOT create new rows — it updates existing ones. All other phases are read-only on `node_runs`.

---

## Failure Semantics

### Node failure

- **Retry:** if the node's YAML `retry:` block specifies `max_attempts` (1–5), the engine re-creates the `node_run` with incremented retry count after `delay_ms`. Retry only fires for `on_error: 'transient'` (default) — network timeouts, rate limits, subprocess crashes. `on_error: 'all'` retries on any failure including logic errors.
- **Terminal failure:** after retries exhausted (or no retry block), `node_runs.status='failed'`, error stored in `node_runs.error`. Failure propagates to downstream `node_runs` (status `blocked` with reason). Parent `workflow_runs.status='failed'`.
- **Timeout:** if `max_runtime_seconds` is set on the node and the Kanban task or provider invocation exceeds it, `node_runs.status='failed'` with error reason `"timeout"`. Treated as a transient error for retry purposes.

### Workflow engine crash

- See A.2.3 crash-safe design: cursor persistence, orphan reaper on boot, heartbeat monitoring, replay from last-processed event. In-flight Kanban tasks survive independently in Hermes gateway — the consumer reconciles on restart.
- `failOrphanedRuns()` runs on every Switch UI server boot. Any `workflow_runs` row still `running` with `last_heartbeat` older than 5 minutes is marked `failed`.

### Failed run inspection

- Operations page shows failed runs with per-node error messages and retry counts.
- `workflow_events` table preserves the full event timeline — including failure events — for post-mortem.
- Conductor mission detail view shows the DAG with failed nodes highlighted, error payloads expanded, and a "Resume" button if the run is in a resumable state (`failed` or `paused`).

### Dead letter handling

- Engine events that cannot be processed (e.g., `node_runs` row missing for a Kanban task ID in a completion event) are logged to `workflow_events` with `event_type='reconciliation_error'` and full payload. They are not silently dropped.
- Conductor admin view surfaces reconciliation errors as warnings.

---

## Conductor Phase Model — Relationship to Archon

The Conductor operates a 5-phase orchestration flow for all missions:

**plan → route → execute → review → report**

### Phase Boundary: Conductor vs Archon

Archon workflows are a **specialist execution engine** invoked *during the execute phase* when the mission is a coding task. The Conductor's own phase model is the general-purpose orchestration layer that handles anything — coding, research, content, data pipelines, operational workflows.

```
┌──────────────────────────────────────────────────────┐
│  CONDUCTOR (general-purpose orchestration)            │
│                                                       │
│  1. PLAN     ── iterative user-Hermes conversation    │
│  2. ROUTE    ── classify mission, select executor     │
│       │                                               │
│       ├── coding task? ──► ARCHON WORKFLOW (specialist)│
│       │                     (plan-to-pr, fix-issue,   │
│       │                      review, refactor, etc.)  │
│       │                                               │
│       └── other task?  ──► HERMES KANBAN (native)     │
│                            (delegate_task, cron,      │
│                             subagents, scripts)       │
│       │                                               │
│  3. EXECUTE  ── chosen executor runs                  │
│  4. REVIEW   ── server-side AI evaluation of outputs  │
│  5. REPORT   ── summary delivered to user             │
└──────────────────────────────────────────────────────┘
```

### Plan Phase: SwitchUI-Native, Not Archon

The plan phase is an **interactive conversation** between the user and Hermes — variable length, backtracking, refinement loops, user-driven termination. This is fundamentally not a DAG and must not be modeled as an Archon workflow.

**What Archon does instead:**
- `archon-create-plan` is a monolithic 690-line prompt that runs autonomously (no user interaction)
- `archon-confirm-plan` is an automated verification step (not user chat)
- `archon-interactive-prd` and `archon-piv-loop` have multi-round human interaction but use structured loop/await DAG semantics — still less flexible than free-form chat

**Routing logic during the route phase:**
1. Mission classified → is this a coding task matching an Archon workflow?
2. **Yes** → invoke the relevant Archon workflow. Plan output becomes input to `archon-plan-to-pr` or whichever workflow fits.
3. **No** → continue through Conductor's own 5-phase pipeline using Hermes Kanban. No Archon involved.

### Why This Boundary Matters

- Archon is a DAG-based workflow engine for **multi-step coding processes** with dependencies and parallel execution
- Simple Hermes patterns (single task, delegate_task) are better for one-shot, single-session operations
- Archon workflows should be triggered for: multi-step code changes, parallel research + synthesis, human-in-the-loop with approval gates, scheduled maintenance pipelines (cron-triggered), cross-provider workflows
- The Conductor's plan phase produces a mission spec that becomes *input* to whichever executor gets selected — Archon is one executor option, not the foundation

---

## Archon Built-In Workflow Inventory

Archon ships with 20 default workflows, all coding-specific. These are the specialist workflows available to the Conductor's route phase when classifying a coding mission.

| Workflow | Purpose | When to Route To It |
|---|---|---|
| `archon-idea-to-pr` | Idea → autonomous plan → implement → PR → review → merge | End-to-end new feature from scratch |
| `archon-plan-to-pr` | Existing plan → implement → PR → review → merge | Plan already exists, needs execution |
| `archon-fix-github-issue` | Classify issue → investigate → fix → PR → review | GitHub issue needs resolution |
| `archon-feature-development` | Implement from existing plan → validate → PR | Simpler feature implementation |
| `archon-comprehensive-pr-review` | 5 parallel review agents → synthesize → fix | Thorough PR code review |
| `archon-smart-pr-review` | Complexity-adaptive review (skip irrelevant agents) | Efficient PR review |
| `archon-validate-pr` | Parallel test on main vs feature branch | PR validation with testing |
| `archon-issue-review-full` | Full investigate → fix → comprehensive review | Deep issue analysis + fix pipeline |
| `archon-interactive-prd` | Guided multi-round PRD creation | PRD needs interactive development |
| `archon-piv-loop` | Plan-Implement-Validate loop with human-in-the-loop | Guided development with checkpoints |
| `archon-ralph-dag` | Story-based implementation loop (PRD → stories → implement) | Story-driven feature implementation |
| `archon-create-issue` | Bug reproduction → GitHub issue creation | Bug report needs filing |
| `archon-refactor-safely` | Safe refactoring with continuous validation | Code restructuring needed |
| `archon-resolve-conflicts` | Merge conflict analysis + auto-resolution | PR has merge conflicts |
| `archon-architect` | Architecture sweep, complexity reduction | Codebase health improvement |
| `archon-adversarial-dev` | GAN-style: planner vs builder vs evaluator | Full application build from scratch |
| `archon-assist` | Catch-all: questions, debugging, exploration | Nothing else matches |
| `archon-workflow-builder` | Generates new custom workflow YAML | User wants to create a new workflow |
| `archon-remotion-generate` | Remotion video generation | Video/animation creation |
| `archon-test-loop-dag` | Test DAG loop functionality | Demo/testing of loop nodes |

### Workflow Categories

**End-to-end coding pipelines (invoke as full missions):**
- `archon-idea-to-pr`, `archon-plan-to-pr`, `archon-fix-github-issue`, `archon-feature-development`, `archon-issue-review-full`

**Review and validation (invoke as sub-steps or standalone):**
- `archon-comprehensive-pr-review`, `archon-smart-pr-review`, `archon-validate-pr`

**Interactive / human-in-the-loop:**
- `archon-interactive-prd`, `archon-piv-loop`

**Specialist coding operations:**
- `archon-refactor-safely`, `archon-resolve-conflicts`, `archon-architect`, `archon-create-issue`

**Implementation patterns:**
- `archon-ralph-dag`, `archon-adversarial-dev`

**Utility:**
- `archon-assist` (fallback), `archon-workflow-builder` (meta), `archon-remotion-generate` (video), `archon-test-loop-dag` (testing)
