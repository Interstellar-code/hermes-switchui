# Hermes Kanban Boards — `/boards` Page Implementation Plan

**Date:** 2026-05-13
**Status:** Draft
**Author:** sonnet planner

---

## 1. Goal

Add a `/boards` route to Switch UI that exposes full CRUD for Hermes Agent kanban boards. Each board is an isolated project workspace with its own SQLite database, task set, and agent scope; the new page lets users create, inspect, edit, archive, and delete boards without touching the CLI. The page also surfaces the "active board" concept so users can switch the board that `/tasks` operates on. Out of scope for this plan: cross-page board propagation to `/conductor` and `/operations`, per-board permissions, multi-tenant auth, and custom column management (columns are fixed per the agent API — the UI mockup's column wizard step is deferred).

---

## 2. Design References

- `docs/Design Assets/Hermes-Switchui/boards-app.jsx` — full React mockup (authoritative)
- `docs/Design Assets/Hermes-Switchui/Boards.html` — standalone HTML rendering

Key UX elements extracted from the mockup:

- **Two-panel layout**: narrow left sidebar (`BoardsList`) with filter tabs (All / Active / Archived) + search, and a wide main canvas.
- **Main canvas toolbar**: All / Active / Archived filter chips, global search, grid/list view toggle, aggregate stats (total boards, active count, total tasks), "New Board" primary button.
- **Grid view** (`BoardCard`): color-accented card showing glyph avatar, name, type badge, active-status pill, task breakdown (backlog/todo/running/blocked/done counts), column tags, agent count, last-activity timestamp, inline Open and Delete actions.
- **List view** (`BoardRow`): compact table with columns Name, Path, Tasks, Status, Last Activity, Actions.
- **Board drawer** (`BoardDrawer`): slide-in panel with three tabs — Overview (stat cards + task breakdown + workspace metadata), Columns (read-only ordered list), Settings (inline edit of name/description + Danger Zone with Archive/Unarchive and Delete).
- **Create wizard** (`CreateWizard`): 4-step modal — Step 1 Identity (name, description, board type selector [Project/Research/Sprint/Ops], accent color swatches), Step 2 Workspace (board path + working dir, auto-derived from slug; **deferred — the agent controls storage**), Step 3 Columns (**deferred — columns are fixed by the agent's status set**), Step 4 Review. For MVP, wizard collapses to 2 steps: Identity (name, description, color) → Review.
- **Delete confirm dialog** (`DeleteConfirm`): modal with board name and irreversibility warning, Cancel + Delete Board buttons.
- **Empty state**: centered icon + "No boards found" + prompt to create first board.
- **Active board indicator**: current board highlighted in sidebar + "Open Board" footer button in drawer navigates to `/tasks`.

---

## 3. Hermes-Agent API Surface (Research Findings)

All board endpoints live under the kanban dashboard plugin router, prefixed `/api/plugins/kanban` as seen in `src/server/hermes-kanban-client.ts:19` (`const BASE = '/api/plugins/kanban'`). Switch UI's server-side proxy (`dashboardFetch`) already handles auth token + 401 retry.

### Board Endpoints (verified in `plugin_api.py` lines 1428–1495)

| Method | Path | Request Body | Response | Notes |
|--------|------|-------------|----------|-------|
| `GET` | `/boards` | `?include_archived=false` | `{ boards: BoardMeta[], current: string }` | Each item includes `is_current`, `counts: {status: n}`, `total` |
| `POST` | `/boards` | `{ slug, name?, description?, icon?, color?, switch?: bool }` | `{ board: BoardMeta, current: string }` | Idempotent on slug collision; `switch:true` sets as active |
| `PATCH` | `/boards/{slug}` | `{ name?, description?, icon?, color? }` | `{ board: BoardMeta }` | Slug is immutable |
| `DELETE` | `/boards/{slug}` | `?delete=false` | `{ result: {slug,action,new_path}, current: string }` | Default: archive; `?delete=true` = hard delete |
| `POST` | `/boards/{slug}/switch` | — | `{ current: string }` | Sets active board for CLI/slash parity; UI uses `localStorage` per drawer comment |

### Board Data Model (from `kanban_db.py` lines 362–426)

Fields returned in `BoardMeta`:

```
slug         string    — immutable identifier (path-safe, auto-normalised)
name         string    — display name (defaults to title-cased slug)
description  string    — free text
icon         string    — emoji or short string
color        string    — hex accent color
created_at   int|null  — unix timestamp, set on first write
archived     bool      — soft-delete flag
```

Plus fields injected by `GET /boards` handler (`plugin_api.py:1430–1436`):
```
is_current   bool
counts       {status: count}   — per-status task counts
total        int
```

### Storage & Scoping Mechanism

Boards live as subdirectories under the hermes data root (e.g. `~/.hermes/kanban/boards/{slug}/`). Each board has its own `kanban.db` SQLite file (`kanban_db.py:278–297` `kanban_db_path()`) and a `metadata.json` sidecar (`kanban_db.py:341–426` `board_metadata_path()`). The "active board" is written to a pointer file via `set_current_board()` (`kanban_db.py:225`). All task endpoints accept an optional `?board=<slug>` query param (`plugin_api.py:333`); omitting it defaults to the current board. The dispatcher scope is per-board by database isolation — agents connecting to board A's DB never see board B's tasks.

### Default Board Behaviour

A `default` board is always bootstrapped (`kanban_db.py:480`): `list_boards()` prepends `read_board_metadata(DEFAULT_BOARD)` unconditionally. The default board cannot be hard-deleted (guarded by `remove_board`).

---

## 4. SwitchUI Current State

- **`src/lib/hermes-kanban-types.ts`**: No `Board` or `BoardMeta` type exists. `HermesKanbanBoard` (line 133) refers to the *column layout* returned by `GET /board` (singular) — not a board entity. No `boardSlug` field anywhere.
- **`src/lib/tasks-api.ts`**: `KANBAN_BASE = '/api/hermes-kanban'` (line 39). All calls go to the SwitchUI BFF routes. No board-selection parameter is passed in any function. `getKanbanBoard()` (line 77) calls `GET /api/hermes-kanban/board` with only `tenant` and `include_archived`.
- **`src/routes/api/hermes-kanban/`**: No `boards.ts` route exists. The directory has: `board.ts`, `tasks.ts`, `stats.ts`, `config.ts`, `dispatch.ts`, `bulk.ts`, `assignees.ts`, `links.ts`, `migrate-legacy-tasks.ts`, `events.ts`, `events-token.ts`, `home-channels.ts`, `tasks.$taskId.*.ts`. None accept a board slug param.
- **`src/server/hermes-kanban-client.ts`**: `dashboardFetch` pattern is established (line 9–19); no board CRUD functions exist yet.
- **`src/screens/tasks/tasks-screen.tsx`**: No board switcher UI. The word "board" appears only in the context of the kanban view toggle (Grid/Swim/Time), not board selection (lines 265–266).

**Summary**: SwitchUI is fully hardwired to the default/current board today. No board awareness exists anywhere in the client or BFF layer.

---

## 5. SDD-Style Scope

**In scope (MVP):**
- `/boards` TanStack route + screen shell
- `BoardMeta` TypeScript type + `KanbanBoardsResponse` response type
- `listBoards`, `createBoard`, `updateBoard`, `deleteBoard`, `switchBoard` functions in `src/server/hermes-kanban-client.ts`
- BFF API routes: `GET /api/hermes-kanban/boards`, `POST /api/hermes-kanban/boards`, `PATCH /api/hermes-kanban/boards/$slug`, `DELETE /api/hermes-kanban/boards/$slug`, `POST /api/hermes-kanban/boards/$slug/switch`
- Client API functions in `src/lib/tasks-api.ts` (or new `src/lib/boards-api.ts`)
- TanStack Query hooks: `useBoards`, `useCreateBoard`, `useUpdateBoard`, `useDeleteBoard`, `useSwitchBoard`
- Board list (grid + list view) matching mockup `BoardCard` / `BoardRow` / `BoardsCanvas`
- Left sidebar `BoardsList` with filter tabs + search
- Main area toolbar with filter chips, search, view toggle, stat counters, "New Board" button
- Create dialog — simplified 2-step wizard: Identity (name, description, color, slug preview) → Review + Create
- Board drawer (3 tabs: Overview, Columns read-only, Settings with inline edit + danger zone)
- Delete confirm dialog (archive default; hard-delete behind `?delete=true` query param)
- Empty state (zero boards)
- Loading skeleton + error boundary for dashboard-unavailable (503 pattern from existing routes)
- Navigation: add "Boards" entry to primary nav pointing at `/boards`
- "Open Board" in drawer footer navigates to `/tasks` (no board scoping change in this plan)
- Tests for BFF routes and client API functions

**Out of scope (deferred):**
- Cross-page board propagation: `/tasks` board-slug param, `/conductor`, `/operations` board awareness
- Column management (add/remove/reorder columns) — the agent's status set is fixed; wizard step 3 is deferred
- Board path / working directory fields (Step 2 of wizard) — storage is agent-controlled
- `POST /boards/{slug}/switch` syncing agent-side active board (localStorage is sufficient for UI; agent CLI sync is a follow-up)
- Board permissions / multi-tenant auth
- Board-scoped SSE event stream (tasks screen already subscribes; boards page uses polling via TanStack Query)
- Archived board restore (unarchive) — the danger zone button exists in mockup but is deferred; archive/unarchive can be a fast follow
- Mobile responsiveness beyond basic flex wrapping

---

## 6. Acceptance Criteria

1. `GET /boards` in the browser fetches from `GET /api/hermes-kanban/boards` which proxies to `GET /api/plugins/kanban/boards`; the board list renders within 200 ms on localhost.
2. Creating a board via the wizard calls `POST /api/hermes-kanban/boards`; on success the new board appears at the top of the grid without a full-page reload.
3. Editing a board's name/description via the drawer Settings tab calls `PATCH /api/hermes-kanban/boards/:slug`; the card title updates immediately via optimistic mutation.
4. Clicking Archive in the danger zone calls `DELETE /api/hermes-kanban/boards/:slug` (no `?delete=true`); the board moves to the Archived filter tab.
5. Clicking Delete Board in the confirm dialog calls `DELETE /api/hermes-kanban/boards/:slug?delete=true`; the board is removed from the list.
6. The `default` board cannot be hard-deleted; the Delete button is disabled or absent for it.
7. Filter tabs (All / Active / Archived) and search correctly narrow the displayed boards client-side.
8. Grid and list view toggle persists in `localStorage` across page refreshes.
9. "Open Board" in the drawer footer navigates to `/tasks`.
10. When the hermes-agent dashboard is unreachable, the page renders a 503 error state matching the pattern in `src/routes/api/hermes-kanban/stats.ts`.
11. BFF route unit tests cover: 200 list response shape, 400 on malformed slug, 404 on unknown slug for PATCH/DELETE, 503 passthrough when dashboard is down.
12. The boards count badge in primary nav reflects the live count from `GET /boards`.

---

## 7. File-by-File Plan (SDD Tasks)

### Task 1 — TypeScript Types

**Objective**: Define `BoardMeta`, `CreateBoardInput`, `UpdateBoardInput`, `KanbanBoardsListResponse` in the shared types file.

**Files (modify)**:
- `src/lib/hermes-kanban-types.ts`

**Steps**:
1. Add `BoardMeta` interface with fields: `slug`, `name`, `description`, `icon`, `color`, `created_at: number | null`, `archived`, `is_current`, `counts: Record<string, number>`, `total`.
2. Add `CreateBoardInput`: `{ slug: string; name?: string; description?: string; icon?: string; color?: string; switch?: boolean }`.
3. Add `UpdateBoardInput`: `{ name?: string; description?: string; icon?: string; color?: string }`.
4. Add `KanbanBoardsListResponse`: `{ boards: BoardMeta[]; current: string }`.
5. Verify: `pnpm check` passes with no type errors.

---

### Task 2 — Server-Side Client Functions

**Objective**: Add board CRUD functions to the server-side kanban client, following the `dashboardFetch` pattern established at `hermes-kanban-client.ts:21`.

**Files (modify)**:
- `src/server/hermes-kanban-client.ts`

**Steps**:
1. Add `listBoards(includeArchived?: boolean): Promise<KanbanBoardsListResponse>` — `GET ${BASE}/boards`.
2. Add `createBoard(input: CreateBoardInput): Promise<{ board: BoardMeta; current: string }>` — `POST ${BASE}/boards`.
3. Add `updateBoard(slug: string, input: UpdateBoardInput): Promise<{ board: BoardMeta }>` — `PATCH ${BASE}/boards/${slug}`.
4. Add `deleteBoard(slug: string, hardDelete?: boolean): Promise<{ result: object; current: string }>` — `DELETE ${BASE}/boards/${slug}?delete=${hardDelete}`.
5. Add `switchBoard(slug: string): Promise<{ current: string }>` — `POST ${BASE}/boards/${slug}/switch`.
6. Run `pnpm check`; fix any type errors.

---

### Task 3 — BFF API Routes

**Objective**: Add five server-side TanStack API routes that proxy board CRUD to the dashboard, following the pattern in `src/routes/api/hermes-kanban/board.ts`.

**Files (create)**:
- `src/routes/api/hermes-kanban/boards.ts` — handles `GET` and `POST`
- `src/routes/api/hermes-kanban/boards.$slug.ts` — handles `PATCH` and `DELETE`
- `src/routes/api/hermes-kanban/boards.$slug.switch.ts` — handles `POST`

**Steps**:
1. `boards.ts`: `GET` calls `listBoards()`, returns JSON. `POST` parses body, calls `createBoard()`, returns JSON. Both catch errors and return `{ error, mode: 'dashboard-unavailable' }` with status 503 on throw.
2. `boards.$slug.ts`: `PATCH` calls `updateBoard(slug, body)`. `DELETE` reads `?delete` query param, calls `deleteBoard(slug, delete)`. 404 passthrough when agent returns 404.
3. `boards.$slug.switch.ts`: `POST` calls `switchBoard(slug)`.
4. Verify routes appear in `src/routeTree.gen.ts` after `pnpm dev` regeneration (auto-generated — do not edit manually).
5. Write unit tests in `src/routes/api/hermes-kanban/boards.test.ts` covering the acceptance criteria in §6 item 11. Use the same mock pattern as existing kanban route tests.

---

### Task 4 — Client-Side API Functions + Query Hooks

**Objective**: Add `src/lib/boards-api.ts` with fetch functions and TanStack Query hooks for the boards BFF routes.

**Files (create)**:
- `src/lib/boards-api.ts`

**Steps**:
1. Define `fetchBoards(includeArchived?: boolean)` — `GET /api/hermes-kanban/boards`.
2. Define `fetchCreateBoard(input: CreateBoardInput)` — `POST /api/hermes-kanban/boards`.
3. Define `fetchUpdateBoard(slug, input)` — `PATCH /api/hermes-kanban/boards/${slug}`.
4. Define `fetchDeleteBoard(slug, hardDelete?)` — `DELETE /api/hermes-kanban/boards/${slug}`.
5. Define `fetchSwitchBoard(slug)` — `POST /api/hermes-kanban/boards/${slug}/switch`.
6. Export query key factory: `boardsKeys = { all: ['boards'], list: (archived: boolean) => [...] }`.
7. Export `useBoards(includeArchived?)` — `useQuery` wrapping `fetchBoards`.
8. Export `useCreateBoard()`, `useUpdateBoard()`, `useDeleteBoard()`, `useSwitchBoard()` — `useMutation` with `onSuccess` invalidating `boardsKeys.all`.
9. `pnpm check` + `pnpm test` pass.

---

### Task 5 — Boards Screen Components

**Objective**: Build the `/boards` page screen following the mockup structure in `boards-app.jsx`.

**Files (create)**:
- `src/screens/boards/boards-screen.tsx` — root screen component
- `src/screens/boards/boards-list-sidebar.tsx` — left sidebar (`BoardsList`)
- `src/screens/boards/board-card.tsx` — grid card (`BoardCard`)
- `src/screens/boards/board-row.tsx` — list row (`BoardRow`)
- `src/screens/boards/boards-canvas.tsx` — grid/list switcher + empty state (`BoardsCanvas`)
- `src/screens/boards/board-drawer.tsx` — slide-in detail drawer (`BoardDrawer`) with 3 tabs
- `src/screens/boards/create-board-wizard.tsx` — 2-step create modal (Identity → Review)
- `src/screens/boards/delete-confirm-dialog.tsx` — delete confirmation modal

**Steps**:
1. Build `board-card.tsx` and `board-row.tsx` first (leaf nodes, no state). Accept `board: BoardMeta` + `onOpen`, `onDelete` callbacks. Use `--bc` CSS custom property for accent color matching the mockup.
2. Build `boards-canvas.tsx`: renders grid (`brd-grid`) or list (`brd-table`) from `boards: BoardMeta[]`, delegates to card/row, renders empty state when `boards.length === 0`.
3. Build `boards-list-sidebar.tsx`: filter tabs (All / Active / Archived), search input, scrollable list, footer counts. Pure presentational — state lives in parent.
4. Build `create-board-wizard.tsx`: 2 steps. Step 1: name (required, min 2 chars), description, color swatch picker (6 colors from mockup), live slug preview derived via `slugify()`. Step 2: review panel. On submit calls `useCreateBoard()` mutation; closes on success; shows inline error on failure. Validate slug is path-safe before submit.
5. Build `delete-confirm-dialog.tsx`: renders board name, Cancel + Delete Board buttons. Calls `useDeleteBoard()` with `hardDelete: true` on confirm.
6. Build `board-drawer.tsx`: scrim + slide-in panel. Overview tab: stat cards (Total/Running/Done/Blocked), task breakdown, workspace section (slug, created_at). Columns tab: ordered read-only list from `counts` keys. Settings tab: inline edit form (name, description) calling `useUpdateBoard()`, danger zone with Archive button (`useDeleteBoard()` without `hardDelete`) and Delete button (opens `DeleteConfirm`). "Open Board" footer button → `navigate('/tasks')`.
7. Build `boards-screen.tsx`: wire all pieces together. State: `view` (grid|list, persisted to `localStorage`), `filter` (all|active|archived), `search`, `activeSlug` (for drawer), `confirmDelete`. Use `useBoards()` with `includeArchived: filter === 'archived' || filter === 'all'`. Loading skeleton and 503 error state.
8. Apply Matrix design tokens (`var(--m-*)`) throughout, referencing `docs/Design Assets/Hermes-Switchui/matrix-system.css` and `tokens.css`.

---

### Task 6 — Route + Navigation

**Objective**: Wire the screen into TanStack Router and add a nav entry.

**Files (modify)**:
- `src/routes/boards.tsx` — new TanStack route file
- Primary nav component (identify exact file via `grep -r "tasks\|/tasks" src/components/` — likely the primary nav component)

**Steps**:
1. Create `src/routes/boards.tsx` with `createFileRoute('/boards')` exporting a `component` that renders `<BoardsScreen />`. Import is lazy via `React.lazy` to match existing route patterns.
2. `routeTree.gen.ts` regenerates automatically on next `pnpm dev`.
3. Add "Boards" nav item to the primary nav, with the kanban-grid SVG icon from the mockup (`<rect x="3" y="4" ...>`), linking to `/boards`. Mark active when pathname is `/boards`.
4. Confirm nav renders in both collapsed and expanded states.

---

### Task 7 — Integration Smoke Test

**Objective**: Verify end-to-end CRUD against a live hermes-agent instance.

**Steps**:
1. `pnpm dev` — confirm `/boards` route renders without console errors.
2. Create a board via wizard; confirm it appears in the list and `GET /api/plugins/kanban/boards` reflects the new slug.
3. Edit name via drawer Settings; confirm card updates.
4. Archive via danger zone; confirm board moves to Archived tab.
5. Delete via confirm dialog; confirm board is removed.
6. Click "Open Board" in drawer; confirm navigation to `/tasks`.
7. `pnpm build` — confirm no type errors or dead imports.

---

## 8. Risks & Open Questions

- **Default board protection**: The agent guards `default` from hard-delete (`kanban_db.py:509+`). The UI must disable or hide the Delete button for the default board (check `board.slug === 'default'`). The Archive button for default should also be suppressed or warned.
- **`/tasks` board isolation**: After MVP, `/tasks` still shows the default/current board; users may be confused if they create a new board and navigate to tasks without seeing it scoped. This is documented as a known gap — cross-page board prop is the first follow-up.
- **`POST /boards/{slug}/switch` vs localStorage**: The agent comment (`plugin_api.py:1491`) says the UI uses `localStorage` for the active board pointer while the endpoint serves CLI parity. For MVP, Switch UI will call the endpoint on board switch to keep CLI and UI in sync.
- **Dispatcher mid-task board switch**: If a user switches the active board while the dispatcher is running tasks on the previous board, claimed tasks remain on the old board (the zombie worker issue noted in project memory applies here). No mitigation in MVP — document in the screen tooltip.
- **Migration for single-board users**: Existing users have only the `default` board. The first load of `/boards` will show one board card. No migration needed — the default board always exists.
- **Slug validation**: The agent normalises slugs (`_normalize_board_slug` in `plugin_api.py:76`). The UI should slugify on the client (name → lowercase, non-alphanumeric → `-`, trim dashes) and show the resolved slug before submit to avoid surprises.
- **Board type field**: The mockup has a `type` field (project/research/sprint/ops) but the agent's `BoardMeta` has no `type` field — it's a UI-only concept in the mockup. For MVP, omit the type selector; store it in `description` or drop it.
- **Color picker**: The mockup uses 6 hex swatches matching Matrix palette. These can be hardcoded constants in the component.

---

## 9. Recommended Implementation Order

1. **Task 1** — Types (unblocks everything downstream)
2. **Task 2** — Server client functions (unblocks BFF routes)
3. **Task 3** — BFF routes + tests (unblocks client hooks)
4. **Task 4** — Client hooks (unblocks screen components)
5. **Task 5, leaf components first** — `board-card`, `board-row`, `boards-canvas`, then `create-board-wizard`, `delete-confirm-dialog`, then `board-drawer`, then `boards-screen`
6. **Task 6** — Route + nav (requires screen to exist)
7. **Task 7** — Integration smoke test (final gate)

Dependencies: Tasks 1 → 2 → 3 → 4 → 5 → 6 are sequential. Within Task 5, card/row/canvas can be built in parallel with wizard/delete-confirm; drawer requires canvas. Route wiring (Task 6) is last.

---

## 10. Codex Review Hooks

Pre-emptive flags for Codex gap review:

- **API contract compliance**: Verify every BFF handler passes the correct `?include_archived`, `?delete` query params. Confirm `PATCH` body uses `name/description/icon/color` (not camelCase — the agent uses snake-case field names in JSON).
- **Error handling**: All five BFF routes must return `{ error: string, mode: 'dashboard-unavailable' }` with 503 when `dashboardFetch` throws, matching the pattern in `board.ts:20–21`. The client layer must surface these as user-visible error states, not unhandled promise rejections.
- **Slug immutability**: Editing a board must never send the `slug` field in the `PATCH` body — the agent ignores it, but the UI must not suggest renaming via slug is possible.
- **Default board guard**: `board.slug === 'default'` check before rendering Delete and Archive buttons.
- **Path-safe slug validation**: Client-side `slugify()` must reject empty strings and strings that normalise to empty. Show inline error before Step 2 if slug resolves to empty.
- **Accessibility**: Wizard modal and drawer must be `role="dialog"` with `aria-label`, focus-trapped, and closeable with Escape. Confirm dialog must be `role="alertdialog"`.
- **Mobile responsiveness**: The two-panel layout (sidebar + canvas) must collapse to single-column on narrow viewports. The mockup is desktop-first; add a breakpoint at `768px` where the sidebar becomes a top filter bar.
- **Query invalidation**: After `createBoard`, `deleteBoard`, `updateBoard` mutations, `boardsKeys.all` must be invalidated so the sidebar count and main canvas both refresh without stale data.
