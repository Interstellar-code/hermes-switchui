# `/conductor` Page UI — Implementation Plan

Reference design: `docs/Design Assets/Hermes-Switchui/Conductor.html` (1436 lines)
Reference screenshot: `docs/Design Assets/Hermes-Switchui/screenshots/conductor-fixed.png`
Current stub: `src/screens/gateway/conductor.tsx` (placeholder), mounted by `src/routes/conductor.tsx`.
Existing store reused as-is: `src/stores/mission-store.ts` (rich mission model already present; UI binds, no shape changes in milestone 1–3).

Scope summary: rebuild the `/conductor` screen as a 3-zone CSS-grid layout (top bar / main canvas / right mission rail) that matches `conductor-fixed.png`. Ship statically first, then wire to existing mission-store + a single new lightweight `/api/conductor/state` route. No legacy backend (deleted in `b9364412`) is resurrected. PrimaryNav remains the canonical app shell; this plan touches only the conductor content region.

---

## 1. Component decomposition

All new files under `src/screens/gateway/conductor/` (new folder). The screen's existing public entry stays `src/screens/gateway/conductor.tsx`, re-exporting `Conductor` so `src/routes/conductor.tsx` is untouched.

| Path | Component | Responsibility | Parent |
|---|---|---|---|
| `src/screens/gateway/conductor.tsx` | `Conductor` | Top-level export. Imports `matrix-conductor.css`. Renders `<ConductorLayout>`. | route `/conductor` |
| `src/screens/gateway/conductor/conductor-layout.tsx` | `ConductorLayout` | CSS-grid shell: `grid-template-columns: 1fr 320px; grid-template-rows: 56px 1fr`. Hosts the three regions. | `Conductor` |
| `src/screens/gateway/conductor/conductor-top-bar.tsx` | `ConductorTopBar` | Breadcrumb + 4 KPI counters + refresh/theme icon buttons. | `ConductorLayout` |
| `src/screens/gateway/conductor/conductor-main.tsx` | `ConductorMain` | Vertical stack: `NowPlayingStrip` → `MissionCanvas` (Flow/Org toggle) → `WorkerLanes` → `LaneLegend`. | `ConductorLayout` |
| `src/screens/gateway/conductor/now-playing-strip.tsx` | `NowPlayingStrip` | Elapsed stamp, mission prompt line, routing meta line, phase pills (`PlanRouteExecuteReportPills`). | `ConductorMain` |
| `src/screens/gateway/conductor/phase-pills.tsx` | `PhasePills` | Renders ordered phase chips (PLAN / ROUTE / EXECUTE / REVIEW / REPORT) with active + completed states. | `NowPlayingStrip` |
| `src/screens/gateway/conductor/mission-canvas.tsx` | `MissionCanvas` | Switchable DAG canvas: `flow` (mission DAG) vs `org` (3-tier hierarchy). Uses inline SVG, copied structure from design HTML. | `ConductorMain` |
| `src/screens/gateway/conductor/worker-lanes.tsx` | `WorkerLanes` | Time-ruled gantt-style track per worker. Each lane = `LaneRow`. Scale buttons (1m/5m/15m/1h). | `ConductorMain` |
| `src/screens/gateway/conductor/lane-row.tsx` | `LaneRow` | Single worker row: name + role pill + absolutely-positioned `LaneBlock`s + `now-line`. | `WorkerLanes` |
| `src/screens/gateway/conductor/lane-legend.tsx` | `LaneLegend` | Static legend (execute/tool/review/handoff/error). | `ConductorMain` |
| `src/screens/gateway/conductor/mission-rail.tsx` | `MissionRail` | Right column shell: `MissionRailHeader` + `MissionFilters` + scrolling `MissionList` + `MissionRailFooter`. | `ConductorLayout` |
| `src/screens/gateway/conductor/mission-filters.tsx` | `MissionFilters` | Tabs `ALL / LIVE / DONE / ERR` with counts. | `MissionRail` |
| `src/screens/gateway/conductor/mission-list.tsx` | `MissionList` | Grouped by day buckets (`Now`, `Earlier today`, `Yesterday`). Renders `MissionCard`s. | `MissionRail` |
| `src/screens/gateway/conductor/mission-card.tsx` | `MissionCard` | Live/done/err variants, title + sub + badges + token count + focus/replay action. | `MissionList` |
| `src/screens/gateway/conductor/new-mission-dialog.tsx` | `NewMissionDialog` | Portal modal for "+ NEW MISSION" — goal text, optional team override, budget pick. | `MissionRail` (footer button) |
| `src/screens/gateway/conductor/mission-detail-drawer.tsx` | `MissionDetailDrawer` | Right-aligned drawer with transcript + phase log when a `MissionCard` is clicked. | `Conductor` (portal) |

### TypeScript signatures

```ts
// shared types — src/screens/gateway/conductor/types.ts
export type MissionPhase = 'plan' | 'route' | 'execute' | 'review' | 'report'
export type MissionLifecycle = 'live' | 'done' | 'err' | 'paused'
export type WorkerLaneKind = 'run' | 'tool' | 'review' | 'handoff' | 'err'

export interface ConductorKpis {
  liveMissions: number
  elapsedSeconds: number     // for the focused mission
  workersActive: number
  tokensUsed: number
}

export interface MissionSummary {
  id: string                  // "T_xxxxxxxx"
  title: string               // first line of goal
  subtitle: string            // "routed by switch · 3 domains · 7 tasks"
  lifecycle: MissionLifecycle
  startedAt: number
  endedAt?: number
  tokensUsed: number
  domains: string[]           // ["NEO","TRINITY","MORPHEUS"]
  taskCount: number
  budgetTokens?: number
  estDurationSeconds?: number
  phase: MissionPhase
  routedBy?: 'switch' | 'manual'
}

export interface WorkerLaneBlock {
  id: string
  laneId: string
  kind: WorkerLaneKind
  label: string
  startOffsetMs: number       // relative to now
  durationMs: number
  isLive?: boolean
}

export interface WorkerLane {
  id: string
  name: string                 // "sage"
  role: 'orch' | 'w'
  status: 'active' | 'idle' | 'error'
  blocks: WorkerLaneBlock[]
}

// Component props
export interface ConductorTopBarProps { kpis: ConductorKpis; onRefresh: () => void; onToggleTheme: () => void }
export interface NowPlayingStripProps { mission: MissionSummary | null }
export interface PhasePillsProps { active: MissionPhase; completed: MissionPhase[] }
export interface MissionCanvasProps { view: 'flow' | 'org'; onChangeView: (v: 'flow' | 'org') => void; mission: MissionSummary | null }
export interface WorkerLanesProps { lanes: WorkerLane[]; scale: '1m' | '5m' | '15m' | '1h'; onChangeScale: (s: WorkerLanesProps['scale']) => void }
export interface LaneRowProps { lane: WorkerLane; windowMs: number }
export interface MissionRailProps {
  missions: MissionSummary[]
  activeFilter: 'all' | 'live' | 'done' | 'err'
  focusedMissionId: string | null
  onChangeFilter: (f: MissionRailProps['activeFilter']) => void
  onSelectMission: (id: string) => void
  onNewMission: () => void
}
export interface MissionFiltersProps { counts: Record<'all' | 'live' | 'done' | 'err', number>; active: MissionRailProps['activeFilter']; onChange: MissionRailProps['onChangeFilter'] }
export interface MissionListProps { missions: MissionSummary[]; focusedMissionId: string | null; onSelect: (id: string) => void }
export interface MissionCardProps { mission: MissionSummary; isFocused: boolean; onSelect: () => void; onReplay: () => void }
export interface NewMissionDialogProps { open: boolean; onClose: () => void; onSubmit: (input: { goal: string; budget?: string }) => void }
export interface MissionDetailDrawerProps { mission: MissionSummary | null; onClose: () => void }
```

---

## 2. Data flow + state shape

### Zustand (extend, do NOT replace `mission-store.ts`)

New slim store `src/stores/conductor-ui-store.ts` — UI-only, no persistence of mission domain data (that already lives in `mission-store.ts`).

```ts
type ConductorUiStore = {
  canvasView: 'flow' | 'org'
  laneScale: '1m' | '5m' | '15m' | '1h'
  railFilter: 'all' | 'live' | 'done' | 'err'
  focusedMissionId: string | null
  newMissionDialogOpen: boolean
  detailDrawerMissionId: string | null
  goalDraft: string
  setCanvasView(v): void
  setLaneScale(s): void
  setRailFilter(f): void
  setFocusedMissionId(id): void
  openNewMission(): void
  closeNewMission(): void
  setGoalDraft(s): void
  openDetail(id): void
  closeDetail(): void
}
```

Persisted via `zustand/middleware` `persist` under key `clawsuite:conductor-ui` with allowlist `['canvasView','laneScale','railFilter','goalDraft']`.

### TanStack Query

| Query key | Source | Refetch |
|---|---|---|
| `['conductor','state']` | new `GET /api/conductor/state` (returns KPIs + active mission summary + lanes) | `refetchInterval: 2000` when active mission exists, `15000` otherwise |
| `['conductor','missions','today']` | new `GET /api/conductor/missions?bucket=today` | `15000` |
| `['conductor','missions',missionId]` | new `GET /api/conductor/missions/:id` (for detail drawer) | on demand |
| `['models']` | existing `/api/models` | 5 min stale |
| `['sessions']` | existing `/api/sessions` | already used elsewhere |

### Live updates

Polling first (2s interval). Optional SSE upgrade is **out of scope for milestone 1–4** and listed as an open question. The 2s poll covers the active mission KPI counters; lane animations are CSS-only (no per-tick state).

### localStorage keys

- `clawsuite:conductor-ui` — Zustand persist (UI prefs).
- `clawsuite:mission-store` — already in use by `mission-store.ts`. Not modified.
- `conductor:active-mission-hint` — last focused mission id for cross-tab restore; optional, can defer.

### Client/server contract

- Client only writes mission state via `POST /api/conductor/missions` (start) and `POST /api/conductor/missions/:id/abort` (stop).
- Replay = client-side; opens `MissionDetailDrawer` with transcript, no orchestrator re-run. (Open question — confirm before milestone 5.)
- Focus is purely a client concept (which mission the canvas/lanes render); server is unaware.

---

## 3. Backend API routes

**Decision: (A) Minimal new conductor-specific routes.** Rationale: the legacy backend was deleted intentionally; reusing `/api/send-stream` would force every consumer to reconstruct mission grouping client-side every poll, and the existing routes don't expose worker-lane semantics. A *thin* fresh surface (3 endpoints) gives the UI a clean contract while keeping server logic close to zero — the routes are read-mostly aggregators over sessions/history plus a tiny JSON file for mission metadata, with no orchestration logic at all.

### Routes (all under `src/routes/api/conductor/`)

```
GET  /api/conductor/state
GET  /api/conductor/missions?bucket=today|yesterday|all&limit=50
GET  /api/conductor/missions/:id
POST /api/conductor/missions            // create / start (returns id)
POST /api/conductor/missions/:id/abort  // mark aborted
```

All routes:
- Require `auth-middleware` session token (existing helper, **not modified**).
- Apply existing `rate-limit` per IP (**not modified**).
- POST routes require `Content-Type: application/json` (existing CSRF gate).
- Persist mission docs to `~/.hermes/conductor/missions/{id}.json` (new directory; no schema migration of any other file).

### Payload shapes

```ts
// GET /api/conductor/state -> 200
{
  kpis: ConductorKpis,
  active: MissionSummary | null,
  lanes: WorkerLane[]
}

// GET /api/conductor/missions -> 200
{ missions: MissionSummary[] }

// POST /api/conductor/missions  body: { goal: string, budget?: string }
// -> 200 { id: string }

// POST /api/conductor/missions/:id/abort -> 200 { ok: true }
```

### Hard-no-touch list (per request, repeated here for executor)

`gateway-api.ts`, `gateway-capabilities.ts`, `hermes-api.ts`, `auth-middleware.ts`, `rate-limit.ts`, `/api/send-stream`, `/api/history`, `/api/models`, `/api/files`, `office-view.tsx`, `agents-working-panel.tsx`, `agent-hub-layout.tsx`, `streaming-text.tsx`.

---

## 4. Styling approach

### File structure

- `src/styles/matrix-conductor.css` — new, owns every selector prefixed `.cnd-*`, `.now-*`, `.lane-*`, `.miss-*`, `.h-*` ported from the design HTML.
- Imported once at the top of `src/screens/gateway/conductor.tsx`.
- No global selectors, no overrides of existing `matrix-*.css` files. CSS custom properties only — never hex values inline.

### Token usage map (matches design `Conductor.html`)

| Surface | Primary token | Fallback |
|---|---|---|
| Page background | `var(--m-bg)` | `var(--theme-bg)` |
| Top bar / nav background | `var(--m-sidebar)` | `var(--theme-panel)` |
| Panel surfaces (NowPlaying, MissionRail) | `var(--m-panel)` | `var(--theme-surface)` |
| Borders (strong) | `var(--m-border)` | `var(--theme-border)` |
| Borders (subtle) | `var(--m-border-subtle)` | rgba fallback |
| Accent / live | `var(--m-green-500)` | `var(--theme-accent)` |
| Mono font stack | `var(--m-font-mono)` | `var(--theme-font-mono)` |
| Glow effects | `var(--m-glow-sm)` / `var(--m-glow-md)` | none (degrade silently) |
| Error red | `var(--m-danger)` | `var(--theme-danger)` |
| Info blue (tool blocks) | `var(--m-info)` | `var(--theme-info)` |
| Warning yellow (review blocks) | `var(--m-warning)` | `var(--theme-warning)` |
| Pink (handoff blocks) | `var(--m-pink)` | `var(--theme-pink, var(--theme-accent))` |
| Text strong | `var(--m-text-strong)` | `var(--theme-fg)` |
| Text muted / faint | `var(--m-text-muted)` / `var(--m-text-faint)` | `var(--theme-fg-muted)` |

Every `--m-*` must be paired with a `var(--theme-*, …)` fallback so non-matrix themes (`claude-nous`, `claude-official`, etc.) render. This continues the pattern established in commits `ff8dfe6b`, `4340daa9`, `f3150f28`.

### Animation choices

- `@keyframes pulse` on the NowPlaying live-dot (1.6s ease-in-out infinite).
- `@keyframes livepulse` on lane blocks tagged `.live` (glow oscillation).
- Phase-pill active transition: `transition: background 200ms ease, color 200ms ease;` plus a `text-shadow: var(--m-text-glow)` when active.
- No JS-driven typing/stream effect in milestone 1–3 (mock data is static).

### Responsive

- `min-width: 1280px` design target. Below `1180px` collapse the right rail into a slide-over (hidden by default, opened via top-bar icon). Below `960px` show "Conductor is optimised for wider screens" stub (matches pattern used on `/operations`).
- Use `clamp()` for the NowPlaying `b` size: `clamp(18px, 1.4vw, 24px)`.

---

## 5. Iteration milestones for ralph-loop + visual-verdict

Each milestone is a single ralph iteration: edit → `pnpm dev` → headless screenshot of `http://localhost:3000/conductor` → run OMC `visual-verdict` against `docs/Design Assets/Hermes-Switchui/screenshots/conductor-fixed.png` → iterate until verdict ≥ "match".

### M1 — Static grid shell + top bar (no data, no backend)

- Create the folder `src/screens/gateway/conductor/`, all components as static JSX with hard-coded values from the design HTML.
- Create `src/styles/matrix-conductor.css` with the full token-mapped stylesheet.
- Replace stub `Conductor` export to render `<ConductorLayout>`.
- **Done when:** screenshot shows the 3-zone grid, the top breadcrumb, four KPI counters (`1 / 04:18 / 5 / 8.4k`), refresh+theme icon buttons. Visual diff against `conductor-fixed.png` for the top 56px strip is < 5% pixel delta.
- **Files:** `src/screens/gateway/conductor.tsx`, `src/screens/gateway/conductor/conductor-layout.tsx`, `conductor-top-bar.tsx`, `src/styles/matrix-conductor.css`.
- **Backend:** none.

### M2 — Static NowPlaying strip + phase pills + mission canvas placeholder

- Add `NowPlayingStrip`, `PhasePills` with the design's hard-coded `T_67fc8810` mission, "ROUTED BY SWITCH · NEO TRINITY MORPHEUS · 7 TASKS · 18 MIN", elapsed 04:18, 8.4K/26K budget.
- Add `MissionCanvas` with the flow/org toggle, but render only the toggle header + an empty `<svg viewBox>` (full SVG content lifted in M3).
- **Done when:** screenshot mirrors the screenshot's centre column above the lane region, phase pill `EXECUTE` is highlighted, toggle visually distinguishes `flow` (active) vs `org`. Visual-verdict on centre column ≥ "close".
- **Files:** `now-playing-strip.tsx`, `phase-pills.tsx`, `mission-canvas.tsx`, additions to `matrix-conductor.css`.
- **Backend:** none.

### M3 — Worker lanes (gantt) + legend, static blocks

- Port the six lanes (sage/drift/neo/echo/blaze/nova) and their block geometry from `Conductor.html` lines 1070–1162 directly into TSX with the hard-coded `style={{ left: '…%', width: '…%' }}` values.
- Render `now-line` overlay + scale buttons (visually only).
- Add legend row.
- **Done when:** screenshot now matches `conductor-fixed.png` for the entire main column (top bar + now-playing + canvas chrome + lanes + legend). Visual-verdict overall ≥ "close" with delta concentrated in the right rail.
- **Files:** `worker-lanes.tsx`, `lane-row.tsx`, `lane-legend.tsx`.
- **Backend:** none.

### M4 — Mission rail (right column), static list + filters + footer CTA

- Render `MissionRail` with the four filter tabs, the `Now`/`Earlier today`/`Yesterday` day groupings, and the seven `MissionCard`s from the design HTML.
- Wire `+ NEW MISSION` button to open `NewMissionDialog` (purely client, dispatches a no-op on submit).
- **Done when:** screenshot matches `conductor-fixed.png` end-to-end. Visual-verdict ≥ "match" for the full viewport.
- **Files:** `mission-rail.tsx`, `mission-filters.tsx`, `mission-list.tsx`, `mission-card.tsx`, `new-mission-dialog.tsx`.
- **Backend:** none.

### M5 — Wire `conductor-ui-store` + interactive state

- Introduce `src/stores/conductor-ui-store.ts`. Bind: canvas flow/org toggle, lane scale buttons, mission filter tabs, focused mission card highlight, new-mission dialog open/close, goal-draft persistence.
- All data still mocked client-side (move the hard-coded mission/lane arrays into `src/screens/gateway/conductor/mock-data.ts`).
- **Done when:** clicking filter tabs visibly filters the list, clicking a mission card toggles its `.live`-style highlight, clicking flow/org swaps the canvas. Visual baseline screenshot unchanged.
- **Files:** `src/stores/conductor-ui-store.ts`, `src/screens/gateway/conductor/mock-data.ts`, edits across the new components.
- **Backend:** none.

### M6 — New backend routes + TanStack Query integration

- Add `src/routes/api/conductor/state.ts`, `missions.ts`, `missions.$id.ts`, `missions.$id.abort.ts`, `missions.create.ts` (or equivalent `createFileRoute` server handlers).
- Implement file-backed mission registry at `~/.hermes/conductor/missions/`.
- Add `src/screens/gateway/conductor/use-conductor-queries.ts` returning the four queries; replace mock-data imports.
- **Done when:** with backend running, KPIs and mission list reflect on-disk state, refetch every 2s while a live mission exists. Aborting via the UI flips lifecycle to `err`/`done`. Visual-verdict still ≥ "match".
- **Files:** four `src/routes/api/conductor/*.ts`, `use-conductor-queries.ts`, edits to components to consume queries.
- **Backend:** required.

### M7 — Mission detail drawer + new-mission submit wiring

- `MissionDetailDrawer` opens on card click, queries `/api/conductor/missions/:id`, renders transcript + phase log skeleton.
- `NewMissionDialog` submit → `POST /api/conductor/missions` → optimistic insert + drawer opens on new mission.
- **Done when:** end-to-end flow: type goal → submit → mission appears `live` in rail → KPIs update on next poll → drawer shows transcript shell. Visual-verdict ≥ "match" for default state.
- **Files:** `mission-detail-drawer.tsx`, `new-mission-dialog.tsx` (submit handler), small additions to `conductor-ui-store.ts`.
- **Backend:** required (M6).

---

## 6. Acceptance criteria + open questions

### Acceptance criteria

- `pnpm lint` clean, `pnpm test` green for any new test files.
- `tsc --noEmit` clean (TanStack Start uses Vite TS build, but TS errors surface in `pnpm build`).
- `pnpm build` succeeds without warnings introduced by this change.
- Visual-verdict verdict ≥ "match" against `conductor-fixed.png` at viewport `1440x900`, dark theme, `matrix` theme active.
- Non-matrix themes (`claude-nous`, `claude-official`, `claude-classic`, `claude-slate`, light variants) render the page without missing colours — every `--m-*` token paired with a `--theme-*` fallback (verify by switching theme via existing theme button and screenshotting all 5 bases × 2 modes).
- Manual smoke:
  1. Visit `/conductor`; verify top bar KPIs render.
  2. Click flow/org toggle; canvas swaps.
  3. Click each filter tab; list filters; counts match.
  4. Click a mission card; drawer opens with transcript skeleton.
  5. Click `+ NEW MISSION`; dialog opens; submit creates mission visible in rail within ≤2s.
  6. Abort a live mission; lifecycle flips; KPIs update.
  7. Switch theme to `claude-nous`; layout intact, colours sane.
  8. Resize to 1100px wide; right rail collapses to slide-over.
  9. No regressions on `/operations`, `/dashboard`, `/chat`, `/tasks`.
- No edits to the hard-no-touch file list.

### Open questions for the user (block ralph loop until answered before M6)

1. **Mission persistence layer.** OK to write mission metadata to `~/.hermes/conductor/missions/*.json` (new dir), or do you want it co-located under an existing hermes-agent store?
2. **Replay semantics.** Should clicking `replay` on a `done`/`err` mission card (a) re-run the orchestrator end-to-end, or (b) just open the read-only transcript in `MissionDetailDrawer`? Plan currently assumes (b).
3. **SSE vs poll.** 2s polling is proposed for M6. Do you want an SSE upgrade in this revamp, or defer until lanes get real-time tool-call streaming?
4. **`/api/send-stream` interplay.** Does a new conductor mission need to actually drive the gateway (send chat/stream), or is the conductor page initially read-only over already-running missions started from `/chat`? Plan assumes the conductor *page* does not start gateway calls in M6/M7 — it only records mission metadata; orchestration wiring is a follow-up.
5. **Worker lanes data source.** Lanes need worker activity over time. Are we OK aggregating from `gateway-capabilities` + `/api/sessions` polling for M6, or do we need a new worker-event stream (defer)?
6. **Matrix3D-style "park" exit.** If the rebuild stops after M4 (UI only, no backend), is that acceptable as a first shippable cut?

---

## File index (new)

```
src/screens/gateway/conductor.tsx                     (modified — re-export)
src/screens/gateway/conductor/conductor-layout.tsx
src/screens/gateway/conductor/conductor-top-bar.tsx
src/screens/gateway/conductor/conductor-main.tsx
src/screens/gateway/conductor/now-playing-strip.tsx
src/screens/gateway/conductor/phase-pills.tsx
src/screens/gateway/conductor/mission-canvas.tsx
src/screens/gateway/conductor/worker-lanes.tsx
src/screens/gateway/conductor/lane-row.tsx
src/screens/gateway/conductor/lane-legend.tsx
src/screens/gateway/conductor/mission-rail.tsx
src/screens/gateway/conductor/mission-filters.tsx
src/screens/gateway/conductor/mission-list.tsx
src/screens/gateway/conductor/mission-card.tsx
src/screens/gateway/conductor/new-mission-dialog.tsx
src/screens/gateway/conductor/mission-detail-drawer.tsx
src/screens/gateway/conductor/types.ts
src/screens/gateway/conductor/mock-data.ts            (M5)
src/screens/gateway/conductor/use-conductor-queries.ts (M6)
src/stores/conductor-ui-store.ts                       (M5)
src/styles/matrix-conductor.css
src/routes/api/conductor/state.ts                      (M6)
src/routes/api/conductor/missions.ts                   (M6)
src/routes/api/conductor/missions.$id.ts               (M6)
src/routes/api/conductor/missions.$id.abort.ts         (M6)
src/routes/api/conductor/missions.create.ts            (M6)
```
