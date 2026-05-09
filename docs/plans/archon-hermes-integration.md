# Archon-Hermes Integration Plan

> **Status:** Planning doc — split into two workstreams

**Goal:** Port the Archon workflow engine into Hermes Switch UI as a native subsystem. Strip what we don't need (platform adapters, chat UI, layout shell, dashboard). Keep only: the YAML DAG engine, Claude Code/Codex providers, and the drag-and-drop workflow builder UI. Everything we keep gets embedded into Switch UI's existing architecture — two workstreams running in parallel.

**Architecture philosophy:** Take the pieces, not the package. Archon's core engine becomes a Switch UI server module. Archon's DAG builder UI becomes part of the Conductor page. Hermes Kanban becomes the execution runtime. Claude Code and Codex providers come from Archon's source — ported in, not imported from npm.

**Strip audit:** ~70% of Archon is redundant with Switch UI or Hermes Gateway. We import only:
- Workflow engine: ~25 files from `packages/workflows/src/`
- Providers: ~15 files from `packages/providers/src/claude/` and `codex/`
- DAG builder UI: ~8 React components from `packages/web/src/components/workflows/`

---

## Workstream A: Archon Backend Integration

**Owner:** Switch (Tier 1) + Neo (Tier 2)
**Location:** `hermes-switchui/src/server/workflow-engine/`

**Goal:** Port the Archon workflow engine into Hermes Switch UI's server, wire it to the Hermes Agent (Kanban, delegate_task, dispatcher), and add Claude Code/Codex provider support. This is the backend that powers the Conductor and Operations pages.

### A.1: Core Engine Port

**Goal:** Extract and adapt Archon's workflow engine (loader, DAG executor, router, schemas, validator) into Switch UI's server module. No UI dependencies.

- **Files to port from `packages/workflows/src/`:**
  - `loader.ts` — parse YAML workflow files into typed DAG structures
  - `dag-executor.ts` — execute nodes in topological order, manage concurrency
  - `executor.ts` — per-node execution with provider dispatch
  - `router.ts` — decompose natural language missions into workflow steps
  - `schemas/` — Zod schemas for workflow YAML validation
  - `validator.ts` — DAG structure validation (cycles, deps, references)
  - `condition-evaluator.ts` — evaluate `when:` conditions on nodes
  - `event-emitter.ts` — emit lifecycle events for SSE/streaming
  - `store.ts` — Archon's workflow store abstraction
  - `types.ts` + `index.ts` — re-exports

- **Adaptations for Switch UI:**
  - Replace Archon's logger (`@archon/paths`) with Hermes' internal logger
  - Replace Archon's DB adapter with direct SQLite or Hermes Kanban queries
  - Remove Bun-specific imports (use Node.js equivalents)
  - Remove worktree isolation dependencies (not needed)

- **Location:** `hermes-switchui/src/server/workflow-engine/`

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
    5. Subscribe to Kanban task completion events
    6. On child completion, check deps → flip downstream nodes to `ready`
    7. Loop nodes: recreate child tasks until completion signal
    8. Approval nodes: set task to `blocked`, Conductor unblocks

- **A.2.2: Node type → task mapping**

| Archon Node Type | Kanban Mapping |
|---|---|
| `prompt:` | Task with `skills: ['archon-prompt-worker']`, content in `body` |
| `bash:` | Task with `skills: ['archon-bash-worker']`, script in `body` |
| `script:` | Task with `skills: ['archon-script-worker']`, code + runtime in `body` |
| `loop:` | Parent task with children per iteration, re-created until done |
| `approval:` | Task set to `status: 'blocked'`, unblocked via Conductor UI |
| `command:` | Task that loads a command file from `.archon/commands/` |

- **A.2.3: Auto-promotion engine**
  - Watches Kanban for completed tasks (event subscription or poll)
  - On completion: reads `task_links`, checks upstream deps of children
  - All deps done → promote child from `triage` → `ready`
  - Loop/approval → notify Conductor via SSE
  - Edge cases: cycle detection, failure propagation, timeout handling

- **A.2.4: Variable substitution**
  - `$nodeId.output` = `task_runs.summary` or `task.result`
  - Engine substitutes these when creating downstream tasks
  - Supports: `$WORKFLOW_ID`, `$ARTIFACTS_DIR`, `$1`, `$ARGUMENTS`, `$LOOP_USER_INPUT`

- **Archon DB:** Keeps its own `~/.archon/archon.db` (SQLite) for workflow run state, provider config, session tracking. Separate from the Kanban DB. The Kanban adapter is the translation layer.

### A.3: Provider Port (Claude Code & Codex)

**Goal:** Port Archon's Claude Code and Codex provider implementations so workflow nodes can dispatch to these coding agents. This is what gives us the multi-agent control — Hermes delegates via Kanban, Claude Code / Codex execute workflow nodes directly.

- **Files to port from `packages/providers/src/`:**
  - `claude/provider.ts` + `config.ts` + `binary-resolver.ts` + `capabilities.ts`
  - `codex/provider.ts` + `config.ts` + `binary-resolver.ts` + `capabilities.ts`
  - `types.ts` — the `IAgentProvider` interface
  - `registry.ts` — provider registry

- **Location:** `hermes-switchui/src/server/providers/`

- **Adaptations:**
  - Replace Archon's provider config loading with Switch UI settings
  - Wire provider status/validation to the Operations page
  - Claude Code needs `CLAUDE_BIN_PATH` configurable in settings
  - Codex needs `CODEX_BIN_PATH` configurable in settings

- **Workflow routing logic:**
  - YAML node specifies `provider: hermes | claude | codex`
  - If `hermes`: route through Kanban dispatch
  - If `claude` or `codex`: route through Archon provider SDK
  - Provider selection visible in the Conductor DAG view

### A.4: Cron Integration

**Goal:** Hermes cron jobs can trigger Archon workflows. A cron fires → invokes a workflow YAML → the workflow materializes as Kanban tasks → the team executes.

- Cron job UI extended to support picking a workflow YAML as the action
- When cron fires, it calls the Kanban-dispatched workflow runner (A.2.1)
- Cron output = workflow run summary
- Workflow YAMLs can have optional `schedule:` field (cron expression)

---

## Workstream B: Archon UI Integration

**Owner:** Switch (Tier 1) + Trinity (Tier 2)
**Location:** `hermes-switchui/src/components/conductor/` and `operations/`

**Goal:** Port the Archon drag-and-drop DAG builder into the Conductor page. The Operations page is Switch UI-native (designed from scratch) but consumes the backend APIs created in Workstream A. No porting of Archon's chat UI, dashboard, sidebar, layout, or design system — Switch UI has its own.

### B.1: Conductor — DAG Builder (Flow Tab)

**Goal:** The "flow" tab of the Conductor page becomes Archon's interactive DAG editor with full drag-and-drop, node configuration, and YAML export. The "org" tab retains the 3-tier hierarchy view.

- **Components to port from `packages/web/src/components/workflows/`:**
  - `WorkflowBuilder.tsx` — the main builder component (orchestrates canvas + palette + properties)
  - `WorkflowCanvas.tsx` — the interactive DAG canvas (drag nodes, draw edges)
  - `NodePalette.tsx` — the node type palette (prompt, bash, script, loop, approval, command)
  - `NodeInspector.tsx` — properties panel for the selected node
  - `BuilderToolbar.tsx` — save, load, undo/redo, run, validate buttons
  - `ValidationPanel.tsx` — shows validation errors in real-time
  - `DagNodeComponent.tsx` — visual node on the canvas
  - `DagNodeProgress.tsx` — execution progress overlay on nodes
  - `YamlCodeView.tsx` — raw YAML editor view (toggle between visual and code)

- **Adaptations for Switch UI:**
  - Replace shadcn/ui imports with Switch UI's design system components
  - Apply Matrix theme (dark background, green accents, monospace fonts, glow effects)
  - Wire save/load to Switch UI's server API rather than Archon's filesystem
  - Remove conversations/project context dependencies

- **Location:** `hermes-switchui/src/components/conductor/`

- **B.1.1: View toggle**
  - "Flow" tab → DAG builder (interactive, for editing workflow definitions)
  - "Org" tab → 3-tier SVG hierarchy view (read-only, for active mission visualization)
  - Both share the Conductor route, toggle switches between them

- **B.1.2: Now Playing strip**
  - Shows live mission status from Kanban parent task
  - Elapsed time, active workers, token usage, stage badges
  - Abort button → cancel parent Kanban task
  - Pause button → block parent Kanban task
  - Real-time updates via SSE from Workstream A's event-emitter

- **B.1.3: Mission history rail (right side)**
  - Loads from `task_runs` + `task_events`
  - Grouped by day, status badges, token counts
  - Click past mission → load DAG in read-only mode

### B.2: Operations — Agent Team Management

**Goal:** The Operations page is built from Switch UI's existing design mockup. No Archon UI components are ported here. It consumes Workstream A's backend APIs for real data.

- **Design reference:** Operations.html mockup in `docs/Design Assets/Hermes-Switchui/`

- **Components to build (Switch UI-native):**
  - **Team Roster** — agent cards with avatar, status pulse, task, capacity bar, token usage
  - **Focus panel** — selected agent detail with hero, mission, activity timeline, tools, outputs
  - **Dispatch panel** — compose textarea, route mode, routing preview, estimated cost/time
  - **Team outputs strip** — horizontal artifact rail, filterable by type

- **Consumes Workstream A APIs:**
  - `GET /api/operations/agents` — roster data
  - `GET /api/operations/agents/:id` — focus detail
  - `GET /api/operations/agents/:id/activity` — timeline
  - `GET /api/operations/agents/:id/tools` — tool usage
  - `GET /api/operations/agents/:id/outputs` — artifacts
  - `GET /api/operations/outputs` — team feed
  - `POST /api/operations/dispatch` — compose and route a mission
  - SSE stream for real-time updates

### B.3: Settings Page (Provider Configuration)

**Goal:** A settings UI for configuring Claude Code and Codex binary paths, verifying installation, and setting workflow defaults.

- Where to find `CLAUDE_BIN_PATH` / `CODEX_BIN_PATH`
- Show installed version, connectivity status
- Default provider selection for workflow nodes
- This is a simple form, not a port from Archon

---

## Implementation Order

| Priority | Stream | Module | Depends On |
|---|---|---|---|
| **P0** | A | A.1 Core Engine Port | — |
| **P0** | A | A.2 Kanban Execution Adapter | A.1 |
| **P0** | B | B.1 Conductor DAG Builder | A.1 (for save/load) |
| **P1** | B | B.2 Operations Page | B.1 (shared patterns) |
| **P1** | A | A.3 Provider Port (Claude/Codex) | A.1 |
| **P2** | B | B.3 Settings Page | A.3 |
| **P3** | A | A.4 Cron Integration | A.2 |

**Parallel tracks:** A.1 + B.1 can start together (engine port doesn't block UI scaffold). A.3 is independent of the UI, can run alongside B.1/B.2. A.2 depends on A.1. B.2 depends on B.1's component patterns.

---

## Key Decisions

- **YAML is the source of truth** for workflow definitions. Archon keeps its own `~/.archon/archon.db` for provider config and run state. Hermes Kanban DB owns task execution. Separate DBs, two sync points: Kanban adapter + API routes.
- **Archon stays native.** We port source files, not npm packages. No runtime dependency on Archon packages. Port select files only — ~50 files total out of ~400.
- **No Archon chat UI.** Switch UI has its own chat. No Archon dashboard, layout, sidebar, or design system — Switch UI has its own.
- **Conductor = DAG builder (flow tab) + hierarchy view (org tab).** The DAG builder is ported from Archon and themed with Matrix styling.
- **Operations = built from scratch** using Switch UI's native components, consuming Workstream A APIs.
- **SSE drives real-time updates.** Event emitter from Workstream A feeds both Conductor and Operations.
