# Unified Hermes Kanban Task System Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace SwitchUI’s separate `/tasks` JSON Kanban with a full-featured client for Hermes Agent’s SQLite-backed Kanban system, preserving SwitchUI’s UX while using the Agent Kanban API as the single source of truth.

**Architecture:** SwitchUI should stop treating `/tasks` as an independent productivity board and instead proxy/normalize `http://127.0.0.1:9119/api/plugins/kanban/*` through Workspace-owned API routes. Hermes Agent remains the data owner (`$HERMES_HOME/kanban.db`), while SwitchUI becomes the richer browser client for board, task detail, comments, dependencies/subtasks, execution runs, logs, stats, assignees, and live events. The old `~/.hermes/tasks.json` store becomes migration-only/fallback-only, not an active second Kanban system.

**Tech Stack:** TanStack Start, React 19, TanStack Query, TypeScript, existing SwitchUI API route pattern, Hermes Agent Dashboard Kanban plugin API, SQLite-backed Agent Kanban (`kanban.db`).

---

## Homework Summary

### Current SwitchUI `/tasks`

Current files:

- `src/routes/tasks.tsx`
- `src/screens/tasks/tasks-screen.tsx`
- `src/screens/tasks/task-card.tsx`
- `src/screens/tasks/task-dialog.tsx`
- `src/lib/tasks-api.ts`
- `src/routes/api/claude-tasks.ts`
- `src/routes/api/claude-tasks.$taskId.ts`
- `src/routes/api/claude-tasks-assignees.ts`
- `src/server/tasks-store.ts`
- `src/stores/task-store.ts` ← **separate Zustand store, see note below**

Current persistence:

- `src/server/tasks-store.ts` reads/writes `~/.hermes/tasks.json`.
- Task schema is human-board-oriented: `id`, `title`, `description`, `column`, `priority`, `assignee`, `tags`, `due_date`, `position`, `created_by`, `created_at`, `updated_at`.
- Columns: `backlog`, `todo`, `in_progress`, `review`, `done`.
- No native comments, dependency links, subtask progress, task runs, dispatcher state, claims, heartbeats, worker logs, tenant filtering, archived tasks, or event stream.

### Current Hermes Agent Kanban

Agent dashboard API is available at `:9119/api/plugins/kanban/*`.

Verified live endpoints:

- `GET /api/plugins/kanban/board`
- `GET /api/plugins/kanban/stats`
- `GET /api/plugins/kanban/assignees`

Source-confirmed endpoints from `~/.hermes/hermes-agent/plugins/kanban/dashboard/plugin_api.py`:

- `GET /board?tenant=&include_archived=` — grouped board with link counts, comment counts, subtask progress, tenants, assignees, latest event cursor.
- `POST /tasks` — create task with `title`, `body`, `assignee`, `tenant`, `priority`, `workspace_kind`, `workspace_path`, `parents`, `triage`, `idempotency_key`, `max_runtime_seconds`, `skills`.
- `GET /tasks/{task_id}` — task detail with `task`, `comments`, `events`, `links`, `runs`.
- `PATCH /tasks/{task_id}` — update `status`, `assignee`, `priority`, `title`, `body`, `result`, `block_reason`, `summary`, `metadata`.
- `POST /tasks/{task_id}/comments` — add comment.
- `POST /links` — add parent/child link.
- `DELETE /links?parent_id=&child_id=` — remove dependency/subtask link.
- `POST /tasks/bulk` — bulk status, assignee, priority, archive.
- `GET /config` — dashboard Kanban UI preferences.
- `GET /stats` — status/assignee counts and oldest-ready age.
- `GET /assignees` — profile/assignee union.
- `GET /tasks/{task_id}/log?tail=` — worker log.
- `POST /dispatch?dry_run=&max=` — nudge dispatcher.
- `WS /events?since=&token=` — live event stream.

Agent Kanban storage:

- `$HERMES_HOME/kanban.db`
- `tasks`, `task_links`, `task_comments`, `task_events`, `task_runs`, `kanban_notify_subs`

Agent statuses:

- `triage`, `todo`, `ready`, `running`, `blocked`, `done`, `archived`

### Existing partial bridge to reuse carefully

SwitchUI already has partial Swarm Kanban bridge code:

- `src/server/kanban-backend.ts`
- `src/server/swarm-kanban-store.ts`
- `src/routes/api/swarm-kanban.ts`

Problems:

- It uses old `claude` naming.
- It can write directly to SQLite using `sqlite3` shell commands.
- It maps `backlog` to `queued`, but Agent Kanban does not accept `queued` in dashboard patch status handling.
- It only covers a narrow card model and not comments, links, runs, logs, stats, or live events.

Decision: do not extend this direct-SQL bridge as the primary `/tasks` path. Reuse only patterns/tests where useful, but create a proper dashboard API client/proxy.

### Second client-side ghost: `src/stores/task-store.ts`

There is a **second, entirely separate task store** that the plan must explicitly address. This is a Zustand store (persisted to `localStorage` under key `clawsuite-tasks-v1`) with its own `Task` type and its own API calls. It is **not** the same as `tasks-api.ts`.

Key facts:

- It calls `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/${id}`, and `DELETE /api/tasks/${id}` — a URL base that **does not exist** as a Workspace route. The real routes are at `/api/claude-tasks`. This store's backend sync is already broken.
- It carries its own `TaskStatus` type: `'backlog' | 'in_progress' | 'review' | 'done'` (no `ready`, `running`, `blocked`, `triage`).
- It is wired into the Swarm2 mission system via `upsertMissionTasks()` and `getTasksByMission()` (CS-020).
- It is consumed by `src/screens/swarm2/` and mission-orchestration code, not by `tasks-screen.tsx`.

Without explicit handling, this store will survive the migration as a localStorage ghost writing to nonexistent endpoints, and the Swarm2 mission board will silently continue those dead calls.

Decision options (choose one before Task 1):

1. **Wire to Agent Kanban** — migrate `task-store.ts` to call `/api/hermes-kanban/*` scoped by `missionId` as a tenant; cover in Task 17 alongside the Swarm board cleanup.
2. **Decouple** — keep it as a localStorage-only ephemeral planning store for mission orchestration with no backend sync; remove the dead `fetch` calls and document that it is mission-local only.
3. **Deprecate** — remove `task-store.ts` entirely if the Swarm2 mission board is being unified under the Agent Kanban tenant model.

This decision must be made before Task 17 is executed. Do not leave the dead `fetch` calls in place.

---

## Product Decision

SwitchUI `/tasks` should become the full-featured Hermes Agent Kanban surface.

There should be one canonical task board:

- canonical storage: `$HERMES_HOME/kanban.db`
- canonical lifecycle: Agent Kanban statuses
- canonical mutation path: Hermes Agent Kanban API / CLI-backed code path
- SwitchUI role: polished UX client, not separate store

Old `~/.hermes/tasks.json` should be one of:

1. migrated once into `kanban.db`, then ignored; or
2. read-only legacy import source; or
3. emergency local fallback only when `:9119` is unavailable, clearly labeled as disconnected.

Do not keep it as a normal parallel write path.

---

## Status Mapping

Use Agent statuses in persistence. UI labels may be friendlier but should not invent persisted states.

| SwitchUI old column | Agent status | UI label recommendation | Notes |
|---|---|---|---|
| `backlog` | `triage` | Backlog / Triage | Human-created unrefined task. |
| `todo` | `todo` | Todo | Not ready due to dependencies or manual hold. |
| N/A | `ready` | Ready | Dispatchable work queue. Must become visible in SwitchUI. |
| `in_progress` | `running` | Running | Execution-aware; may include claim/worker/run metadata. |
| `review` | N/A | Review filter/tag, not status | Agent Kanban has no `review`; do not persist review unless Agent adds it upstream. |
| N/A | `blocked` | Blocked | Must become visible in SwitchUI. |
| `done` | `done` | Done | Terminal complete status. |
| N/A | `archived` | Archived | Hidden by default, optional toggle. |

`review` should be represented by one of these, in order of preference:

1. a UI filter/convention based on `result`, `summary`, `metadata.review_required`, or comment/event convention;
2. a future upstream Agent Kanban status if accepted;
3. not supported in v1 unification.

Do not map `review` to `blocked`; that changes semantics.

---

## Data Model in SwitchUI

Create new UI-facing types that preserve Agent fields instead of collapsing them into old `ClaudeTask`.

Recommended type names:

- `HermesKanbanStatus`
- `HermesKanbanTask`
- `HermesKanbanBoard`
- `HermesKanbanTaskDetail`
- `HermesKanbanComment`
- `HermesKanbanEvent`
- `HermesKanbanRun`
- `HermesKanbanLinks`
- `HermesKanbanAssignee`

Minimum UI task fields:

```ts
export type HermesKanbanStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'archived'
export const HERMES_KANBAN_VISIBLE_STATUS_ORDER: Exclude<HermesKanbanStatus, 'archived'>[] = ['triage', 'todo', 'ready', 'running', 'blocked', 'done']
export const HERMES_KANBAN_ALL_STATUSES: HermesKanbanStatus[] = [...HERMES_KANBAN_VISIBLE_STATUS_ORDER, 'archived']

export type HermesKanbanTask = {
  id: string
  title: string
  body: string | null
  assignee: string | null
  status: HermesKanbanStatus
  priority: number
  created_by: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
  workspace_kind: string | null
  workspace_path: string | null
  claim_lock: string | null
  claim_expires: number | null
  tenant: string | null
  result: string | null
  spawn_failures: number
  worker_pid: number | null
  last_spawn_error: string | null
  max_runtime_seconds: number | null
  last_heartbeat_at: number | null
  current_run_id: number | null
  workflow_template_id: string | null
  current_step_key: string | null
  skills: string[] | string | null
  age?: {
    created_age_seconds: number
    started_age_seconds: number | null
    time_to_complete_seconds: number | null
  }
  link_counts?: { parents: number; children: number }
  comment_count?: number
  progress?: { done: number; total: number } | null
}
```

Assignee normalization contract:

- Agent `/assignees` returns items shaped like `{ name, on_disk, counts }`.
- SwitchUI should normalize each item to `{ id, label, name, isHuman, onDisk, counts }`.
- `id` should be the stable assignee key used in task payloads, normally the Agent `name`.
- `label` should be display-only and may prettify `name`.
- `isHuman` should be inferred conservatively from known human profile names/config; unknown Agent assignees default to `false`, not guessed.
- Add tests for empty assignees, on-disk profiles, current task assignees absent from `/assignees`, and count preservation.

Priority mapping for the old UI colors:

- old `high` → numeric `3`
- old `medium` → numeric `1`
- old `low` → numeric `-1`

For display:

- `priority >= 3` → High
- `priority >= 1` → Medium
- `priority <= 0` → Low/Normal

> **Migration note:** `medium` must map to `1` (not `0`) so that migrated medium-priority tasks from `tasks.json` continue to display as Medium in the new board. With `medium → 0` they would silently appear as Low/Normal because the Medium display boundary is `>= 1`. Add a migration test case asserting `priority: "medium"` → numeric `1`.

Due dates and tags are not first-class Agent Kanban fields. Do not silently drop them during migration. Store them in a safe metadata convention only if Agent supports or accepts metadata on create/update. Current dashboard `POST /tasks` does not expose metadata except completion metadata on `PATCH` to done, so the v1 UI should treat old tags/due dates as migrated body annotations unless Agent adds metadata fields.

Migration body annotation format:

```md
[Imported from SwitchUI tasks.json]
Due date: 2026-05-10
Tags: frontend, bug

<original description>
```

---

## Pre-Implementation Branch and Commit Protocol

Do this before Task 1. The inspected repo was on `integration/v2.2.0-upstream` with unrelated modified files, so implementation must not start on that dirty branch unless Rohit explicitly chooses that base.

Recommended setup:

```bash
git status --short
git switch local
git pull --ff-only
git switch -c feat/unified-hermes-kanban-tasks
```

If unrelated local work blocks checkout, stop and ask Rohit whether to stash, commit, or continue on the integration branch. Do not mix this implementation with v2.2.0 integration cleanup unless explicitly directed.

Commit examples in this plan are templates. Before the first commit, confirm and follow the repo's current Lore trailer requirement from project docs/hooks. Use multi-line commit messages with the required trailer, for example:

```bash
git commit -m "feat(tasks): add Hermes Kanban types" \
  -m "Lore: unify SwitchUI tasks with Hermes Agent Kanban"
```

If the repo defines a stricter Lore trailer key/value, use that exact format for every commit in this plan.

---

## Implementation Tasks

### Pre-flight Fix: Stop live `mapBoardStatus` data corruption

**This fix must be applied before Task 1. It is not optional and does not require the full migration to be in progress.**

**Problem:** `src/server/kanban-backend.ts` — `mapBoardStatus('backlog')` currently returns `'queued'`. The Swarm2 Kanban route actively calls this function and writes `queued` as a task status into `kanban.db` via `execFileSync('sqlite3', ...)`. The Agent Dashboard Kanban API does not recognise `queued` as a valid status; it silently corrupts any row it touches. This is happening in production today, independently of the migration.

**Fix:** In `src/server/kanban-backend.ts`, change the `mapBoardStatus` function:

```ts
// Before
case 'backlog':
  return 'queued'

// After
case 'backlog':
  return 'triage'
```

Also add a test in `src/server/kanban-backend.test.ts` asserting:

```ts
it('mapBoardStatus does not produce queued', () => {
  expect(mapBoardStatus('backlog')).toBe('triage')
  expect(mapBoardStatus('ready')).toBe('ready')
  expect(mapBoardStatus('running')).toBe('running')
})
```

**Commit:**

```bash
git add src/server/kanban-backend.ts src/server/kanban-backend.test.ts
git commit -m "fix(kanban): correct mapBoardStatus backlog to triage, remove invalid queued status" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 1: Add Agent Kanban status/types module

**Objective:** Introduce the canonical Agent Kanban client-side types and status metadata without touching runtime behavior.

**Files:**

- Create: `src/lib/hermes-kanban-types.ts`
- Test: `src/lib/hermes-kanban-types.test.ts`

**Step 1: Create failing tests**

Add tests for:

- visible board status order excludes `archived`;
- full status set includes `archived`;
- old SwitchUI columns map to Agent statuses;
- numeric priorities map to display labels/colors.

```ts
import { describe, expect, it } from 'vitest'
import {
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  HERMES_KANBAN_ALL_STATUSES,
  mapLegacyColumnToKanbanStatus,
  kanbanPriorityLabel,
} from './hermes-kanban-types'

describe('hermes-kanban-types', () => {
  it('separates visible board order from the full status set', () => {
    expect(HERMES_KANBAN_VISIBLE_STATUS_ORDER).toEqual(['triage', 'todo', 'ready', 'running', 'blocked', 'done'])
    expect(HERMES_KANBAN_ALL_STATUSES).toEqual(['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived'])
  })

  it('maps legacy SwitchUI columns to Agent statuses', () => {
    expect(mapLegacyColumnToKanbanStatus('backlog')).toBe('triage')
    expect(mapLegacyColumnToKanbanStatus('todo')).toBe('todo')
    expect(mapLegacyColumnToKanbanStatus('in_progress')).toBe('running')
    expect(mapLegacyColumnToKanbanStatus('done')).toBe('done')
  })

  it('maps numeric priority to labels', () => {
    expect(kanbanPriorityLabel(3)).toBe('High')
    expect(kanbanPriorityLabel(1)).toBe('Medium')
    expect(kanbanPriorityLabel(0)).toBe('Normal')
    expect(kanbanPriorityLabel(-1)).toBe('Low')
  })
})
```

**Step 2: Run failing test**

Run: `pnpm test src/lib/hermes-kanban-types.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement module**

Create `src/lib/hermes-kanban-types.ts` with exported types, separate visible/all status constants, label/color helpers, assignee normalization helpers, and legacy mapping helpers.

**Step 4: Run passing test**

Run: `pnpm test src/lib/hermes-kanban-types.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/hermes-kanban-types.ts src/lib/hermes-kanban-types.test.ts
git commit -m "feat(tasks): add Hermes Kanban types" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 2: Create a server-side Dashboard Kanban API client

**Objective:** Add a single server-only client that talks to the Agent Dashboard Kanban plugin instead of direct SQLite or `tasks.json`.

**Files:**

- Create: `src/server/hermes-kanban-client.ts`
- Test: `src/server/hermes-kanban-client.test.ts`
- Reference existing: `src/server/gateway-capabilities.ts`

**Step 1: Write failing tests**

Mock `global.fetch` and verify:

- client calls `${CLAUDE_DASHBOARD_URL}/api/plugins/kanban/board`;
- client forwards auth headers when available;
- non-OK responses throw useful errors;
- create task sends Agent payload fields, not legacy `column` fields.

**Step 2: Run failing test**

Run: `pnpm test src/server/hermes-kanban-client.test.ts`

Expected: FAIL because file does not exist.

**Step 3: Implement client**

Functions to implement:

```ts
export async function getKanbanBoard(params?: { tenant?: string; includeArchived?: boolean }): Promise<HermesKanbanBoard>
export async function getKanbanTask(taskId: string): Promise<HermesKanbanTaskDetail>
export async function createKanbanTask(input: CreateKanbanTaskInput): Promise<{ task: HermesKanbanTask; warning?: string }>
export async function updateKanbanTask(taskId: string, input: UpdateKanbanTaskInput): Promise<{ task: HermesKanbanTask }>
export async function addKanbanComment(taskId: string, input: { body: string; author?: string }): Promise<{ ok: true }>
export async function addKanbanLink(parentId: string, childId: string): Promise<{ ok: true }>
export async function deleteKanbanLink(parentId: string, childId: string): Promise<{ ok: boolean }>
export async function bulkUpdateKanbanTasks(input: BulkKanbanInput): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }> }>
export async function getKanbanStats(): Promise<unknown>
export async function getKanbanAssignees(): Promise<{ assignees: unknown[] }>
export async function getKanbanTaskLog(taskId: string, tail?: number): Promise<unknown>
export async function dispatchKanban(max?: number, dryRun?: boolean): Promise<unknown>
```

Implementation notes:

- Keep this server-only; never import it into client components.
- **Use `dashboardFetch(path, init)` exported from `src/server/gateway-capabilities.ts` for every HTTP call to the dashboard Kanban plugin.** Do not write a parallel fetch wrapper. `dashboardFetch` handles token acquisition (env var preferred, HTML-scrape fallback), 401 retry with token refresh, and shared token cache. A parallel implementation will break when the dashboard session token rotates mid-session.
- `CLAUDE_DASHBOARD_URL` is also exported from `gateway-capabilities.ts`; use it as the base for constructing paths passed to `dashboardFetch`.
- Use `AbortSignal.timeout(5000)` for normal reads and `15000` for dispatch/log if needed. `AbortSignal.timeout` requires Node.js ≥ 17.3; this project already uses it in `gateway-capabilities.ts` so the runtime version is confirmed safe.
- Do not use `sqlite3` shell commands here.

**Step 4: Run passing test**

Run: `pnpm test src/server/hermes-kanban-client.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/hermes-kanban-client.ts src/server/hermes-kanban-client.test.ts
git commit -m "feat(tasks): add Hermes Kanban dashboard client" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 3: Add complete Workspace proxy API routes for Kanban reads and mutations

**Objective:** Expose authenticated Workspace routes for every Agent Kanban operation the browser will call before migrating frontend code. This is a hard sequencing requirement: do not point `src/lib/tasks-api.ts` at `/api/hermes-kanban/*` until these routes exist.

> **Route file naming — verify before creating all ten files.** TanStack Start resolves dotted filename segments as nested route paths. The deepest paths proposed here (`hermes-kanban.tasks.$taskId.comments`, `hermes-kanban.tasks.$taskId.log`) are four segments deep, which is deeper than any existing route in this repo. Before creating all ten files, create a single test route (`hermes-kanban.tasks.$taskId.comments.ts`) and run `pnpm build` to confirm the route tree generates correctly.
>
> If deep dotted names do not resolve, use a subdirectory layout instead:
> ```
> src/routes/api/hermes-kanban/
>   board.ts
>   tasks.ts
>   tasks.$taskId.ts
>   tasks.$taskId.comments.ts
>   tasks.$taskId.log.ts
>   links.ts
>   bulk.ts
>   stats.ts
>   assignees.ts
>   dispatch.ts
> ```
> Choose one naming convention before creating any files and apply it consistently. Do not mix dotted and subdirectory styles. Do not edit `src/routeTree.gen.ts` manually.

**Files:**

- Create: `src/routes/api/hermes-kanban.board.ts` (or subdirectory equivalent — see note above)
- Create: `src/routes/api/hermes-kanban.tasks.ts`
- Create: `src/routes/api/hermes-kanban.tasks.$taskId.ts`
- Create: `src/routes/api/hermes-kanban.tasks.$taskId.comments.ts` ← **owned by this task; Task 9 wires UI only**
- Create: `src/routes/api/hermes-kanban.tasks.$taskId.log.ts`
- Create: `src/routes/api/hermes-kanban.links.ts`
- Create: `src/routes/api/hermes-kanban.bulk.ts`
- Create: `src/routes/api/hermes-kanban.stats.ts`
- Create: `src/routes/api/hermes-kanban.assignees.ts`
- Create: `src/routes/api/hermes-kanban.dispatch.ts`
- Create in Task 14 only: `src/routes/api/hermes-kanban.events.ts` or equivalent Workspace-owned WS/SSE proxy route for live events
- Test: the existing project route-test pattern uses `-`-prefixed test files alongside route files (e.g., `src/routes/api/-mcp.test.ts`). Follow this pattern for route-level smoke tests.

**Step 1: Implement board route**

Route: `GET /api/hermes-kanban/board?tenant=&include_archived=`

TanStack file route path naming should follow project conventions. If dotted filenames do not map as expected, use the established file route style already present in this app.

Behavior:

- check `isAuthenticated(request)`;
- call `getKanbanBoard()`;
- return `{ board }`;
- on dashboard unavailable return `503` with `{ error, mode: 'dashboard-unavailable' }`.

**Step 2: Implement task collection mutation route**

Route: `POST /api/hermes-kanban/tasks`

Behavior:

- check auth;
- validate Agent-native create payload;
- call `createKanbanTask()`;
- return `{ task, warning? }`;
- preserve Agent validation errors as 400/422 where possible.

**Step 3: Implement task detail read/update routes**

Routes:

- `GET /api/hermes-kanban/tasks/$taskId`
- `PATCH /api/hermes-kanban/tasks/$taskId`

Behavior:

- check auth;
- `GET` calls `getKanbanTask(taskId)` and returns task/comments/events/links/runs;
- `PATCH` calls `updateKanbanTask(taskId, input)` for status/move, assignee, priority, title/body, result, block reason, summary, and supported metadata;
- preserve 404.

**Step 4: Implement comment, dependency, log, stats, assignee, dispatch, and bulk routes**

Routes:

- `POST /api/hermes-kanban/tasks/$taskId/comments` → `addKanbanComment()`
- `GET /api/hermes-kanban/tasks/$taskId/log?tail=` → `getKanbanTaskLog()`
- `POST /api/hermes-kanban/links` → `addKanbanLink()`
- `DELETE /api/hermes-kanban/links?parent_id=&child_id=` → `deleteKanbanLink()`
- `POST /api/hermes-kanban/bulk` → `bulkUpdateKanbanTasks()`
- `GET /api/hermes-kanban/stats` → `getKanbanStats()`
- `GET /api/hermes-kanban/assignees` → `getKanbanAssignees()` normalized to the UI assignee contract
- `POST /api/hermes-kanban/dispatch?max=&dry_run=` → `dispatchKanban()`

Every browser-called mutation must go through these Workspace routes, never directly to `:9119`.

**Step 5: Verify route tree generation**

Run: `pnpm dev` or `pnpm build` after implementation so TanStack route generation catches invalid route names.

Expected: route tree generated successfully; do not edit `src/routeTree.gen.ts` manually.

**Step 6: Commit**

```bash
git add src/routes/api/hermes-kanban*
git commit -m "feat(tasks): proxy Hermes Kanban operations" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 4: Add backend capability gating and unavailable state

**Objective:** Make `/tasks` clear and safe when Agent Dashboard Kanban is unavailable before any frontend migration depends on it.

**Files:**

- Modify: `src/server/gateway-capabilities.ts` — add `kanban` capability (six specific locations, see Step 1)
- Modify: `src/hooks/use-feature-capability.ts` — add `'kanban'` to `FeatureKey` union
- Modify: `src/routes/tasks.tsx`
- Modify: `src/screens/tasks/tasks-screen.tsx`

> **Do not modify `src/lib/feature-gates.ts` for capability gating.** That file is a browser-safe label/message utility that intentionally cannot import server modules (see its top-of-file comment). The correct client-side gate uses `useIsFeatureAvailable('kanban')` from `src/hooks/use-gateway-caps.ts`, which reads from `/api/gateway-status`. The `kanban` key will be present in that response once Step 1 below is complete.

**Step 1: Add `kanban` capability to `gateway-capabilities.ts`**

Adding a new capability requires changes in **six specific locations** in `gateway-capabilities.ts`. Follow the same pattern used when `conductor` was added:

1. **`EnhancedCapabilities` type** — add `kanban: boolean`
2. **Initial `capabilities` object** (around line 213) — add `kanban: false`
3. **`OPTIONAL_APIS` set** — add `'kanban'` (it is optional; task board degrades gracefully when Agent Kanban is absent)
4. **`getEnhancedCapabilities()` accessor** — include `kanban: capabilities.kanban` in the return object
5. **New probe function** — `async function probeKanban(dashboardAvailable: boolean): Promise<boolean>` using `dashboardFetch('/api/plugins/kanban/board')` with a 3-second timeout; return `false` if dashboard is unavailable
6. **`probeGateway()` parallel call array** — add `probeKanban(dashboard.available)` alongside the existing `probeConductor` call

Capability name: `kanban`

Probe endpoint:

- `GET ${CLAUDE_DASHBOARD_URL}/api/plugins/kanban/board`

**Step 2: Gate route using `useIsFeatureAvailable`**

In `src/routes/tasks.tsx` and `src/screens/tasks/tasks-screen.tsx`, use `useIsFeatureAvailable('kanban')` from `src/hooks/use-gateway-caps.ts` to gate rendering. This hook reads the `kanban` key from `/api/gateway-status` which now includes the probed value from Step 1.

If unavailable (`false`), show `BackendUnavailableState` with:

- dashboard URL attempted;
- explanation that the task board uses Hermes Agent Kanban;
- optional legacy import/fallback button only if consciously retained.

If `null` (still loading), show a loading skeleton — do not flash the unavailable state during the initial probe.

**Step 3: Run tests/build**

Run: `pnpm build`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/server/gateway-capabilities.ts src/hooks/use-feature-capability.ts src/routes/tasks.tsx src/screens/tasks/tasks-screen.tsx
git commit -m "feat(tasks): gate board on Hermes Kanban capability" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 5: Replace `src/lib/tasks-api.ts` with Agent Kanban-backed frontend API

**Objective:** Move the browser-facing task API away from `/api/claude-tasks` and toward `/api/hermes-kanban/*` while preserving a compatibility surface for the current task screen during migration.

**Files:**

- Modify: `src/lib/tasks-api.ts`
- Test: `src/lib/tasks-api.test.ts`

**Step 1: Write failing tests**

Mock browser `fetch` and verify:

- `fetchTasks({ include_done: false })` calls the new board route;
- returned board columns flatten into tasks or return board shape depending on final API decision;
- `moveTask(id, 'running')` sends `PATCH status: 'running'`;
- `deleteTask(id)` is explicitly handled and does not stay orphaned;
- create sends `title`, `body`, `priority`, `assignee`, `triage`, `parents`, `skills` fields.

**Step 2: Decide compatibility strategy**

Short-term safest path:

- keep exported names used by `TasksScreen` (`fetchTasks`, `createTask`, `updateTask`, `moveTask`, `deleteTask`, `fetchAssignees`);
- change their internal implementation to use Agent Kanban routes;
- change `TaskColumn` to Agent statuses or introduce `TaskStatus` and update screen imports in later tasks.

Preferred final path:

- rename `ClaudeTask` to `HermesKanbanTask`;
- rename `TaskColumn` to `HermesKanbanStatus`;
- rename API route base from `claude-tasks` to `hermes-kanban`.

**Step 2a: Handle `src/routes/api/claude-tasks-assignees.ts` explicitly**

`claude-tasks-assignees.ts` currently returns a `{ assignees, humanReviewer }` shape from a static source. After `tasks-api.ts` is updated to call the new `/api/hermes-kanban/assignees` route (created in Task 3), the old assignees route becomes stale — it continues to serve old-format data to any caller that still has the old URL cached. Do not leave it as a functional route returning mismatched data.

Make an explicit choice in this task:

- **Preferred:** Change `claude-tasks-assignees.ts` to return `301` or `308` redirecting to `/api/hermes-kanban/assignees`. This preserves any external callers while pointing them at the correct data.
- **Alternative:** Change it to return `410 Gone` with `{ error: 'Use /api/hermes-kanban/assignees', successor: '/api/hermes-kanban/assignees' }`.

Either way, `fetchAssignees()` in `tasks-api.ts` must be updated to call the new route directly, not rely on the redirect.

**Step 3: Implement minimal compatibility**

Keep old exports for compile safety, but mark them as Agent-backed. Explicitly choose one `deleteTask` compatibility behavior in this task: preferred v1 behavior is `deleteTask(id)` → bulk archive or `PATCH status: 'archived'`, with UI copy saying “Archive”. If the team chooses hard removal instead, remove all `deleteTask` call sites in the same task and return `410 Gone` from legacy delete routes.

**Step 4: Run tests**

Run: `pnpm test src/lib/tasks-api.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/tasks-api.ts src/lib/tasks-api.test.ts
git commit -m "refactor(tasks): use Hermes Kanban API in task client" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 6: Update task board columns to Agent lifecycle

**Objective:** Render Agent Kanban statuses as the visible `/tasks` columns.

**Files:**

- Modify: `src/screens/tasks/tasks-screen.tsx`
- Modify: `src/lib/tasks-api.ts` or `src/lib/hermes-kanban-types.ts`
- Test: `src/screens/tasks/tasks-ux.test.ts`

**Step 1: Write failing UI tests**

Update/add tests expecting columns:

- Backlog/Triage
- Todo
- Ready
- Running
- Blocked
- Done when `showDone` is enabled
- Archived only when include archived toggle exists in later task

**Step 2: Update constants**

Replace old:

```ts
['backlog', 'todo', 'in_progress', 'review', 'done']
```

with Agent order:

```ts
['triage', 'todo', 'ready', 'running', 'blocked', 'done']
```

**Step 3: Update stats**

Change stats from `in_progress` to `running` and include `blocked` count.

**Step 4: Update drag/drop status patching**

Dropping on a column should call `PATCH /tasks/{id}` with `status` equal to the target Agent status.

Special cases:

- **Moving to `blocked` — v1 behaviour (required, not deferred):** Show a small inline confirmation dialog with an optional `block_reason` text field. The dialog should have a "Block task" confirm button and a cancel. `block_reason` is optional on the Agent API side, but the UI must surface the field so users can supply context; do not silently drop cards into `blocked` without a prompt. If the user submits without a reason, send `PATCH status: 'blocked'` with no `block_reason` field — this is valid. Do not implement "or later allow" as a deferral; ship the prompt in v1.
- moving to `done` should optionally allow result/summary in detail drawer;
- moving from `running` to non-running intentionally reclaims/ends current run via dashboard API behavior; show a confirmation dialog warning the user that any active worker run will be affected.

**Step 5: Run tests**

Run: `pnpm test src/screens/tasks/tasks-ux.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/screens/tasks/tasks-screen.tsx src/lib/tasks-api.ts src/lib/hermes-kanban-types.ts src/screens/tasks/tasks-ux.test.ts
git commit -m "feat(tasks): render Agent Kanban lifecycle columns" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 7: Upgrade task cards for Agent execution metadata

**Objective:** Make cards show the Agent-specific data that made the core Kanban valuable: link counts, comment counts, child progress, assignee, priority, run state, heartbeat/staleness, and worker errors.

**Files:**

- Modify: `src/screens/tasks/task-card.tsx`
- Test: add/modify card tests if present; otherwise add `src/screens/tasks/task-card.test.tsx`

**Step 1: Write failing tests**

Test card displays:

- comment count when `comment_count > 0`;
- child progress when `progress` exists;
- parent/child badges from `link_counts`;
- stale running indicator when `status === 'running'` and heartbeat is old;
- spawn failure/error badge when `spawn_failures > 0` or `last_spawn_error` exists.

**Step 2: Implement visual badges**

Suggested compact badges should use existing HugeIcons/icon components, not emoji/text-only glyphs:

- comment icon + `N` comments
- dependency/subtask icons for children/parents
- `done/total` child progress
- worker/process icon + `PID <worker_pid>` for running tasks
- warning/clock icon + `stale` when heartbeat is expired/old
- error icon + `failed spawn` when last spawn error exists

Use HugeIcons for the metadata iconography in v1. Plain text may accompany icons for accessibility/clarity, but do not ship emoji-only or text-only metadata badges unless the icon package genuinely lacks a matching symbol and the exception is documented in the task notes.

**Step 3: Run tests**

Run: `pnpm test src/screens/tasks/task-card.test.tsx`

Expected: PASS.

**Step 4: Commit**

```bash
git add src/screens/tasks/task-card.tsx src/screens/tasks/task-card.test.tsx
git commit -m "feat(tasks): show Kanban execution metadata on cards" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 8: Replace edit dialog with full task detail drawer

**Objective:** Move beyond a simple edit modal and provide a full task detail surface with metadata, comments, dependencies, subtasks, runs, events, and logs.

**Files:**

- Create: `src/screens/tasks/task-detail-drawer.tsx`
- Modify: `src/screens/tasks/tasks-screen.tsx`
- Keep/modify: `src/screens/tasks/task-dialog.tsx` for create-only or basic edit
- Test: `src/screens/tasks/task-detail-drawer.test.tsx`

**Step 1: Write failing tests**

Test drawer renders:

- title/body/status/assignee/priority;
- comments list;
- parent dependencies;
- child subtasks;
- events timeline;
- run history;
- worker log tab placeholder or loaded content.

**Step 2: Implement drawer layout**

Recommended tabs/sections:

1. Overview — title, body, status, assignee, tenant, priority, skills.
2. Comments — existing comments and add-comment composer.
3. Dependencies — parents and children/subtasks.
4. Runs — task runs, status, worker PID, outcome, errors.
5. Events — append-only event history.
6. Log — worker log tail.

**Step 3: Wire detail query**

When opening a task, query `GET /api/hermes-kanban/tasks/{id}`.

Use separate query for log only when the Log tab opens.

**Step 4: Run tests**

Run: `pnpm test src/screens/tasks/task-detail-drawer.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/screens/tasks/task-detail-drawer.tsx src/screens/tasks/tasks-screen.tsx src/screens/tasks/task-dialog.tsx src/screens/tasks/task-detail-drawer.test.tsx
git commit -m "feat(tasks): add full Kanban task detail drawer" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 9: Add comments support

**Objective:** Let users view and add comments using Agent Kanban `task_comments` via dashboard API.

> **Scope note:** The `POST /api/hermes-kanban/tasks/$taskId/comments` route is **created in Task 3**, not here. Task 9 only wires the drawer UI and client-side validation to that already-existing route. Do not recreate or duplicate the route file.

**Files:**

- Modify: `src/server/hermes-kanban-client.ts` — confirm `addKanbanComment()` is complete (stub may have been added in Task 2)
- Modify: `src/lib/tasks-api.ts` — add `addComment(taskId, body)` function calling `POST /api/hermes-kanban/tasks/${taskId}/comments`
- Modify: `src/screens/tasks/task-detail-drawer.tsx` — wire comment composer to the new function
- Test: relevant client/drawer tests

**Step 1: Write failing tests**

Test adding a blank comment is rejected client-side and server-side.

Test adding a valid comment posts:

```json
{ "body": "text", "author": "SwitchUI" }
```

**Step 2: Implement route**

Route should:

- require auth;
- validate non-empty `body`;
- call `POST /api/plugins/kanban/tasks/{task_id}/comments`;
- invalidate/refetch detail after success.

**Step 3: Implement UI composer**

Add comment textarea/button in detail drawer.

**Step 4: Run tests**

Run focused tests.

**Step 5: Commit**

```bash
git add src/server/hermes-kanban-client.ts src/routes/api/hermes-kanban* src/lib/tasks-api.ts src/screens/tasks/task-detail-drawer.tsx
git commit -m "feat(tasks): support Kanban task comments" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 10: Add dependencies and subtasks support

**Objective:** Surface `task_links` as both dependencies and subtasks, with create/remove link operations.

**Files:**

- Modify: `src/server/hermes-kanban-client.ts`
- Add routes for links under `src/routes/api/hermes-kanban.links.ts` or equivalent
- Modify: `src/lib/tasks-api.ts`
- Modify: `src/screens/tasks/task-detail-drawer.tsx`
- Test: drawer/client tests

**Step 1: Define semantics in UI**

Use Agent Kanban semantics:

- parent → child means child depends on parent;
- in parent detail, children are subtasks/dependents;
- in child detail, parents are dependencies/blockers.

**Step 2: Write failing tests**

Test:

- adding parent link calls `POST /links` with `{ parent_id, child_id }`;
- removing link calls `DELETE /links?parent_id=&child_id=`;
- cycle errors are displayed from server `400`.

**Step 3: Implement link controls**

In drawer:

- add dependency by ID/title search;
- add subtask by creating a new child task with `parents: [currentTask.id]`;
- remove link button.

**Step 4: Run tests**

Run focused tests.

**Step 5: Commit**

```bash
git add src/server/hermes-kanban-client.ts src/routes/api/hermes-kanban* src/lib/tasks-api.ts src/screens/tasks/task-detail-drawer.tsx
git commit -m "feat(tasks): support Kanban dependencies and subtasks" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 11: Add create-task support for Agent fields

**Objective:** Replace the old create/edit form fields with Agent-native task creation fields.

**Files:**

- Modify: `src/screens/tasks/task-dialog.tsx`
- Modify: `src/lib/tasks-api.ts`
- Test: task dialog tests

**Step 1: Update form fields**

Agent-native create fields:

- title
- body
- status choice mapped through the table below; Agent create only directly supports `triage`/`ready` and dependency-derived `todo`
- assignee
- tenant
- priority number/label
- workspace kind/path
- max runtime seconds
- skills list
- parents/dependencies

Create-time status mapping:

| Desired UI status | Create payload | Follow-up action | Notes |
|---|---|---|---|
| `triage` | `triage: true`, no required parents | None | Backlog/Triage. |
| `ready` | `triage: false`, no parents | None | Dispatchable immediately. |
| `todo` with parents | `triage: false`, `parents: [...]` | None if Agent derives blocked-by-parent/todo state | Dependency-held work. |
| `todo` without parents | Create as `ready` or `triage` per UI choice | Immediately `PATCH status: 'todo'` | Agent create does not directly accept standalone `todo`. |
| `blocked` | Create as `ready` or `triage` | Immediately `PATCH status: 'blocked'` with `block_reason` | Require reason when possible. |
| `running` | Create as `ready` | Usually do not patch directly; prefer dispatcher | Manual running should be explicit/confirmed. |
| `done` | Create as `ready` | Immediately `PATCH status: 'done'` with result/summary | Mostly for imports/tests. |
| `archived` | Create as `triage` or `ready` | Immediately archive via bulk/archive path | Rare; hidden by default. |

Remove or migrate old-only fields:

- tags — body annotation or future metadata only
- due date — body annotation or future metadata only
- review column — not persisted as status

**Step 2: Write failing tests**

Test form payload maps:

- title → `title`
- description/body → `body`
- Backlog/Triage → `triage: true`
- Ready → `triage: false`, no parents
- Todo without parents → create then patch `status: 'todo'`
- Blocked → create then patch `status: 'blocked'` with block reason
- priority label → numeric priority
- selected dependencies → `parents`

**Step 3: Implement mapping**

Keep labels friendly; payload must be Agent-native.

**Step 4: Run tests**

Run focused dialog tests.

**Step 5: Commit**

```bash
git add src/screens/tasks/task-dialog.tsx src/lib/tasks-api.ts
git commit -m "feat(tasks): create Agent-native Kanban tasks" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 12: Add bulk actions and archive support

**Objective:** Support multi-select operations and archived tasks using the existing Agent API.

**Files:**

- Modify: `src/screens/tasks/tasks-screen.tsx`
- Modify: `src/lib/tasks-api.ts`
- Test: `src/screens/tasks/tasks-ux.test.ts`

**Step 1: Write failing tests**

Test multi-select supports:

- set status;
- set assignee;
- set priority;
- archive;
- partial failure display.

**Step 2: Implement selection state**

Add checkbox or keyboard multi-select per card.

**Step 3: Implement toolbar**

Show toolbar only when selected IDs exist.

**Step 4: Add archived toggle**

Board should call `include_archived=true` and show Archived column only when toggled.

**Step 5: Run tests**

Run focused tests.

**Step 6: Commit**

```bash
git add src/screens/tasks/tasks-screen.tsx src/lib/tasks-api.ts src/screens/tasks/tasks-ux.test.ts
git commit -m "feat(tasks): add Kanban bulk actions and archive view" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 13: Add stats, assignee, tenant filters, and dispatcher controls

**Objective:** Use Agent API stats/config/assignees/dispatch endpoints to make `/tasks` an operations-grade Kanban surface.

**Files:**

- Modify: `src/screens/tasks/tasks-screen.tsx`
- Modify: `src/lib/tasks-api.ts`
- Modify: `src/routes/api/claude-tasks-assignees.ts` or replace with new Kanban assignee route
- Test: focused tests

**Step 1: Add filters**

Filters:

- tenant
- assignee
- status
- include archived

Use board response `tenants` and `assignees`.

**Step 2: Add stats HUD**

Show:

- count by status
- count by assignee
- oldest ready age
- blocked count
- running count

**Step 3: Add dispatch button**

Button: “Dispatch ready tasks” → `POST /dispatch?max=8`.

Show result/warnings.

**Step 4: Run tests**

Run focused tests.

**Step 5: Commit**

```bash
git add src/screens/tasks/tasks-screen.tsx src/lib/tasks-api.ts src/routes/api/*assignees*
git commit -m "feat(tasks): add Kanban filters stats and dispatch controls" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 14: Add live updates via Kanban event stream

**Objective:** Replace 30-second polling as the primary sync mechanism with the Agent Kanban event stream.

**Files:**

- Create: `src/hooks/use-kanban-events.ts`
- Modify: `src/screens/tasks/tasks-screen.tsx`
- Possibly add: `src/routes/api/hermes-kanban.events-token.ts` only if the browser needs a safe token handoff
- Test: hook tests if practical

**Step 1: Decide stream route**

The Agent API has `WS /api/plugins/kanban/events?since=&token=`.

Security note from Agent source:

- HTTP plugin routes are unauthenticated by dashboard middleware because dashboard binds localhost by default.
- WebSocket requires dashboard session token as query param.

SwitchUI must not expose raw long-lived dashboard tokens in v1. Required route:

1. Workspace server owns a WebSocket/SSE proxy to dashboard events; browser connects only to Workspace.
2. Direct browser-to-dashboard WebSocket is explicitly out of scope for v1, even on localhost.

Required: Workspace proxy.

**Step 2: Implement event handling**

When events arrive:

- invalidate board query;
- if detail drawer open for affected task, invalidate detail query;
- update cursor from `latest_event_id`.

**Step 3: Keep polling fallback**

Keep low-frequency polling if WS unavailable.

**Step 4: Commit**

```bash
git add src/hooks/use-kanban-events.ts src/screens/tasks/tasks-screen.tsx src/routes/api/hermes-kanban*
git commit -m "feat(tasks): stream live Kanban updates" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 15: Add legacy `tasks.json` migration/import

**Objective:** Prevent data loss while retiring the old store.

**Files:**

- Create: `src/server/legacy-tasks-migration.ts`
- Create: `src/routes/api/hermes-kanban.migrate-legacy-tasks.ts`
- Modify: `src/screens/tasks/tasks-screen.tsx` to show one-time import banner when legacy tasks exist
- Test: migration tests

**Step 1: Write migration tests**

Given a legacy `tasks.json` task with `priority: "high"`:

```json
{
  "title": "Fix UI",
  "description": "Details",
  "column": "in_progress",
  "priority": "high",
  "tags": ["frontend"],
  "due_date": "2026-05-10"
}
```

Expect Agent create payload with `priority: 3`:

```json
{
  "title": "Fix UI",
  "body": "[Imported from SwitchUI tasks.json]...",
  "priority": 3,
  "triage": false
}
```

Also test `priority: "medium"` → numeric `1` (not `0`), and `priority: "low"` → numeric `-1`. These three cases together guard against the silent regression where `medium` tasks land below the Medium display threshold.

Status mapping after create/update:

- `backlog` → create with `triage: true`
- `todo` → create then patch `status: todo` if needed
- `in_progress` → create then patch `status: running` only if explicitly desired; safer default is `ready` with body note “legacy state: in_progress”
- `review` → create as `ready` or `blocked` only with explicit user choice; safer default is `ready` with body note “legacy state: review”
- `done` → create then patch `status: done` with result “Imported completed task”

**Step 2: Implement dry-run endpoint**

Support:

- `GET /api/hermes-kanban/migrate-legacy-tasks` → returns count and preview
- `POST /api/hermes-kanban/migrate-legacy-tasks` → performs import

**Step 3: Add idempotency**

Use `idempotency_key` such as `switchui-legacy:<legacy-id>` to avoid duplicates. If a legacy task is missing a stable `id`, derive a deterministic fallback key from a normalized hash of `title`, `description/body`, `created_at` when present, and original array index as the final tie-breaker. Record the derived key in the dry-run preview.

**Step 4: Archive old file after successful migration**

Do not delete or rename in-place as the primary safety mechanism because that can break rollback and external tools still expecting the path. Preferred behavior:

- copy `~/.hermes/tasks.json` to `~/.hermes/tasks.json.backup-YYYYMMDD-HHMMSS`;
- write a marker file such as `~/.hermes/tasks.json.migrated` containing timestamp, imported count, and backup path;
- leave the original file untouched unless Rohit explicitly approves archive/rename after validation.

**Step 5: Commit**

```bash
git add src/server/legacy-tasks-migration.ts src/routes/api/hermes-kanban.migrate-legacy-tasks.ts src/screens/tasks/tasks-screen.tsx
git commit -m "feat(tasks): add legacy tasks import to Hermes Kanban" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 16: Deprecate old `/api/claude-tasks` routes safely

**Objective:** Avoid broken internal links while preventing future writes to `tasks.json`.

**Files:**

- Modify: `src/routes/api/claude-tasks.ts`
- Modify: `src/routes/api/claude-tasks.$taskId.ts`
- Modify: `src/server/tasks-store.ts`
- Modify docs: `docs/plans/unified-kanban-task-system.md` or add migration docs

**Step 1: Change old routes to compatibility redirects/proxies**

For one release:

- `GET /api/claude-tasks` proxies to new board/flattened tasks;
- `POST/PATCH/DELETE` either proxy to Agent Kanban or return `410 Gone` with migration instructions, depending on compatibility needs.

Preferred: proxy common create/update/move to Agent Kanban to avoid breaking old clients.

**Step 2: Mark `tasks-store.ts` legacy-only**

Add a top-level comment:

```ts
// Legacy SwitchUI tasks.json store. Do not use for active /tasks board writes.
// Kept only for one-time migration/import support.
```

**Step 3: Update skill/reference if needed**

Patch `hermes-switchui` skill reference later after implementation succeeds so future agents do not write to `tasks.json`.

**Step 4: Commit**

```bash
git add src/routes/api/claude-tasks.ts src/routes/api/claude-tasks.$taskId.ts src/server/tasks-store.ts
git commit -m "refactor(tasks): deprecate legacy tasks json routes" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

### Task 17: Remove or quarantine direct-SQL Swarm Kanban bridge usage

**Objective:** Prevent four Kanban systems from surviving: `tasks.json`, `swarm2-kanban.json`, `kanban.db` direct-SQL bridge, and the `task-store.ts` Zustand localStorage ghost.

**Files:**

- Review/modify: `src/server/kanban-backend.ts`
- Review/modify: `src/server/swarm-kanban-store.ts`
- Review/modify: `src/routes/api/swarm-kanban.ts`
- Review/modify: `src/screens/swarm2/swarm2-kanban-board.tsx`
- **Review/modify: `src/stores/task-store.ts`** — see Step 4 below

**Step 1: Decide Swarm relationship**

Preferred:

- Swarm board should also use Agent Kanban API, scoped by tenant or mission ID.
- If Swarm needs a private planning board, label it as “Swarm mission board” and not “Tasks”.

**Step 2: Fix invalid status mapping if retained**

`mapBoardStatus('backlog')` currently returns `queued`, but dashboard patch accepts `triage`, `todo`, `ready`, `running`, `blocked`, `done`, `archived`. Change backlog mapping to `triage` or remove the bridge.

**Step 3: Add tests**

Ensure no code writes `queued` into Agent Kanban. (The pre-flight fix should have already added the `mapBoardStatus` test; verify it is present and passing.)

**Step 4: Resolve `src/stores/task-store.ts` Zustand ghost**

`task-store.ts` is a Zustand store (persisted to `localStorage` under `clawsuite-tasks-v1`) that calls `GET/POST /api/tasks` and `PATCH/DELETE /api/tasks/${id}` — URL paths that have never existed as Workspace routes. It is consumed by Swarm2 mission orchestration (`upsertMissionTasks`, `getTasksByMission`). Implement whichever decision was made in the Homework Summary:

- **Wire to Agent Kanban (recommended):** Update `task-store.ts` to call `/api/hermes-kanban/*`, using `tenant` or a mission-derived tag to scope the board view. Remove the localStorage persistence for task data (keep only ephemeral UI state if needed). Update `upsertMissionTasks` to call `createKanbanTask` with appropriate tenant/parent fields.
- **Decouple:** Remove the dead `fetch` calls from `syncFromApi`, `addTask`, `updateTask`, `moveTask`, and `deleteTask`. Keep the store as a pure localStorage planning tool for the Swarm2 orchestration layer with no backend sync. Add a comment explaining this is intentionally local-only.
- **Deprecate:** Remove `task-store.ts` entirely and update all Swarm2 import sites to use the Agent Kanban board API directly with mission scoping.

Whichever option is chosen, the dead `/api/tasks` fetch calls must not survive into the unified system.

**Step 5: Commit**

```bash
git add src/server/kanban-backend.ts src/server/swarm-kanban-store.ts src/routes/api/swarm-kanban.ts src/screens/swarm2/swarm2-kanban-board.tsx src/stores/task-store.ts
git commit -m "refactor(swarm): align swarm board with Hermes Kanban" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

---

### Task 18: End-to-end verification

**Objective:** Prove one board, multiple views.

**Files:**

- Add/update tests as needed.
- No production code unless bugs are found.

> **This task requires a live Hermes Agent dashboard on `:9119`.** Steps 2–7 are manual verification and will silently fail if the Agent is not running. In CI environments without a live Agent, skip to Step 8 (automated checks only). Do not mark this task complete based on automated checks alone if Step 0 below fails.

**Step 0: Verify live Agent prerequisite**

```bash
curl -sf http://127.0.0.1:9119/api/status | python3 -m json.tool | grep version
```

Expected: prints a `"version"` field. If this fails, the Agent dashboard is not running; start it before proceeding with Steps 1–7.

Also verify the Kanban plugin is active:

```bash
curl -sf http://127.0.0.1:9119/api/plugins/kanban/board | python3 -m json.tool | head -5
```

Expected: prints a JSON board object. If this returns `404` or fails, the Kanban plugin is not loaded in the running Agent; the full E2E verification cannot proceed.

**Step 1: Start services**

Run Agent dashboard on `:9119` and SwitchUI on `:3000`.

**Step 2: Create task in Agent Dashboard**

Create a task at `http://127.0.0.1:9119/kanban`.

Expected:

- task appears in SwitchUI `/tasks` after refresh or live event.

**Step 3: Create task in SwitchUI**

Create a task at `http://localhost:3000/tasks`.

Expected:

- task appears in Dashboard `/kanban`;
- primary verification uses Agent/Dashboard API responses;
- optional secondary SQLite inspection is read-only only, e.g. `sqlite3 -readonly ~/.hermes/kanban.db 'select ... from tasks'`;
- `~/.hermes/tasks.json` is not modified.

**Step 4: Test comments**

Add comment in SwitchUI drawer.

Expected:

- detail endpoint `GET /api/plugins/kanban/tasks/{id}` shows the comment.

**Step 5: Test dependency/subtask**

Create parent and child link in SwitchUI.

Expected:

- child shows parent in detail;
- parent card shows progress;
- Agent `recompute_ready` behavior still works.

**Step 6: Test status movement**

Move through:

- triage → todo
- todo → ready
- ready → running
- running → blocked
- blocked → ready
- ready → done

Expected:

- Dashboard and SwitchUI stay in sync.
- Events are appended.
- Running task run state is handled by Agent API behavior.

**Step 7: Run automated checks**

Run:

```bash
pnpm test
pnpm build
pnpm lint
```

Expected: PASS.

**Step 8: Commit verification fixes**

If any fixes were needed:

```bash
git add <files>
git commit -m "fix(tasks): stabilize unified Kanban integration" \
  -m "Lore: unified-hermes-kanban-tasks"
```

---

## Acceptance Criteria

- `/tasks` reads from Agent Kanban API, not `~/.hermes/tasks.json`.
- Creating/moving/editing in SwitchUI updates `~/.hermes/kanban.db` through Agent API.
- Creating/moving/editing in Dashboard appears in SwitchUI.
- SwitchUI supports Agent statuses: `triage`, `todo`, `ready`, `running`, `blocked`, `done`, and optional `archived`.
- Task detail supports comments, parent dependencies, child subtasks, event history, run history, and worker logs.
- Board shows comment counts, dependency counts, and child progress on cards.
- Assignee and tenant filters use Agent board data.
- Bulk status/assignee/priority/archive operations use Agent bulk API.
- Live updates use a safe Workspace WS/SSE proxy to the Agent event stream, with polling fallback; direct browser-to-dashboard events are out of scope for v1.
- Legacy `tasks.json` can be imported without data loss and is not modified by normal `/tasks` operations after unification.
- Old `claude` naming is removed or quarantined in the new task system.
- Direct SQLite writes are not used in the primary SwitchUI `/tasks` path.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Dashboard plugin HTTP routes are unauthenticated by design on localhost | Proxy through authenticated Workspace routes; do not expose Dashboard on `0.0.0.0`. |
| WebSocket requires dashboard token | Require Workspace WS/SSE proxy instead of exposing raw dashboard token in v1. |
| Old `review` column has no Agent status | Treat as filter/convention or future upstream status, not persisted status. |
| Old tags/due dates have no Agent fields | Preserve in body annotation during migration; consider upstream metadata fields later. |
| Direct-SQL bridge can drift from Agent CLI semantics | Do not use direct SQLite writes for `/tasks`; use dashboard API/CLI-backed paths. |
| Status changes can affect dispatcher/run semantics | Use Agent API status handling; show confirmation for running → non-running moves. |
| Multiple local branches have active work | Do not blindly commit on dirty branch; create feature branch from user-approved base before implementation. |

---

## Open Design Questions for Rohit

These are product choices, not blockers for the technical plan:

1. Should `review` disappear, become a filter/tag, or should we propose adding `review` as a first-class Agent Kanban status upstream?
2. Should old `due_date` and `tags` be preserved only in task body annotations for now, or should Agent Kanban schema gain metadata fields?
3. Should Swarm mission boards become tenant-scoped views of the same Agent Kanban, or remain separate mission-local planning boards?
4. Should `/tasks` show all Agent statuses by default, or hide `triage`/`archived` behind toggles for a cleaner human board?
5. Should moving a `running` task manually require confirmation because it can reclaim/end active run history?

---

## Execution Handoff

Plan complete. Implementation should be done task-by-task with two-stage review:

1. Spec compliance review: did the task implement exactly what the plan asked?
2. Code quality review: is the solution maintainable, typed, tested, and consistent with SwitchUI conventions?

Use fresh subagents per task if delegating. Do not mix this with unrelated chat/session contamination fixes currently visible in the worktree.
