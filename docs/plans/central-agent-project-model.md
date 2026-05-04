# Central Agent Project Model Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task. This plan has been revised after Codex review; do not use the older 6-task version.

**Goal:** Add a first-class project model to the central agent so work is routed by explicit project identity instead of only by conversation context or current directory.

**Architecture:** Introduce a durable `ProjectRegistry` as the canonical source of truth for project identity. A project owns context, memory namespace, task namespace, and display identity; a workspace remains an execution location such as a cwd, worktree, or scratch directory. Every chat run, session, task, swarm mission, dashboard aggregation, and operation should carry a `projectId` when it belongs to a project, with a backward-compatible `null`/`legacy` path for existing data.

**Tech Stack:** TypeScript, TanStack Start, `src/routes/api/*` server routes, `src/server/*` stores/helpers, Zustand client state, Hermes gateway/dashboard proxy APIs, filesystem-backed profile state.

---

## Codex Review Summary

**Verdict:** Approve with changes.

The concept is correct, but the previous plan was too abstract and referenced stale paths. This repo does not currently have a first-class `/api/projects` API. It has project-like surfaces, notably `/api/swarm-project`, but that endpoint only reports a swarm worker's current cwd/git preview. It is not a durable project registry.

Critical corrections from review:

- Use real workspace surfaces: `src/routes/api/*`, `src/server/tasks-store.ts`, `src/server/memory-browser.ts`, `src/server/run-store.ts`, swarm stores, and UI stores.
- Thread `projectId` through `send-stream.ts`, sessions, local sessions, persisted runs, tasks, memory, swarm missions, kanban, and dashboard APIs before relying on UI labels.
- Reuse existing workspace/path validation logic instead of bypassing `/api/workspace` semantics.
- Do not expose full root paths by default. Normal UI should use redacted/display paths.
- Existing data must remain readable: legacy sessions/tasks/runs without `projectId` must map to `projectId: null` or a `legacy` project contract.

---

## Strategic Rollout: Workspace First, Hermes Agent Core Later

This plan intentionally starts in **Hermes Workspace** as a proof-of-concept, not as the final system boundary.

The current implementation target is Workspace because it can prove the product model quickly:

- `/api/projects` registry owned by Workspace
- project selector/badge in the UI
- `projectId` threaded through Workspace chat/session/run/task/swarm surfaces where possible
- redacted path display and legacy/null fallback behavior
- practical UX for project disambiguation

However, a durable project concept should eventually move into **Hermes Agent core**. If the Workspace implementation proves the model, use it as evidence for a Hermes Agent feature request or PR that proposes:

- core project registry in Hermes state
- project-scoped sessions/runs/memory/tasks
- CLI commands such as `/project`, `hermes project list`, `hermes project use`, `hermes project add`
- project identity shared consistently across CLI, gateway, cron, Workspace, memory backends, and future UIs

Relevant Hermes Agent upstream discussions to reference when preparing that follow-up:

- `#10309` — session-scoped repo pinning; closest existing proposal, but session-level rather than durable project-level
- `#18457` — cross-surface session continuity; explicitly mentions a higher-level project concept
- `#2058` — context anchors / persistent project memory; related but file-centric
- `#9514` — single-daemon multi-agent with per-topic workspace and memory isolation
- `#681` / `#502` — `.hermes.md` project config; cwd/git-root context injection, not durable project identity
- `#531` — global `~/.hermes/workspace` document/RAG store, complementary but not project-scoped
- `#14471`, `#14510`, PR `#4098`, PR `#10482`, PR `#12255` — context-file discovery and workspace-boundary issues

In short: **Workspace is the incubator; Hermes Agent core is the long-term home.** Once this plan is implemented and validated in Workspace, create a second plan or upstream proposal for the Hermes Agent core changes.

---

## Problem Statement

The central agent currently infers context too loosely from active conversation, current working directory, and swarm/runtime metadata. That works for single-project CLI usage, but it becomes confusing when one central agent manages multiple projects, folders, worktrees, conversations, workers, and ongoing tasks.

The system needs an explicit project identity that travels with meaningful work:

- chat sessions and runs
- task records
- memory browsing and future memory writes
- swarm missions and kanban cards
- dashboard summaries
- operation/form submissions
- UI context selectors and badges

---

## Core Model

- **Project:** durable identity and ownership context. Example: `hermes-workspace`, `operator1`, `tool-catalog`.
- **Workspace:** concrete execution location. Example: `/Volumes/Ext-nvme/Development/hermes-workspace`, a git worktree, or temp scratch path.
- **Run:** one execution instance bound to a session and optionally to a project/workspace.
- **Session:** conversation record that may have a selected/default project.
- **Task:** project-scoped user work item. Existing global tasks remain valid during migration.
- **Agent/Worker:** durable or swarm worker that may be assigned to one or more projects.

Important distinction:

```text
Project = what this work belongs to.
Workspace = where commands/files execute.
```

---

## Canonical `ProjectRef`

All APIs should converge on this shape or a close equivalent:

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
- Full paths may appear only in authenticated settings/detail views.
- `memoryNamespace` defaults to `project:${id}`.
- `taskNamespace` defaults to `project:${id}`.
- Existing legacy/global data may use `projectId: null` until migrated.

---

## Current Related Surfaces

There is no durable project API yet. Relevant existing surfaces to inspect/modify:

### Workspace/files

- `src/routes/api/workspace.ts`
- `src/routes/api/files.ts`
- `src/routes/api/preview-file.ts`
- `src/stores/workspace-store.ts`

### Chat/session/run flow

- `src/routes/api/send-stream.ts`
- `src/routes/api/sessions.ts`
- `src/server/local-session-store.ts`
- `src/server/run-store.ts`
- `src/server/claude-api.ts`
- `src/server/claude-dashboard-api.ts`

### Tasks/memory

- `src/server/tasks-store.ts`
- `src/routes/api/claude-tasks.ts`
- `src/server/memory-browser.ts`
- `src/server/swarm-memory.ts`

### Swarm/gateway/dashboard

- `src/routes/api/swarm-project.ts`
- `src/routes/api/swarm-dispatch.ts`
- `src/server/swarm-missions.ts`
- `src/server/swarm-kanban-store.ts`
- `src/server/kanban-backend.ts`
- `src/routes/api/dashboard/overview.ts`

### UI

- `src/screens/chat/chat-screen.tsx`
- `src/screens/chat/components/chat-header.tsx`
- `src/screens/chat/components/chat-composer.tsx`
- `src/stores/workspace-store.ts`
- `src/stores/task-store.ts`
- `src/stores/mission-store.ts`
- `src/stores/agent-swarm-store.ts`

---

## Implementation Tasks

### Task 1: Add project registry schema, persistence, validation, and redaction

**Objective:** Create the canonical server-side project registry and tests.

**Files:**

- Create: `src/server/project-registry.ts`
- Create: `src/server/project-registry.test.ts`
- Reuse/inspect: `src/routes/api/workspace.ts`

**Implementation notes:**

- Persist registry under active Hermes/workspace profile state, not inside a random project cwd.
- Reuse existing workspace path allow/block semantics where possible.
- Validate roots with realpath/symlink handling.
- Redact full paths for normal UI responses.
- Support schema versioning for future migrations.

**Test cases:**

- Requires `id`, `displayName`, and valid `rootPath`.
- Normalizes namespaces to `project:<id>`.
- Rejects blocked/sensitive paths.
- Handles symlinked roots consistently.
- Produces redacted display paths.
- Reads empty registry as `[]` without crashing.

**Verification:**

```bash
pnpm vitest run src/server/project-registry.test.ts -v
```

---

### Task 2: Add `/api/projects` and extend `/api/workspace`

**Objective:** Expose project list/create/update/select APIs while keeping workspace and project concepts separate.

**Files:**

- Create: `src/routes/api/projects.ts`
- Modify: `src/routes/api/workspace.ts`
- Test: `src/routes/api/-projects.test.ts`
- Update capability plumbing if needed: `src/server/gateway-capabilities.ts`, `src/lib/feature-gates.ts`

**API shape:**

- `GET /api/projects` → list redacted project refs
- `POST /api/projects` → create/update project
- `POST /api/projects/select` or equivalent → set active project preference
- `GET /api/workspace` should expose both current workspace and selected project when known

**Rules:**

- Normal responses must not leak full paths unless explicitly requested by an authenticated detail endpoint.
- Project selection should not mutate cwd by itself.
- Workspace selection should not silently change project identity unless resolution is confident.

**Verification:**

```bash
pnpm vitest run src/routes/api/-projects.test.ts src/routes/api/-workspace.test.ts -v
```

---

### Task 3: Add project resolution logic

**Objective:** Resolve active project from explicit input, session/run/task/mission metadata, or safe cwd containment fallback.

**Files:**

- Create: `src/server/project-resolution.ts`
- Create: `src/server/project-resolution.test.ts`
- Use registry from: `src/server/project-registry.ts`

**Resolution order:**

1. Explicit `projectId` from request payload.
2. Session metadata project.
3. Run/task/mission metadata project.
4. Active UI/client selected project.
5. Cwd/root containment fallback.
6. Ambiguous/unknown → return low confidence and require disambiguation.

**Test cases:**

- Explicit project wins.
- Session metadata beats cwd.
- Task/mission metadata resolves project.
- Nested repos do not select parent incorrectly.
- Symlink paths resolve safely.
- Duplicate/overlapping roots return ambiguous.
- Legacy/null project remains valid.

**Verification:**

```bash
pnpm vitest run src/server/project-resolution.test.ts -v
```

---

### Task 4: Thread `projectId` through chat sessions, send-stream, local sessions, and persisted runs

**Objective:** Make project identity part of the actual chat/run path before adding visible UI affordances.

**Files:**

- Modify: `src/routes/api/send-stream.ts`
- Modify: `src/routes/api/sessions.ts`
- Modify: `src/server/local-session-store.ts`
- Modify: `src/server/run-store.ts`
- Modify/inspect: `src/server/claude-api.ts`
- Modify/inspect: `src/server/claude-dashboard-api.ts`

**Requirements:**

- Accept optional `projectId` in chat/send payloads.
- Persist `projectId` on run records.
- Include `projectId` in session summaries where available.
- Keep legacy sessions readable when `projectId` is absent.
- Do not send invalid/unknown project IDs to Hermes backend as if trusted.

**Acceptance tests:**

- A new chat run with `projectId` stores it in run metadata.
- A legacy session without `projectId` still opens.
- Switching sessions restores their project context independently.

---

### Task 5: Scope tasks and memory with backward-compatible migration behavior

**Objective:** Ensure project-bound work does not leak into global task/memory views.

**Files:**

- Modify: `src/server/tasks-store.ts`
- Modify: `src/routes/api/claude-tasks.ts`
- Modify: `src/server/memory-browser.ts`
- Modify: `src/server/swarm-memory.ts`
- Test: `src/server/project-scoping.test.ts`

**Requirements:**

- Add optional `projectId` / `taskNamespace` to task records.
- Filter task views by project when a project is selected.
- Preserve existing `~/.hermes/tasks.json` records with no project.
- Memory browser must support project namespace filtering when backend data supports it.
- Avoid claiming memory isolation if the backend cannot enforce it yet; expose capability/partial state honestly.

**Acceptance tests:**

- Two projects can have tasks with the same title without mixing.
- Legacy tasks still appear in global/legacy view.
- Project memory filter does not show another project's namespace.

---

### Task 6: Scope swarm missions, dispatch, kanban, checkpoint, and swarm memory events

**Objective:** Bring swarm/agent orchestration into the same project model.

**Files:**

- Modify: `src/routes/api/swarm-project.ts`
- Modify: `src/routes/api/swarm-dispatch.ts`
- Modify: `src/server/swarm-missions.ts`
- Modify: `src/server/swarm-kanban-store.ts`
- Modify: `src/server/kanban-backend.ts`
- Modify: `src/server/swarm-memory.ts`

**Requirements:**

- Swarm worker cwd preview remains available but is not treated as durable project identity.
- Missions and kanban cards should carry `projectId` when known.
- Dispatch should accept explicit `projectId` and reject/ask when ambiguous.
- Shared swarm memory should include project context only for the selected project.

**Acceptance tests:**

- Two swarm missions in different projects do not share kanban/memory state accidentally.
- Worker cwd preview can show `projectName` while separately reporting canonical `projectId` if resolved.

---

### Task 7: Update dashboard/gateway APIs and client helpers

**Objective:** Carry and display project identity in overview/aggregation layers.

**Files:**

- Modify: `src/routes/api/dashboard/overview.ts`
- Modify: `src/server/claude-dashboard-api.ts`
- Modify: `src/lib/gateway-api.ts`
- Modify related API client helpers under `src/lib/*` as needed

**Requirements:**

- Dashboard counts should optionally group/filter by project.
- API client types should include optional `projectId` and `project` fields.
- Existing clients should not break if backend omits project fields.

**Acceptance tests:**

- Dashboard shows total and per-project counts when project data exists.
- Missing project data degrades gracefully.

---

### Task 8: Add UI selector/badge and disambiguation flow

**Objective:** Make active project visible and selectable without exposing full sensitive paths.

**Files:**

- Modify: `src/stores/workspace-store.ts`
- Modify: `src/screens/chat/chat-screen.tsx`
- Modify: `src/screens/chat/components/chat-header.tsx`
- Modify: `src/screens/chat/components/chat-composer.tsx`
- Modify: task/swarm screens as needed

**UI behavior:**

- Show active project display name in chat/header/composer context.
- Use redacted path or basename in normal UI.
- Show full path only in authenticated settings/detail view or deliberate tooltip if safe.
- When resolution confidence is low, ask the user to choose a project before running project-scoped operations.
- Store selected project in a project-aware client store.

**Acceptance tests:**

- Two sessions can show different active projects.
- Ambiguous cwd produces a project picker rather than silent routing.
- Full local path is not visible in normal chat header/composer UI.

---

### Task 9: Add docs and full acceptance test suite

**Objective:** Document the project/workspace model and verify real multi-project behavior.

**Files:**

- Update: `docs/plans/central-agent-project-model.md`
- Create/update user-facing docs as appropriate
- Add tests near affected modules

**Acceptance matrix:**

- Two projects in one Hermes profile.
- One project with two workspaces/worktrees.
- One conversation mentioning multiple projects.
- Ambiguous cwd rejection/disambiguation.
- No cross-project task leakage.
- No cross-project memory leakage where backend supports namespaces.
- Legacy session still opens.
- Legacy task still appears in global/legacy view.
- Normal UI uses redacted paths.
- Swarm mission and chat run can carry same project identity.

---

## Security and Privacy Requirements

- Never expose full local paths in normal UI by default.
- Validate project roots against existing workspace path rules.
- Treat project IDs from client requests as untrusted until resolved through registry.
- Avoid cross-project memory/task leakage.
- Include owner/user/session authorization fields in `ProjectRef` or surrounding persistence if multi-user workspace mode is enabled.
- Redact path-like values in dashboard/project summaries unless the view is explicitly privileged.

---

## Backward Compatibility Requirements

- Existing sessions with no `projectId` must remain readable.
- Existing runs with no `projectId` must remain readable.
- Existing `~/.hermes/tasks.json` records must remain valid.
- APIs should tolerate missing `projectId` fields.
- Initial migration may use `projectId: null` for legacy/global data rather than forcing an unsafe guessed project.

---

## Commit Protocol Note

The previous plan included generic commit messages. Before implementation, confirm and follow the repo's current commit protocol from `CLAUDE.md` / project lore. Do not blindly use placeholder commits if the repo requires Lore-formatted commits.

---

## Execution Note

Implement this incrementally. Do not retrofit the entire system in one pass. Start with the registry and API boundary, then resolution, then data-path threading, then UI. The goal is explicit routing, not guesswork. There is no spoon.
