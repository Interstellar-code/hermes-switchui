# Archon-Hermes Integration Plan — Conductor & Operations

> **Status:** Planning doc — ready for execution review

**Goal:** Integrate Archon's YAML workflow engine into Hermes Switch UI, using the new Conductor and Operations page designs as the visual frontend, and the Hermes Kanban as the execution runtime. Keep Archon native — the YAML workflow engine, Claude Code/Codex providers, and drag-and-drop DAG builder come as-is. Switch UI adds the Conductor/Operations UI surfaces and Kanban-backed execution.

**Architecture principle:** Archon defines workflows (YAML). Kanban runs them (tasks). Switch UI shows them (Conductor/Operations). Claude Code and Codex work through Archon's existing providers — no reimplementation needed.

---

## Phase 1: Conductor Page — Interactive DAG Builder

**Goal:** Replace the static SVG DAG in Conductor.html with the interactive Archon Workflow Builder. The "flow" tab shows the Archon DAG editor. The "org" tab retains the current 3-tier hierarchy view.

### Task 1.1: Port the Archon DAG editor component
- Extract the drag-and-drop DAG editor from Archon's web UI (`@archon/web/src/components/workflow/`)
- Port the node palette, canvas, edge-drawing, and property panel components
- Map Archon's node types to visual elements: prompt, bash, script, loop, approval, command
- Preserve the Matrix theme styling (dark background, green accents, monospace fonts)

### Task 1.2: Wire DAG editor to YAML filesystem
- The editor reads/writes `.archon/workflows/*.yaml` on the server
- Save button → writes YAML to the user's project or Hermes workspace
- Load button → reads YAML, renders in the canvas
- The YAML format is 100% Archon-native — no Hermes-specific extensions

### Task 1.3: "Now Playing" strip live data
- Replace the static mission info with data from the current running Kanban parent task
- Show: elapsed time, active workers, token usage, stage badges
- The "abort" button calls Kanban cancel on the parent task
- The "pause" button calls Kanban block on the parent task

### Task 1.4: Right rail — Mission history from task_runs
- Replace the mock history with real data from `task_runs` + `task_events`
- Group by day, show status (completed/failed/running), token count
- Click a past mission → load its DAG into the canvas (read-only mode)

### Task 1.5: View toggle — flow vs org
- "Flow" tab → Archon DAG editor (interactive, for editing workflow definitions)
- "Org" tab → current 3-tier SVG view (read-only, for visualizing active missions)
- Both views share the same route; the toggle switches between them

---

## Phase 2: Operations Page — Agent Roster & Dispatch

**Goal:** Replace the mock data in Operations.html with real Hermes agent state and a working dispatch pipeline. The roster shows real agents. The focus panel shows real-time mission detail. The dispatch panel actually routes work.

### Task 2.1: Team Roster from real agent data
- Read from `~/.hermes/agents.db` (persona/agent registry) + Kanban task assignments
- Show: avatar, name, role (orchestrator/worker), current task, capacity bar, token usage, status pulse (live/idle/blocked/error)
- Agent list is sorted by status: live first, then idle, then error
- Click an agent → focus panel shows their detail

### Task 2.2: Focus panel — selected agent detail
- Hero section with large avatar, name, status badge, model, profile, tools loaded
- Quick actions: open chat, configure, pause
- Grid panels:
  - **Current mission** — reads from Kanban tasks assigned to this agent
  - **Activity timeline** — reads from `task_events` for this agent's recent tasks
  - **Tools used** — aggregates tool call stats from recent task runs
  - **Outputs** — files produced by this agent's task runs

### Task 2.3: Dispatch panel — compose & route
- Compose textarea + pills (priority, budget, deadline, tags)
- Route mode toggle: auto (router picks best agent), broadcast (all agents), manual (user picks)
- **Routing preview** — when user types a mission, call the Archon router to decompose it into steps, show each step with confidence score and estimated cost/time
- "Dispatch" button → creates a Kanban parent task with linked children, promotes to `ready`
- "Save draft" → saves the mission text as a YAML workflow draft

### Task 2.4: Team outputs strip
- Horizontal scrolling rail of real Kanban task outputs (files created, summaries, results)
- Read from `task_runs.summary` and `task_runs.outcome`
- Filterable by type: all, code, docs, data, media
- Click a card → open the output in a detail view

---

## Phase 3: Archon Workflow Engine — Kanban Adapter

**Goal:** Build the bridge between Archon's YAML workflow engine and Hermes Kanban. When a workflow runs inside Switch UI, the DAG nodes materialize as Kanban tasks. Auto-promotion via `task_links`.

### Task 3.1: Kanban-dispatched workflow runner
- Create a Hermes Agent skill: `archon-workflow-runner`
- Input: workflow YAML path, optional variable overrides
- Process:
  1. Load and parse the YAML via Archon's `parseWorkflow()`
  2. Create a Kanban parent task with metadata pointing to the YAML
  3. For each node in the DAG, create a child task linked via `task_links`
  4. Set the first-layer nodes (zero deps) to `ready`
  5. Subscribe to Kanban task completion events
  6. When a child task completes, check `task_links` for downstream nodes whose deps are all done → flip them to `ready`
  7. Handle loop nodes by re-creating child tasks until the completion signal
  8. Handle approval nodes by setting the task to `blocked` status — human unblocks via the Conductor page

### Task 3.2: Node type → task mapping
| Archon Node Type | Kanban Mapping |
|---|---|
| `prompt:` | Task with `skills: ['archon-prompt-worker']`, content in `body` |
| `bash:` | Task with `skills: ['archon-bash-worker']`, script in `body` |
| `script:` | Task with `skills: ['archon-script-worker']`, code + runtime in `body` |
| `loop:` | Parent task with children for each iteration, re-created until done |
| `approval:` | Task set to `status: 'blocked'`, unblocked via Conductor UI |
| `command:` | Task that loads a named command file from `.archon/commands/` |

For Claude Code / Codex node execution: the task dispatches with the appropriate skill that calls the Archon provider SDK. The YAML stays unchanged — Archon's `IAgentProvider` handles Claude Code and Codex natively.

### Task 3.3: Auto-promotion engine
- Lightweight daemon (or cron-based) that watches Kanban for completed tasks
- On completion: reads `task_links`, checks if all upstream deps of any child are done
- If yes: promotes child from `triage` → `ready`
- If no (loop/approval): sends notification to Conductor page via SSE
- Edge cases: cycle detection (prevent infinite loops beyond `max_iterations`), failure propagation (if a dep fails, downstream nodes get `blocked` with reason), timeout handling

### Task 3.4: Variable substitution bridge
- Archon's `$nodeId.output` references the output of another node
- In Kanban terms: `$task_id.output` = `task_runs.summary` or `task.result`
- The auto-promotion engine substitutes these values when creating downstream tasks
- Support: `$WORKFLOW_ID`, `$ARTIFACTS_DIR`, `$1`, `$ARGUMENTS`, `$LOOP_USER_INPUT`

---

## Phase 4: Claude Code & Codex Integration (Free via Archon)

**Goal:** Claude Code and Codex work through Archon's existing `IAgentProvider` implementations. No reimplementation needed — the YAML workflow engine already calls them.

### Task 4.1: Archon provider configuration in Switch UI
- Add a settings panel to configure Claude Code (`CLAUDE_BIN_PATH`) and Codex providers
- Read/write `.archon/config.yaml` via the same mechanism Archon uses
- Show provider status (installed, version, available models)

### Task 4.2: Workflow routing — Hermes vs Claude Code vs Codex
- When a workflow node runs, the router picks the provider based on:
  - Explicit `provider:` field in the YAML node
  - Workflow-level `provider:` default
  - `.archon/config.yaml` `assistant` default
- If the provider is `hermes`: use Kanban dispatch with `delegate_task`
- If the provider is `claude` or `codex`: use Archon's provider SDK
- The Conductor page shows which provider each node is routed to

### Task 4.3: Archon skill installation
- Add a "Setup Archon" flow in Switch UI that:
  1. Checks if Archon is installed (`archon --version`)
  2. If not, prompts to install via the quick-install script
  3. Configures `.archon/config.yaml` with Hermes as a provider
  4. Copies any missing default workflows to `.archon/workflows/defaults/`
  5. Verifies Claude Code / Codex connectivity

---

## Phase 5: Cron & Time-Based Triggers

**Goal:** Wire Hermes cron jobs to trigger Archon workflows. A cron job fires → invokes a workflow YAML → the workflow materializes as Kanban tasks → the team executes them → results delivered back.

### Task 5.1: Cron → workflow binding
- Extend the cron job creation UI to let users pick a workflow YAML as the action
- When the cron fires, it calls the Kanban-dispatched workflow runner (Phase 3)
- The cron output is the workflow run's summary

### Task 5.2: Scheduled workflow runs
- Workflow YAMLs can have an optional `schedule:` field (cron expression)
- On load, the Conductor page registers these with Hermes cron
- The Operations page shows upcoming scheduled runs in a calendar/timeline view

---

## Phase 6: Conductor & Operations — From Mockup to Live

**Goal:** Wire the Conductor and Operations React components to real data sources. The mockups are done; now the data flows.

### Task 6.1: Conductor — API routes
- `GET /api/conductor/missions` — list active/past Kanban parent tasks with workflow metadata
- `GET /api/conductor/missions/:id/dag` — load the DAG structure from `task_links`
- `POST /api/conductor/dispatch` — accept a mission description, invoke the Archon router, create Kanban task group
- `POST /api/conductor/missions/:id/cancel` — abort running mission (cancel all child tasks)
- `POST /api/conductor/missions/:id/approve` — unblock a blocked approval node
- `GET /api/conductor/missions/:id/history` — mission event history for the right rail

### Task 6.2: Operations — API routes
- `GET /api/operations/agents` — list all agents with status, current task, capacity
- `GET /api/operations/agents/:id` — detail for the focus panel
- `GET /api/operations/agents/:id/activity` — timeline events
- `GET /api/operations/agents/:id/tools` — aggregated tool usage
- `GET /api/operations/agents/:id/outputs` — artifacts produced
- `GET /api/operations/outputs` — team-wide output feed for the bottom strip
- `POST /api/operations/dispatch` — compose and dispatch a mission

### Task 6.3: SSE streaming
- The Conductor "now playing" strip updates in real-time via SSE events from running workflows
- The Operations agent roster pulses update when agent status changes
- SSE events: `mission_updated`, `task_completed`, `agent_status_changed`, `output_produced`

---

## Implementation Order

| Phase | Priority | Why This Order |
|---|---|---|
| **Phase 3** (Kanban adapter) | P0 | Foundation — without it, nothing connects to real data |
| **Phase 1** (Conductor page) | P1 | The visual DAG builder is the marquee feature |
| **Phase 2** (Operations page) | P1 | Agent roster and dispatch need the adapter first |
| **Phase 4** (Claude Code/Codex) | P2 | Free integration — works out of the box once Archon is wired |
| **Phase 5** (Cron triggers) | P3 | Nice-to-have after the core loop works |
| **Phase 6** (Live data wiring) | P0 | This is the final mile — hooking mockups to real APIs |

---

## Key Decisions

- **YAML is the source of truth** for workflow definitions. Kanban is the execution runtime, not the definition store.
- **Archon stays native.** No forking Archon's codebase. We import/consume it as a dependency. This ensures Claude Code/Codex providers and future Archon features work without maintenance burden.
- **Archon DB strategy: separate SQLite.** Archon manages its own `~/.archon/archon.db` for workflow run state, provider config, and session tracking. The Hermes Kanban DB owns task execution state. The two DBs don't merge — the Kanban adapter (Phase 3) is the translation layer between them. This keeps Archon upgradeable independently.
- **Conductor = workflow editor + live mission view.** The two tabs (flow/org) reflect two modes: editing definitions vs watching execution.
- **Operations = agent team management.** Roster → select → focus → dispatch. The bottom strip is the team's artifact stream.
- **SSE drives real-time updates.** No polling. The Conductor and Operations pages subscribe to Hermes gateway events.
