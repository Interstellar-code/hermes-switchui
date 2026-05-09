# Archon-Hermes Integration Plan

> **Status:** Planning doc — split into two workstreams. Reviewed by Codex (via Neo). Gaps closed.

**Goal:** Port the Archon workflow engine into Hermes Switch UI as a native subsystem. Strip what we don't need (platform adapters, chat UI, layout shell, dashboard). Keep only: the YAML DAG engine, Claude Code/Codex providers, and the drag-and-drop workflow builder UI. Everything we keep gets embedded into Switch UI's existing architecture — two workstreams running in parallel.

**Architecture philosophy:** Take the pieces, not the package. Archon's core engine becomes a Switch UI server module. Archon's DAG builder UI becomes part of the Conductor page. Hermes Kanban (SQLite) becomes the execution runtime — it already has `tasks`, `task_links`, `task_runs`, `task_events` tables. Claude Code and Codex providers come from Archon's source — ported in, not imported from npm.

**Strip audit:** ~70% of Archon is redundant with Switch UI or Hermes Gateway. We import only:
- Workflow engine: ~30 non-test files from `packages/workflows/src/`
- Providers: ~10 files from `packages/providers/src/claude/` and `codex/` (excluding Pi provider)
- DAG builder UI: ~23 React components from `packages/web/src/components/workflows/` (including execution monitoring)
- Internal deps: ~18 utility/hook/store files to port or bridge

**Codex review outcome:** The old JSON Kanban store was identified as a gap — this is a non-issue. Hermes Kanban is SQLite with `task_links` (199 rows), `task_runs` (1,671 rows), `task_events` (6,981 rows), `task_comments`, and `tasks` (186 rows). The DAG execution layer, event streaming, and run lifecycle tracking already exist. The review's practical findings (dependency stubs, component count, routing migration) are folded in below.

---

## Workstream A: Archon Backend Integration

**Owner:** Switch (Tier 1) + Neo (Tier 2)
**Location:** `hermes-switchui/src/server/workflow-engine/`

**Goal:** Port the Archon workflow engine into Hermes Switch UI's server, wire it to the Hermes Agent (Kanban, delegate_task, dispatcher), and add Claude Code/Codex provider support. This is the backend that powers the Conductor and Operations pages.

### A.0: Dependency Stub Module

**Goal:** Create `src/server/workflow-engine/archon-stubs.ts` — a single file providing drop-in replacements for Archon's internal package dependencies (`@archon/paths`, `@archon/git`, `@archon/isolation`). This avoids porting 3 entire packages.

- `createLogger(ns: string)` → Hermes internal logger
- `captureWorkflowInvoked()` → no-op or log
- `execFileAsync(cmd, args)` → `child_process.execFile` promisified
- `getHomeWorkflowsPath()` → `path.join(HERMES_HOME, 'workflows')`
- `getHomeScriptsPath()` → `path.join(HERMES_HOME, 'scripts')`
- `getDefaultBranch()` → `'main'` (not used without git worktrees)
- `toRepoPath(p)` → identity (no git isolation in Hermes)
- `BUNDLED_VERSION` → constant string
- All path resolution functions → Hermes-configured equivalents

**Why first:** These are imported by 7+ engine files. Porting them once here means zero changes to the ported engine code — just rewrite the import paths.

### A.1: Core Engine Port

**Goal:** Extract and adapt Archon's workflow engine into Switch UI's server module. No UI dependencies.

- **Build A.0 first** (Dependency Stub Module above)

- **Files to port from `packages/workflows/src/` (30 files):**
  - **Engine core:**
    - `loader.ts` — parse YAML workflow files into typed DAG structures
    - `dag-executor.ts` — execute nodes in topological order (Kahn's algorithm), manage concurrency
    - `executor.ts` — per-node execution with provider dispatch
    - `executor-shared.ts` — error classification shared between executor and dag-executor
    - `router.ts` — decompose natural language missions into workflow steps via LLM
    - `event-emitter.ts` — singleton EventEmitter for lifecycle events → SSE bridge
    - `store.ts` — `IWorkflowStore` interface (20+ methods: run lifecycle, event logging, status CRUD)
    - `deps.ts` — `WorkflowDeps`, `IWorkflowPlatform`, `WorkflowConfig`, `AgentProviderFactory` — the DI injection point for the entire engine
  - **Validation & schemas:**
    - `schemas/` — Zod schemas for workflow YAML (dag-node, workflow-run, retry, loop, hooks)
    - `validator.ts` — DAG structure validation (cycles, deps, `$nodeId.output` references)
    - `validation-parser.ts` — parse validation rules from YAML (distinct from validator.ts)
    - `command-validation.ts` — validate command node references
    - `condition-evaluator.ts` — evaluate `when:` conditions on nodes
  - **Discovery:**
    - `workflow-discovery.ts` — filesystem scan for YAML workflows across scopes
    - `script-discovery.ts` — discover scripts in `.archon/scripts/`
  - **Node execution:**
    - `script-node-deps.ts` — resolve dependencies for script nodes
    - `load-command-prompt.ts` — load command files for `command:` nodes
  - **Utilities:**
    - `utils/variable-substitution.ts` — `$nodeId.output` substitution
    - `utils/duration.ts` — `formatDuration`, `parseDbTimestamp`
    - `utils/idle-timeout.ts` — idle timeout for long-running nodes
    - `utils/tool-formatter.ts` — format tool calls for display
  - **Defaults:**
    - `defaults/bundled-defaults.ts` — embedded default workflows that ship with Archon
  - **Exports:**
    - `types.ts`, `index.ts` — re-exports

- **Adaptations for Switch UI:**
  - Swap `import from '@archon/paths'` → `import from './archon-stubs'`
  - Swap `import from '@archon/git'` → `import from './archon-stubs'`
  - Swap `import from '@archon/isolation'` → `import from './archon-stubs'` (worktree isolation not needed)
  - Remove Bun-specific imports (use Node.js `child_process`, `fs` equivalents)
  - Keep `@hono/zod-openapi` for schema generation if used by engine internals; strip if only used by Archon's web API

- **A.1.1: Hermes Workflow Store (`IWorkflowStore` implementation)**
  - Create `hermes-workflow-store.ts` implementing `IWorkflowStore` (20+ methods)
  - Backed by the Hermes Kanban SQLite DB (`~/.hermes/kanban.db`)
  - Maps `IWorkflowStore` methods to Kanban DB operations:
    - `createWorkflowRun()` → insert into `tasks` (root task) + `task_runs` (first run)
    - `getWorkflowRun()` → read from `tasks` + latest `task_runs`
    - `updateWorkflowStatus()` → update `tasks.status`, insert `task_runs`
    - `completeWorkflowRun()` → `tasks.status='done'`, `task_runs.status='completed'`
    - `failWorkflowRun()` → `tasks.status='failed'`, `task_runs.status='failed'`
    - `logWorkflowEvent()` → insert into `task_events`
    - `getWorkflowRunStatus()` → read `tasks.status`, `task_runs.outcome`
  - Edge cases: split-brain prevention (transactional writes to tasks + task_runs)

- **A.1.2: SSE / Event Bridge**
  - Wire Archon's `WorkflowEventEmitter` (singleton EventEmitter) to the SSE streaming channel
  - Events: `workflow:started`, `workflow:node_completed`, `workflow:error`, `workflow:paused`, `workflow:completed`, `workflow:approval_required`
  - Conductor and Operations pages subscribe via existing Switch UI SSE infrastructure

**Location:** `hermes-switchui/src/server/workflow-engine/`

### A.2: Kanban Execution Adapter

**Goal:** When a workflow runs, its DAG nodes materialize as Kanban tasks. Auto-promotion via `task_links`. This is the bridge between Archon's executor and Hermes Kanban.

- **A.2.1: Kanban-dispatched workflow runner (Hermes Agent skill)**
  - Create a skill: `archon-workflow-runner`
  - Input: workflow YAML path, optional variable overrides
  - Process:
    1. Load YAML via Archon's `parseWorkflow()`
    2. Create a Kanban parent task with metadata linking to the YAML
    3. For each DAG node, create a child task linked via `task_links`
    4. Set first-layer nodes (zero deps) to `ready`
    5. Subscribe to Kanban task completion events via `task_events`
    6. On child completion, check `task_links` → flip downstream nodes to `ready`
    7. Handle loop nodes: recreate child tasks until completion signal (`max_iterations`, `completion_check`)
    8. Handle approval nodes: set task to `status: 'blocked'`, Conductor unblocks via `POST /api/conductor/missions/:id/approve`

- **A.2.2: Node type → task mapping**

| Archon Node Type | Kanban Mapping |
|---|---|
| `prompt:` | Task with `skills: ['archon-prompt-worker']`, content in `body` |
| `bash:` | Task with `skills: ['archon-bash-worker']`, script in `body` |
| `script:` | Task with `skills: ['archon-script-worker']`, code + runtime in `body` |
| `loop:` | Parent task with children per iteration, re-created until done; uses `completion_check`, `max_iterations`, `user_input_prompt` from Archon schema |
| `approval:` | Task set to `status: 'blocked'`, unblocked via `POST /api/conductor/missions/:id/approve` |
| `command:` | Task that loads a command file from `.archon/commands/` via Archon's `load-command-prompt.ts` |

- **A.2.3: Auto-promotion engine**
  - Lightweight watcher that subscribes to `task_events` (kind=`completed`, `failed`, `blocked`)
  - On completion: reads `task_links`, checks if all upstream deps of any child are done
  - All deps done → promote child from `triage` → `ready` (update `tasks.status`)
  - Any dep failed → downstream nodes get `blocked` with error reason in `body`
  - Loop/approval → emit to SSE stream for Conductor page
  - Edge cases: cycle detection (prevent beyond `max_iterations`), failure propagation, timeout from `max_runtime_seconds`
  - Cancel workflow: cascade from parent task to all children via `task_links` recursive traversal

- **A.2.4: Variable substitution**
  - `$nodeId.output` = `task_runs.summary` or `task.result`
  - Engine substitutes these when creating downstream tasks
  - Supports: `$WORKFLOW_ID`, `$ARTIFACTS_DIR`, `$1`, `$ARGUMENTS`, `$LOOP_USER_INPUT`

**Archon DB:** Archon keeps `~/.archon/archon.db` (SQLite) for workflow run state, provider config, session tracking. The Kanban DB is the mission execution store. The adapter (A.2) is the translation layer between them. `IWorkflowStore` (port of Archon's interface) is backed by the Kanban DB.

### A.3: Provider Port (Claude Code & Codex)

**Goal:** Port Archon's Claude Code and Codex provider implementations so workflow nodes can dispatch to these coding agents. This is what gives us multi-agent control — Hermes delegates via Kanban, Claude Code / Codex execute workflow nodes directly.

- **Files to port from `packages/providers/src/`:**
  - `claude/provider.ts` + `config.ts` + `binary-resolver.ts` + `capabilities.ts` + `index.ts`
  - `codex/provider.ts` + `config.ts` + `binary-resolver.ts` + `capabilities.ts` + `index.ts`
  - `types.ts` — `IAgentProvider`, `MessageChunk`, `TokenUsage`, `SendQueryOptions`, `NodeConfig`, `ProviderDefaultsMap`, `ProviderCapabilities`, `ProviderRegistration`, `ProviderInfo`
  - `registry.ts` — `registerBuiltinProviders()`, `ProviderRegistration` factory pattern

- **Location:** `hermes-switchui/src/server/providers/`

- **Provider registry bootstrapping:**
  - On Switch UI server startup, call `registerBuiltinProviders()` to register Claude + Codex
  - Provider registration happens before any workflow is loaded
  - Registry provides the `AgentProviderFactory` used by `deps.ts` → `executor.ts`

- **Adaptations:**
  - Replace Archon's config loading (`.archon/config.yaml`) with Switch UI settings
  - Claude Code: `CLAUDE_BIN_PATH` configurable in settings, binary resolver validates installation
  - Codex: `CODEX_BIN_PATH` configurable in settings, binary guard verifies installation
  - Wire provider status/validation to Operations page
  - `execFileAsync` from A.0 handles subprocess execution (child_process, not Bun)

- **Workflow routing logic:**
  - YAML node specifies `provider: hermes | claude | codex`
  - If `hermes`: route through Kanban dispatch (A.2.1)
  - If `claude` or `codex`: route through Archon provider SDK
  - Provider selection visible in the Conductor DAG view (node labels/shimmer)

- **Pi provider excluded:** Community Pi provider (11 files) is not needed. Hermes already provides LLM access via existing providers.

### A.4: Cron Integration

**Goal:** Hermes cron jobs can trigger Archon workflows. A cron fires → invokes a workflow YAML → the workflow materializes as Kanban tasks → the team executes.

- Cron job UI extended to support picking a workflow YAML as the action
- When cron fires, it calls the Kanban-dispatched workflow runner (A.2.1)
- Cron output = workflow run summary (from `task_runs.summary`)
- Workflow YAMLs can have optional `schedule:` field (cron expression) — Conductor registers these with Hermes cron on load

---

## Workstream B: Archon UI Integration

**Owner:** Switch (Tier 1) + Trinity (Tier 2)
**Location:** `hermes-switchui/src/components/conductor/` and `operations/`

**Goal:** Port the Archon drag-and-drop DAG builder into the Conductor page. The Operations page is Switch UI-native (designed from scratch) but consumes the backend APIs created in Workstream A. No porting of Archon's chat UI, dashboard, sidebar, layout, or design system — Switch UI has its own.

### B.0: Dependencies & Scaffolding

**Goal:** Install the libraries Archon's UI depends on and set up the porting layer before touching components.

- Add `@xyflow/react@^12.10.1` to Switch UI's `package.json` — the React Flow canvas library
- Add `@dagrejs/dagre` for auto-layout of DAG nodes
- Verify compatibility with Switch UI's bundler (Vinxi/TanStack Start) — tree-shaking assessment
- Create `src/components/conductor/lib/` porting layer:
  - `workflow-api.ts` — wraps Switch UI server calls (API client)
  - `workflow-types.ts` — re-exports Archon types adapted for Switch UI; defines `WorkflowState`, `DagNodeState`, `WorkflowStepStatus`, etc.
  - `useWorkflowSSE.ts` — wraps Switch UI's SSE infrastructure for workflow events
  - `useProject.ts` — adapter for Switch UI's workspace/project context
- Port the Zustand `workflow-store.ts` from Archon first — this is the state management backbone. Swap API calls to Switch UI endpoints.

### B.1: Conductor — DAG Builder (Flow Tab)

**Goal:** The "flow" tab of the Conductor page becomes Archon's interactive DAG editor with full drag-and-drop, node configuration, and YAML export. The "org" tab retains the 3-tier hierarchy view.

- **Components to port from `packages/web/src/components/workflows/` (23 components):**
  - **Builder core:**
    - `WorkflowBuilder.tsx` — main builder component (orchestrates canvas + palette + properties)
    - `WorkflowCanvas.tsx` — interactive DAG canvas (draw nodes, draw edges, React Flow integration)
    - `NodePalette.tsx` — node type palette (prompt, bash, script, loop, approval, command)
    - `NodeInspector.tsx` — properties panel for the selected node
    - `BuilderToolbar.tsx` — save, load, undo/redo, run, validate buttons
    - `ValidationPanel.tsx` — real-time validation errors
    - `DagNodeComponent.tsx` — visual node on the canvas (draggable, configurable)
    - `YamlCodeView.tsx` — raw YAML editor view (toggle between visual and code)
    - `NodeLibrary.tsx` — node library sidebar (browse/search available node types)
    - `CommandPicker.tsx` — command selection modal for `command:` nodes
    - `QuickAddPicker.tsx` — quick node addition in the canvas
  - **Execution monitoring:**
    - `WorkflowExecution.tsx` — main execution view (orchestrates progress, logs, artifacts)
    - `WorkflowDagViewer.tsx` — read-only DAG visualization during execution
    - `ExecutionDagNode.tsx` — read-only execution progress node
    - `DagNodeProgress.tsx` — per-node progress overlay
    - `StepLogs.tsx` — log output for individual steps
    - `StatusIcon.tsx` — status badge icon component
    - `StatusBar.tsx` — bottom status bar
    - `ArtifactSummary.tsx` — artifact display in execution view
    - `ArtifactViewerModal.tsx` — modal for viewing artifacts
  - **Workflow management:**
    - `WorkflowList.tsx` — workflow list/grid view
    - `WorkflowCard.tsx` — card component for workflow list items

- **Adaptations for Switch UI:**
  - Replace all `@/components/ui/*` (shadcn) with Switch UI's design system components (Matrix-themed)
  - Apply Matrix theme: dark background, green accents, monospace fonts, glow effects, binary rain accents
  - Replace `react-router` navigation (`useNavigate`, `useSearchParams`) with `@tanstack/react-router`
  - Replace `@/contexts/ProjectContext.tsx` with `useProject()` adapter from B.0
  - Wire save/load to Switch UI's server API calls (from B.0 workflow-api.ts)
  - SSE subscriptions use `useWorkflowSSE` from B.0

- **B.1.1: View toggle**
  - "Flow" tab → DAG builder (interactive, for editing workflow definitions)
  - "Org" tab → 3-tier SVG hierarchy view (read-only, for active mission visualization)
  - Both share the Conductor route, toggle switches between them
  - Same route, different render tree. No URL change needed.

- **B.1.2: Now Playing strip**
  - Shows live mission status from Kanban parent task (via SSE)
  - Elapsed time, active workers, token usage, stage badges (plan → route → execute → review → report)
  - Abort button → `POST /api/conductor/missions/:id/cancel` (cascade cancel through `task_links`)
  - Pause/Resume button → toggle `tasks.status` between `running` and `blocked`
  - Real-time updates via SSE from A.1.2 event bridge

- **B.1.3: Mission history rail (right side)**
  - Reads from `task_runs` + `task_events` via `GET /api/conductor/missions/history`
  - Grouped by day, status badges, token counts
  - Click past mission → `GET /api/conductor/missions/:id/dag` → load in read-only `WorkflowDagViewer`
  - Uses `WorkflowDagViewer.tsx` (port from Archon) for read-only DAG rendering

### B.2: Operations — Agent Team Management

**Goal:** The Operations page is built from Switch UI's existing design mockup (Operations.html). No Archon UI components are ported here. It consumes Workstream A's backend APIs for real data.

- **Design reference:** `docs/Design Assets/Hermes-Switchui/Operations.html` — 4-column grid layout with Matrix theme

- **Components to build (Switch UI-native, not ported from Archon):**
  - **Team Roster** — agent cards with avatar, status pulse (live/idle/blocked/error), current task, capacity bar, token usage, role badge
  - **Focus panel** — hero section with large avatar, name, status badge, model/profile/tools metadata; grid panels for current mission, activity timeline, tools used, outputs
  - **Dispatch panel** — compose textarea, route mode toggle (auto/broadcast/manual), routing preview with confidence scores and estimated cost/time, save draft/dispatch buttons
  - **Team outputs strip** — horizontal scrolling rail of artifact cards filterable by type (all/code/docs/data/media)

- **Consumes Workstream A APIs:**
  - `GET /api/operations/agents` — roster data (agents with latest task, status, token usage)
  - `GET /api/operations/agents/:id` — agent detail for focus panel
  - `GET /api/operations/agents/:id/activity` — timeline from `task_events`
  - `GET /api/operations/agents/:id/tools` — aggregated tool usage from recent `task_runs`
  - `GET /api/operations/agents/:id/outputs` — artifacts from `task_runs` with outputs
  - `GET /api/operations/outputs` — team-wide artifact feed (horizontally scrollable)
  - `POST /api/operations/dispatch` — compose → Archon's router decomposes → creates Kanban task group
  - SSE stream for real-time agent status changes

### B.3: Settings Page (Provider Configuration)

**Goal:** A settings UI for configuring Claude Code and Codex binary paths, verifying installation, and setting workflow defaults. A simple form, not a port from Archon.

- Where to find `CLAUDE_BIN_PATH` / `CODEX_BIN_PATH` (input fields with file picker)
- Show installed version, connectivity status (green/red indicator)
- Default provider selection for workflow nodes (dropdown: hermes / claude / codex)
- Save to Hermes configuration (not `.archon/config.yaml`)
- Verify button that runs the provider's binary resolver

---

## Implementation Order

| Priority | Stream | Module | Depends On | Real Dependencies |
|---|---|---|---|---|
| **P0** | A | A.0 Dependency Stubs | — | Nothing — can start immediately |
| **P0** | A | A.1 Core Engine Port | A.0 | A.0 must finish first |
| **P0** | A | A.1.1 Hermes Workflow Store | A.1 | Kanban SQLite already exists — just implement interface |
| **P0** | A | A.1.2 SSE / Event Bridge | A.1 | Wire to existing SSE infra |
| **P0** | B | B.0 Dependencies & Scaffolding | — | Install packages, build porting layer — no engine needed |
| **P0** | A | A.2 Kanban Execution Adapter | A.1, A.1.1 | Store + engine must be ready |
| **P1** | B | B.1 Conductor DAG Builder | B.0, A.1* | UI scaffold (B.0) first; save/load needs A.1 API routes |
| **P1** | A | A.3 Provider Port (Claude/Codex) | A.0, A.1 | Stubs + engine types needed |
| **P1** | B | B.2 Operations Page | B.0, A.2, A.3 | APIs must be functional |
| **P2** | B | B.3 Settings Page | A.3 | Providers must be configured |
| **P3** | A | A.4 Cron Integration | A.2 | Adapter must be working |

**Parallel tracks:**
- **A.0 + B.0** — both start immediately, no dependencies
- **A.1 engine + B.1 UI scaffold** — engine port doesn't block UI scaffold (B.0), but save/load/validate/run features in B.1 depend on A.1 API routes
- **A.3 providers** — independent of UI, can run alongside B.1/B.2

---

## Key Decisions

- **YAML is the source of truth** for workflow definitions. Archon keeps `~/.archon/archon.db` for provider config and run state. Hermes Kanban DB (SQLite with 6 tables, 8K+ rows) owns task execution. Separate DBs, two sync points: the Hermes Workflow Store (A.1.1) + API routes.
- **Kanban store is SQLite, not JSON.** `task_links` (199 links) provides DAG support. `task_runs` (1,671 runs) provides execution lifecycle. `task_events` (6,981 events) provides the SSE stream. No schema changes needed.
- **Archon stays native.** We port source files, not npm packages. No runtime dependency on Archon packages. Port ~60 files total out of ~400. Stub 3 internal packages (paths, git, isolation) via a single A.0 module.
- **No Archon chat UI.** Switch UI has its own chat. No Archon dashboard, layout, sidebar, or design system — Switch UI has its own.
- **Conductor = DAG builder (flow tab) + hierarchy view (org tab).** The DAG builder uses `@xyflow/react` (ported from Archon) and themed with Matrix styling.
- **Operations = built from scratch** using Switch UI's native components, consuming Workstream A APIs. Operations.html mockup is the design reference.
- **SSE drives real-time updates.** A.1.2 bridges Archon's `WorkflowEventEmitter` → Switch UI's SSE channel. Both Conductor and Operations subscribe.
- **Provider types ported in A.1, not deferred.** `IAgentProvider` types from `@archon/providers/types.ts` are imported by `deps.ts` — the engine's DI layer. These must be ported alongside A.1, not after.
- **Pi provider excluded.** Community/pi provider (11 files, ~20 LLM backends) is not needed. Hermes already provides LLM access.
