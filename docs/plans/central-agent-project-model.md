# Central Agent Project Model Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task. This plan supersedes the earlier single-boundary version by splitting the system into SwitchUI-owned product surfaces, a Hermes Agent plugin-backed backend extension, and an explicit future core-migration path.

**Goal:** Add a first-class project model so work is routed by explicit project identity instead of only by conversation context or current directory, while using the right boundary for each layer: SwitchUI for UX, a Hermes Agent plugin for backend integration, and Hermes core only if project identity proves foundational across every surface.

**Architecture:** Treat **Project** as durable identity and ownership context, and **Workspace** as execution location. Implement the product in three coordinated parts:

1. **SwitchUI part** — project registry UX, project selector, project-aware chat/session/task/swarm/dashboard views, project-aware API routes, and client/server state within `hermes-switchui`.
2. **Hermes Agent plugin part** — plugin-backed project services: project registry backend API/tooling, project-aware hooks, CLI/slash commands, dashboard plugin routes, and optional memory/task/session scoping helpers.
3. **Future Hermes core path** — only if the project concept proves universal enough to justify promotion into core runtime/session/memory/task abstractions.

**Tech Stack:** TypeScript, TanStack Start, React, Zustand, `src/routes/api/*` server routes, `src/server/*` helpers/stores, Hermes Agent plugin SDK (`plugin.yaml`, `register(ctx)`, hooks, dashboard plugin APIs), filesystem-backed state, gateway/dashboard proxy APIs.

---

## Research Summary

### Open question resolved

The previous version of this plan assumed the long-term home was Hermes Agent core, with Workspace acting as an incubator. After reviewing the Hermes Agent plugin architecture, the better near-term split is:

- **SwitchUI owns the user experience and local product model**.
- **A Hermes Agent plugin owns the backend extension seam** for project-aware tools, hooks, APIs, and dashboard surfaces.
- **Hermes core remains a later step**, not the starting point.

This gives us a practical path that does not require hard-forking Hermes Agent internals immediately, while still validating whether project identity deserves eventual promotion into core.

### Verified Hermes Agent plugin facts

Research confirmed Hermes Agent has a real plugin SDK in `hermes_cli/plugins.py` and supports:

- discovery from bundled, user, project, and pip entry-point sources
- `plugin.yaml` manifests with `name`, `version`, `kind`, `provides_tools`, `hooks`, `pip_dependencies`
- top-level `register(ctx)` entry point in `__init__.py`
- plugin kinds: `standalone`, `backend`, `exclusive`, `platform`
- `PluginContext` registration methods including:
  - `register_tool`
  - `register_hook`
  - `register_command`
  - `register_cli_command`
  - `register_platform`
  - `register_skill`
  - `register_context_engine`
  - `register_image_gen_provider`
  - `inject_message`
  - `dispatch_tool`
- 16 lifecycle hooks including:
  - `pre_tool_call`
  - `post_tool_call`
  - `pre_llm_call`
  - `post_llm_call`
  - `on_session_start`
  - `on_session_end`
  - `transform_terminal_output`
  - `transform_tool_result`
  - `pre_gateway_dispatch`
- dashboard/UI plugin APIs mounted under `/api/plugins/<name>/`
- existing bundled examples, especially the **kanban plugin**, which is the closest precedent for a backend stateful subsystem plus dashboard UI/plugin API

### Architectural conclusion

The project system should **not** start as a Hermes core invasive rewrite. It should also **not** remain purely a SwitchUI-local fiction if the agent must understand projects while executing work.

The right split is:

- **SwitchUI** defines and ships the first-class product experience.
- **A Hermes Agent plugin** provides the backend project-service layer.
- **Hermes core** is only touched after this model proves necessary across CLI, gateway, cron, sessions, memory, and multiple UIs.

---

## Product Decision

### Part A — SwitchUI product boundary

SwitchUI should own:

- project selector and active-project badge
- project-aware chat/session/run/task/swarm/dashboard UX
- project creation/edit flows
- disambiguation UI when path/cwd inference is ambiguous
- redacted path presentation
- frontend state and API contracts for `projectId`
- Workspace-side route handlers that talk to the backend project service

This is where the user sees and controls the concept.

### Part B — Hermes Agent plugin boundary

A Hermes Agent plugin should own:

- durable project registry backend and server-side validation
- project-aware tool endpoints and/or CLI commands
- dashboard plugin API routes, likely under `/api/plugins/projects/*`
- project-aware hooks for session/run/task/swarm/memory scoping where feasible without core changes
- slash commands and CLI commands such as project list/select/use/add
- optional helper tools for agents to inspect/set project context explicitly

This is where the agent runtime learns the concept without requiring immediate upstream core surgery.

### Part C — Hermes core boundary

Hermes core should only absorb the concept later if we prove that project identity must be universal across:

- CLI
- gateway
- API server
- cron
- sessions
- task systems
- memory providers
- swarm/worker orchestration
- future UI surfaces beyond SwitchUI

That promotion should be treated as a follow-up proposal/PR, not part of v1.

---

## Problem Statement

The central agent currently infers context too loosely from active conversation, current working directory, and swarm/runtime metadata. That works for single-project CLI usage, but it breaks down when one principal or one central runtime manages multiple projects, repositories, worktrees, workers, conversations, and task streams.

The system needs an explicit project identity that can travel with meaningful work:

- chat sessions and runs
- task records
- memory browsing and future memory writes
- swarm missions and kanban cards
- dashboard summaries
- operation/form submissions
- UI context selectors and badges
- agent/backend tooling and commands

---

## Core Model

- **Project:** durable identity and ownership context. Example: `hermes-switchui`, `operator1`, `tool-catalog`.
- **Workspace:** concrete execution location. Example: `/Volumes/Ext-nvme/Development/hermes-switchui`, a git worktree, or temp scratch path.
- **Run:** one execution instance bound to a session and optionally to a project/workspace.
- **Session:** conversation record that may have a selected/default project.
- **Task:** project-scoped user or agent work item.
- **Agent/Worker:** durable or swarm worker that may be assigned to one or more projects.

Important distinction:

```text
Project = what this work belongs to.
Workspace = where commands/files execute.
```

---

## Canonical `ProjectRef`

All API boundaries should converge on this shape or a close equivalent:

```ts
export type ProjectRef = {
  id: string
  displayName: string
  rootPath: string
  rootPathRedacted: string
  workspacePath?: string | null
  workspacePathRedacted?: string | null
  memoryNamespace: string
  taskNamespace: string
  contextFiles: Array<string>
  ownerUserId?: string | null
  schemaVersion: number
  createdAt: string
  updatedAt: string
}
```

Rules:

- `id` is stable and URL-safe.
- `rootPath` is server-side authoritative and must be validated.
- `rootPathRedacted` is what normal UI displays by default.
- Full paths may appear only in authenticated detail/settings views.
- `memoryNamespace` defaults to `project:${id}`.
- `taskNamespace` defaults to `project:${id}`.
- Existing legacy/global data may use `projectId: null` until migrated.

---

## Existing Surfaces To Inspect

### SwitchUI surfaces

#### Workspace/files

- `src/routes/api/workspace.ts`
- `src/routes/api/files.ts`
- `src/routes/api/preview-file.ts`
- `src/stores/workspace-store.ts`

#### Chat/session/run flow

- `src/routes/api/send-stream.ts`
- `src/routes/api/sessions.ts`
- `src/server/local-session-store.ts`
- `src/server/run-store.ts`
- `src/server/claude-api.ts`
- `src/server/claude-dashboard-api.ts`

#### Tasks/memory

- `src/server/tasks-store.ts`
- `src/routes/api/claude-tasks.ts`
- `src/server/memory-browser.ts`
- `src/server/swarm-memory.ts`

#### Swarm/gateway/dashboard

- `src/routes/api/swarm-project.ts`
  - Note: today this is a per-worker metadata snapshot (cwd, branch, changed files, preview URLs from `runtime.json` + `lsof`/port probe). It derives a "project name" ad-hoc as `basename(cwd)` and has no relation to the central project registry. **Follow-up (post-v1):** resolve worker `cwd` against the project registry to render a real `ProjectRef` badge on swarm worker cards instead of a basename. Low priority — not part of v1 task↔project linking.
- `src/routes/api/swarm-dispatch.ts`
- `src/server/swarm-missions.ts`
- `src/server/swarm-kanban-store.ts`
- `src/server/kanban-backend.ts`
- `src/routes/api/dashboard/overview.ts`

#### UI

- `src/screens/chat/chat-screen.tsx`
- `src/screens/chat/components/chat-header.tsx`
- `src/screens/chat/components/chat-composer.tsx`
- `src/stores/workspace-store.ts`
- `src/stores/task-store.ts`
- `src/stores/mission-store.ts`
- `src/stores/agent-swarm-store.ts`

### Hermes Agent plugin surfaces

Use the plugin system, not ad-hoc patches to unrelated runtime files, wherever possible.

Inspect/reference:

- `hermes_cli/plugins.py`
- plugin manifests: `plugins/*/plugin.yaml`
- plugin entrypoints: `plugins/*/__init__.py`
- dashboard plugin API patterns: `plugins/kanban/dashboard/plugin_api.py`
- existing plugin examples for tools/hooks/CLI registration

Planned plugin capabilities:

- project registry service
- dashboard/API routes under `/api/plugins/projects/*`
- project tools (`project_list`, `project_get`, `project_select`, etc.)
- slash/CLI commands
- session/task/run/memory scoping hooks where viable

---

## Three-Part Implementation Plan

## Part 1 — SwitchUI project capabilities

### Task 1: Define shared project types and Workspace-facing API contract

**Objective:** Establish the local product contract before implementation spreads across the app.

**Files:**

- Create: `src/lib/projects.ts`
- Create: `src/lib/projects-api.ts`
- Create tests near new modules
- Inspect: `src/lib/gateway-api.ts`, existing route client patterns

**Requirements:**

- Define `ProjectRef`, `ProjectSelection`, and project-aware request/response types.
- Add optional `projectId` and `project` metadata shapes used by chat/session/task/swarm/dashboard surfaces.
- Keep `projectId` optional for legacy compatibility.
- Ensure the client contract targets a backend project service rather than embedding registry logic in UI-only code.

**Verification:**

- Typecheck succeeds.
- Existing consumers do not break when project metadata is absent.

---

### Task 2: Add Workspace proxy routes for projects

**Objective:** Give SwitchUI stable app-owned endpoints while allowing the backend source of truth to live in Hermes Agent plugin services.

**Files:**

- Create: `src/routes/api/projects.ts`
- Create: `src/routes/api/projects.select.ts` or equivalent route pattern
- Modify: `src/routes/api/workspace.ts`
- Add route tests

**Requirements:**

- `GET /api/projects` returns redacted project refs.
- `POST /api/projects` creates/updates via backend project service.
- `POST /api/projects/select` persists active selection in the appropriate Workspace/session preference path.
- `GET /api/workspace` returns both current workspace and selected project when known.
- Do not leak full root paths in normal responses.
- Do not let project selection silently mutate cwd.

**Verification:**

- Route tests cover list/create/select/error cases.
- Workspace route degrades gracefully if plugin backend is unavailable.

---

### Task 3: Add project resolution in SwitchUI request flow

**Objective:** Resolve the effective project for UI requests using explicit selection first, inference only as fallback.

**Files:**

- Create: `src/server/project-resolution.ts`
- Create: `src/server/project-resolution.test.ts`
- Modify: route handlers that need project-aware behavior

**Resolution order:**

1. Explicit `projectId` from request payload.
2. Session metadata project.
3. Run/task/mission metadata project.
4. Active UI/client selected project.
5. Safe cwd/root containment fallback.
6. Ambiguous/unknown → low confidence result requiring user disambiguation.

**Requirements:**

- Explicit selection always wins.
- Ambiguous path inference must not silently route work.
- Nested repos and overlapping roots must be tested.
- Legacy/null project remains valid.

---

### Task 4: Thread `projectId` through chat/session/run flow in SwitchUI

**Objective:** Make project identity part of the real data path before UI polish.

**Files:**

- Modify: `src/routes/api/send-stream.ts`
- Modify: `src/routes/api/sessions.ts`
- Modify: `src/server/local-session-store.ts`
- Modify: `src/server/run-store.ts`
- Modify/inspect: `src/server/claude-api.ts`
- Modify/inspect: `src/server/claude-dashboard-api.ts`

**Requirements:**

- Accept optional `projectId` in chat/send payloads.
- Persist `projectId` on run records and session summaries where available.
- Restore project context correctly when switching sessions.
- Keep legacy sessions readable.
- Do not treat unknown client-provided IDs as trusted until resolved.

**Acceptance tests:**

- A new run with `projectId` stores and restores it.
- A legacy session with no `projectId` still opens cleanly.
- Two sessions can keep different active projects.

---

### Task 5: Scope Workspace task, memory, and swarm views by project

**Objective:** Prevent cross-project bleed in product surfaces even before deeper Hermes-core adoption.

**Files:**

- Modify: `src/server/tasks-store.ts`
- Modify: `src/routes/api/claude-tasks.ts`
- Modify: `src/server/memory-browser.ts`
- Modify: `src/server/swarm-memory.ts`
- Modify: `src/server/swarm-missions.ts`
- Add tests near affected modules

**Requirements:**

- Add optional `projectId` / namespace fields to Workspace-side records where they exist.
- Filter task/memory/swarm views by selected project when backend capability exists.
- Preserve legacy/global records with `projectId: null`.
- If the backend cannot guarantee true memory isolation yet, expose partial capability honestly instead of pretending full isolation exists.

---

### Task 6: Add UI selector, badges, and disambiguation flows

**Objective:** Make the active project visible and controllable in SwitchUI.

**Files:**

- Modify: `src/stores/workspace-store.ts`
- Modify: `src/screens/chat/chat-screen.tsx`
- Modify: `src/screens/chat/components/chat-header.tsx`
- Modify: `src/screens/chat/components/chat-composer.tsx`
- Modify related task/swarm screens as needed

**UI behavior:**

- Show active project display name in chat/header/composer/task/swarm context.
- Prefer redacted path or basename in normal UI.
- Full path only in authenticated detail/settings views.
- Low-confidence routing triggers a project picker, not silent inference.
- Session-specific project state should remain independent between conversations.

---

## Part 2 — Hermes Agent plugin-backed project services

### Task 7: Create Hermes project plugin skeleton and manifest

**Objective:** Establish the official backend extension point.

**Plugin shape:**

- plugin directory in the appropriate Hermes plugin location for development
- `plugin.yaml`
- `__init__.py` with `register(ctx)`
- optional dashboard plugin API module(s)
- optional shared storage/service module(s)

**Recommended manifest direction:**

- start as `standalone` for explicit opt-in during development
- consider `backend` only if this becomes a bundled default subsystem

**Requirements:**

- Register cleanly through Hermes plugin discovery.
- Document install/load path for local development against SwitchUI.
- Add minimal smoke test proving the plugin loads and registers.

---

### Task 8: Implement plugin-backed project registry service

**Objective:** Move durable server-side project ownership to Hermes-side services rather than burying it inside SwitchUI state.

**Responsibilities:**

- persist project registry
- validate and normalize paths/ids/namespaces
- produce redacted and privileged detail views
- support schema versioning and future migrations

**Requirements:**

- Reuse existing workspace/path validation semantics where possible.
- Normalize `memoryNamespace` and `taskNamespace` to `project:${id}` by default.
- Reject blocked/sensitive roots.
- Handle symlink/realpath cases consistently.
- Return safe redacted payloads by default.

**Design note:**

The storage can begin plugin-local, but do not make it impossible to promote later into Hermes core if the concept graduates.

---

### Task 9: Expose plugin API routes for project services

**Objective:** Give SwitchUI and other future consumers a proper Hermes-owned API surface.

**Recommended shape:**

- `/api/plugins/projects/list`
- `/api/plugins/projects/get`
- `/api/plugins/projects/upsert`
- `/api/plugins/projects/select`
- `/api/plugins/projects/resolve`
- optional capability/introspection endpoint

**Requirements:**

- Follow the dashboard/plugin API pattern used by existing plugins such as kanban.
- Distinguish safe redacted responses from privileged detail responses.
- Return explicit ambiguity/confidence data for resolver endpoints.
- Make failures actionable for SwitchUI proxy routes.

---

### Task 10: Register project-aware tools, slash commands, and CLI commands

**Objective:** Let the agent runtime work with projects explicitly, not only through UI-side metadata.

**Potential registrations:**

- tools:
  - `project_list`
  - `project_get`
  - `project_select`
  - `project_resolve`
- slash commands:
  - `/project`
  - `/project-use`
- CLI commands:
  - `hermes project list`
  - `hermes project use <id>`
  - `hermes project add`

**Requirements:**

- The agent can inspect current project context and switch it deliberately.
- Commands should not silently mutate cwd unless explicitly designed to do so.
- Tool results should be safe for gateway/UI display.

---

### Task 11: Add plugin hooks for project-aware execution context

**Objective:** Thread project identity into runtime behavior without invasive core edits where hooks are sufficient.

**Likely hooks to evaluate:**

- `on_session_start`
- `pre_tool_call`
- `post_tool_call`
- `pre_llm_call`
- `post_llm_call`
- `pre_gateway_dispatch`
- `transform_tool_result`
- `transform_terminal_output`

**Use cases:**

- attach active project context to session metadata
- block or warn when a project-scoped operation is ambiguous
- annotate tool results with project identity where useful
- inject concise project context into the active conversation only when appropriate

**Guardrails:**

- do not bloat every prompt with verbose project payloads
- do not fake isolation where the underlying subsystem cannot enforce it
- avoid hook behavior that surprises non-project workflows

---

### Task 12: Add plugin dashboard surfaces and capability reporting

**Objective:** Give Hermes-side observability and admin surfaces to the project subsystem.

**Potential surfaces:**

- project registry browser
- project detail view
- project capability status (sessions/tasks/memory/swarm support level)
- ambiguity/conflict diagnostics
- active project/session mappings

**Requirements:**

- Follow existing dashboard plugin conventions.
- Make it easy for SwitchUI developers to verify backend project state.
- Expose partial-support truthfully, especially for memory/session scoping that may still be transitional.

---

## Part 3 — Future Hermes core migration path

### Task 13: Document graduation criteria for core adoption

**Objective:** Avoid premature core surgery while making the promotion path explicit.

Promote from plugin to Hermes core only if most of the following become true:

- project identity is required across CLI, gateway, API server, cron, sessions, memory, and multiple UIs
- plugin hooks are insufficient or too fragile for correct scoping
- multiple plugins/tools need the same shared project primitive
- project-aware session identity becomes a foundational runtime concern
- memory/task/session persistence needs a universal schema rather than plugin-specific sidecars

**Deliverable:**

- a documented checklist inside this plan or a follow-up upstream proposal

---

### Task 14: Prepare upstream proposal / core PR plan

**Objective:** Convert validated product evidence into a Hermes-core design only when warranted.

**Likely upstream targets if promoted:**

- session metadata schema
- run/task persistence abstractions
- API server/gateway session routing
- memory-provider interfaces
- cron/session context propagation
- slash-command/core command registry defaults

**Relevant upstream discussions to reference:**

- `#10309` — session-scoped repo pinning
- `#18457` — cross-surface session continuity and higher-level project concept
- `#2058` — context anchors / persistent project memory
- `#9514` — multi-agent daemon and workspace/memory isolation
- `#681` / `#502` — `.hermes.md` project config
- `#531` — global workspace RAG store
- `#14471`, `#14510`, PR `#4098`, PR `#10482`, PR `#12255` — workspace/context-file boundary issues

---

## Acceptance Matrix

The full system should eventually support these cases cleanly:

- two projects in one Hermes profile
- one project with two workspaces/worktrees
- one conversation mentioning multiple projects without silent misrouting
- ambiguous cwd causing disambiguation instead of guessed routing
- no cross-project task leakage
- no cross-project swarm leakage
- honest memory scoping behavior, with real isolation only where supported
- legacy sessions/tasks/runs still readable with `projectId: null`
- normal UI uses redacted paths
- SwitchUI can function when plugin services are present, and degrade gracefully when unavailable
- agent can explicitly inspect/select project context through plugin tools/commands

---

## Security and Privacy Requirements

- Never expose full local paths in normal UI by default.
- Validate project roots against existing workspace path rules.
- Treat project IDs from client requests as untrusted until resolved through the registry.
- Avoid cross-project task/memory/session leakage.
- Include owner/user/session authorization fields in `ProjectRef` or surrounding persistence if multi-user mode is enabled later.
- Redact path-like values in dashboard and project summaries unless the view is explicitly privileged.

---

## Backward Compatibility Requirements

- Existing sessions with no `projectId` must remain readable.
- Existing runs with no `projectId` must remain readable.
- Existing tasks/memory views with no project metadata must remain valid.
- APIs must tolerate missing `projectId` fields.
- Initial migration should prefer `projectId: null` over unsafe guessed assignment.

---

## Commit Protocol Note

Before implementation, confirm and follow the repo’s current commit protocol from `CLAUDE.md` / project lore. Do not blindly use placeholder commit messages if the repo requires Lore-formatted commits.

---

## Execution Note

Implement this incrementally. Do not retrofit the entire system in one pass.

Recommended order:

1. SwitchUI contract and proxy routes
2. Hermes project plugin skeleton and registry service
3. chat/session/run threading
4. task/memory/swarm scoping
5. UI selector/badges/disambiguation
6. plugin tools/commands/hooks
7. evaluate whether any part truly needs core promotion

That sequence keeps the product moving while preserving the future migration path. Follow the white rabbit.