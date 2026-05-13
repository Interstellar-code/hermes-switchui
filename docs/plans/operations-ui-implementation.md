# `/operations` Page UI — Implementation Plan

Reference design: `docs/Design Assets/Hermes-Switchui/Operations.html` (1360 lines)
Reference screenshot: `docs/Design Assets/Hermes-Switchui/screenshots/operations-fixed.png`
Current stub: `src/screens/agents/operations-screen.tsx` (8-line placeholder), mounted by `src/routes/operations.tsx` (named export `OperationsScreen`).
Sibling pattern just shipped: `src/screens/gateway/conductor/*` + `src/styles/matrix-conductor.css` (PR #20, branch `feat/conductor-ui-revamp`).

Scope summary: rebuild `/operations` as a **4-zone CSS-grid layout** (top bar / left team roster / centre focused-agent + dispatch composer / bottom team-outputs strip) matching `operations-fixed.png`. Static layout ships first; data + interactions wire later. **No legacy operations backend is resurrected** — the entire old operations API was nuked; a fresh, minimal `/api/operations/*` surface is introduced. The shared `/api/profiles/*` routes are **HARD-NO-TOUCH**. PrimaryNav remains the app shell; only the operations content region is touched.

> Note on screenshot vs HTML: the user-supplied bullet list describes 3 visible regions (team / dispatch / outputs). The reference HTML adds a centre `ops-focus` panel (focused-agent hero + activity + tools-used). Plan includes the centre panel as **M3 (optional)** and flags it as an open question in §6 — if the screenshot ground-truth omits it, M3 can be dropped without breaking later milestones.

---

## 1. Component decomposition

All new files under `src/screens/agents/operations/` (new folder). The screen's public entry stays `src/screens/agents/operations-screen.tsx`, exporting the named `OperationsScreen` so `src/routes/operations.tsx` is untouched.

| Path | Component | Responsibility | Parent |
|---|---|---|---|
| `src/screens/agents/operations-screen.tsx` | `OperationsScreen` | Top-level. Imports `matrix-operations.css`. Renders `<OperationsLayout>`. | route `/operations` |
| `src/screens/agents/operations/operations-layout.tsx` | `OperationsLayout` | CSS-grid shell: `grid-template-columns: 280px 1fr 340px; grid-template-rows: 56px 1fr 220px;` with `ops-top` spanning all cols and `ops-outputs` spanning all cols at bottom. | `OperationsScreen` |
| `src/screens/agents/operations/operations-top-bar.tsx` | `OperationsTopBar` | Breadcrumb (`Workspace › Operations · persistent agent team`), 4 KPI stats, sparkline SVG, pause + settings icon buttons. | `OperationsLayout` |
| `src/screens/agents/operations/team-roster.tsx` | `TeamRoster` | Left column shell: `RosterHeader` + `RosterFilters` + scrolling `RosterList`. | `OperationsLayout` |
| `src/screens/agents/operations/roster-header.tsx` | `RosterHeader` | "TEAM · 9" title + "+" add-agent icon button. | `TeamRoster` |
| `src/screens/agents/operations/roster-filters.tsx` | `RosterFilters` | 4 filter tabs `ALL 9 / LIVE 7 / IDLE 1 / ISSUES 1` with counts. | `TeamRoster` |
| `src/screens/agents/operations/roster-list.tsx` | `RosterList` | Filtered & sorted list of `AgentCard`s. | `TeamRoster` |
| `src/screens/agents/operations/agent-card.tsx` | `AgentCard` | Single row: 2-letter avatar with status pulse, name + role badge, inline task line, capacity bar, token + relative-time meta. Active state highlight. | `RosterList` |
| `src/screens/agents/operations/focus-panel.tsx` | `FocusPanel` *(M3, optional)* | Centre column hero + 2×2 sub-grid (`MissionPanel` / `ActivityPanel` / `ToolsUsedPanel` / `SessionOutputsPanel`). | `OperationsLayout` |
| `src/screens/agents/operations/focus-hero.tsx` | `FocusHero` *(M3)* | Big avatar, agent name + live pill, sub-line, quick actions (open chat / configure / pause). | `FocusPanel` |
| `src/screens/agents/operations/mission-panel.tsx` | `MissionPanel` *(M3)* | "Current mission" prompt + 5-stage strip (plan/route/execute/review/report) + elapsed timer. | `FocusPanel` |
| `src/screens/agents/operations/activity-panel.tsx` | `ActivityPanel` *(M3)* | Vertical timeline of recent events (handoff / tool / status). | `FocusPanel` |
| `src/screens/agents/operations/tools-used-panel.tsx` | `ToolsUsedPanel` *(M3)* | Grid of tool cells (icon + name + call count). | `FocusPanel` |
| `src/screens/agents/operations/dispatch-panel.tsx` | `DispatchPanel` | Right column shell: header + mode tabs + composer + routing preview + footer buttons. | `OperationsLayout` |
| `src/screens/agents/operations/dispatch-mode-tabs.tsx` | `DispatchModeTabs` | 3 tabs `AUTO / BROADCAST / MANUAL`. | `DispatchPanel` |
| `src/screens/agents/operations/dispatch-composer.tsx` | `DispatchComposer` | Textarea + meta-pill row (priority / budget / deadline / +tags). | `DispatchPanel` |
| `src/screens/agents/operations/routing-preview.tsx` | `RoutingPreview` | Ordered numbered steps with worker name, sub-label, confidence %, arrow connectors, est cost + time footer. | `DispatchPanel` |
| `src/screens/agents/operations/team-outputs-strip.tsx` | `TeamOutputsStrip` | Bottom strip shell: header (title + count + filter tabs + auto-refresh toggle) + horizontal scrolling rail of `OutputCard`s. | `OperationsLayout` |
| `src/screens/agents/operations/output-card.tsx` | `OutputCard` | Single artifact: source agent + type badge, filename, content preview, timestamp + size. | `TeamOutputsStrip` |
| `src/screens/agents/operations/new-agent-dialog.tsx` | `NewAgentDialog` | Portal modal for "+" add-agent: name, role (orchestrator/worker), model, profile. | `RosterHeader` |
| `src/screens/agents/operations/dispatch-confirm-dialog.tsx` | `DispatchConfirmDialog` *(optional, M6)* | Portal modal: shown only when `priority=high` or `budget>50k`; otherwise dispatch is inline. | `DispatchPanel` |

### TypeScript signatures

```ts
// shared types — src/screens/agents/operations/types.ts
export type AgentRole = 'orchestrator' | 'worker' | 'draft'
export type AgentStatus = 'live' | 'idle' | 'blocked' | 'error'
export type DispatchMode = 'auto' | 'broadcast' | 'manual'
export type OutputType = 'md' | 'code' | 'json' | 'csv' | 'png' | 'draft' | 'idx'
export type OutputCategory = 'all' | 'code' | 'docs' | 'data' | 'media'
export type Priority = 'low' | 'normal' | 'high'

export interface OperationsKpis {
  liveCount: number          // 7
  totalCount: number         // 9
  tokensPerMinute: number    // 14_200
  queueDepth: number         // 3
  errors24h: number          // 2
  sparkSeries: number[]      // last 12 buckets, normalised 0..1
}

export interface AgentSummary {
  id: string
  name: string                   // "sage"
  initials: string               // "SG"
  role: AgentRole
  status: AgentStatus
  task: string                   // inline activity line
  capacityPct: number            // 0..100
  tokensThisMission?: number
  lastActiveLabel: string        // "now" | "4s" | "2m" | "—"
  capacityWarn?: boolean
  capacityErr?: boolean
}

export interface RoutingStep {
  ordinal: number
  agentName: string
  detail: string                 // "plan + decompose"
  confidencePct: number          // 0..100
}

export interface DispatchDraft {
  prompt: string
  mode: DispatchMode
  priority: Priority
  budgetTokens: number           // default 25_000
  deadlineMinutes: number        // default 30
  tags: string[]
}

export interface RoutingPreviewModel {
  steps: RoutingStep[]
  estCostTokens: number
  estDurationSeconds: number
}

export interface MissionSnapshot {
  id: string                     // "t_49b85d13"
  prompt: string
  startedAt: number
  stages: Array<'plan'|'route'|'execute'|'review'|'report'>
  currentStageIdx: number
  subStageLabel?: string         // "3/5"
}

export interface ActivityEntry {
  id: string
  ts: number
  kind: 'handoff' | 'tool' | 'note' | 'milestone'
  label: string                  // markdown-ish inline
  status?: 'done' | 'live'
}

export interface ToolUsage {
  iconKey: 'git' | 'fs' | 'w' | 'x' | 'db'
  name: string
  count: number
}

export interface ArtifactOutput {
  id: string
  agentName: string
  type: OutputType
  filename: string
  preview: string
  createdAt: number
  size: string                   // "4.2 kb" / "178 ch"
  category: OutputCategory
}

// Component props (key ones)
export interface OperationsTopBarProps { kpis: OperationsKpis; onPauseTeam: () => void; onOpenSettings: () => void }
export interface TeamRosterProps {
  agents: AgentSummary[]
  filter: 'all' | 'live' | 'idle' | 'issues'
  focusedAgentId: string | null
  onChangeFilter: (f: TeamRosterProps['filter']) => void
  onSelectAgent: (id: string) => void
  onAddAgent: () => void
}
export interface AgentCardProps { agent: AgentSummary; isFocused: boolean; onSelect: () => void }
export interface FocusPanelProps { agent: AgentSummary | null; mission: MissionSnapshot | null; activity: ActivityEntry[]; tools: ToolUsage[]; sessionOutputs: ArtifactOutput[] }
export interface DispatchPanelProps {
  draft: DispatchDraft
  preview: RoutingPreviewModel | null
  status: 'ready' | 'planning' | 'busy'
  onChangeDraft: (patch: Partial<DispatchDraft>) => void
  onSaveDraft: () => void
  onDispatch: () => void
}
export interface RoutingPreviewProps { preview: RoutingPreviewModel | null }
export interface TeamOutputsStripProps {
  outputs: ArtifactOutput[]
  category: OutputCategory
  autoRefresh: boolean
  onChangeCategory: (c: OutputCategory) => void
  onToggleAutoRefresh: () => void
  onRefreshNow: () => void
}
export interface OutputCardProps { output: ArtifactOutput; onOpen: () => void }
export interface NewAgentDialogProps { open: boolean; onClose: () => void; onSubmit: (input: { name: string; role: AgentRole; model: string; profileId: string }) => void }
```

---

## 2. Data flow + state shape

### Zustand — new UI store, no domain model

`src/stores/operations-ui-store.ts` — UI-only. No agent/mission domain data lives here; that comes from TanStack Query against `/api/operations/*`.

```ts
type OperationsUiStore = {
  // roster
  rosterFilter: 'all' | 'live' | 'idle' | 'issues'
  focusedAgentId: string | null
  // dispatch composer (draft state, persisted)
  draft: DispatchDraft
  // outputs strip
  outputsCategory: OutputCategory
  outputsAutoRefresh: boolean
  // dialogs
  newAgentDialogOpen: boolean
  dispatchConfirmOpen: boolean

  setRosterFilter(f): void
  setFocusedAgentId(id: string | null): void
  patchDraft(p: Partial<DispatchDraft>): void
  resetDraft(): void
  setOutputsCategory(c): void
  toggleOutputsAutoRefresh(): void
  openNewAgent(): void; closeNewAgent(): void
  openDispatchConfirm(): void; closeDispatchConfirm(): void
}
```

Persisted via `zustand/middleware` `persist` under key `clawsuite:operations-ui` with allowlist `['rosterFilter', 'outputsCategory', 'outputsAutoRefresh', 'draft']`. `focusedAgentId` is **not** persisted (defaults to first live agent on mount).

### TanStack Query

| Query key | Source | Refetch |
|---|---|---|
| `['operations','team']` | `GET /api/operations/team` → `{ kpis, agents }` | `refetchInterval: 2000` while any agent is `live`; else `15000` |
| `['operations','agent', id]` | `GET /api/operations/agents/:id` → `{ agent, mission, activity, tools, sessionOutputs }` | `2000` on focused agent only; disabled when `focusedAgentId` is null |
| `['operations','outputs']` | `GET /api/operations/outputs?range=today` → `{ outputs }` | `5000` when `outputsAutoRefresh` is on; else manual |
| `['operations','routing-preview']` | `POST /api/operations/dispatch/preview` (mutation w/ debounced auto-trigger on draft.prompt changes ≥ 600ms idle) | mutation only |

Mutations:
- `POST /api/operations/dispatch` → on success: invalidate `['operations','team']` + `['operations','outputs']` + reset `draft.prompt`.
- `POST /api/operations/agents` (create) / `POST /api/operations/agents/:id/abort` (stop in-flight task).

### Live updates

Polling first (2s for focused-agent panel, 5s for outputs, 2–15s for team list adaptive). **SSE is out of scope** for M1–M6; flagged as an open question for follow-up.

### localStorage keys

- `clawsuite:operations-ui` — Zustand persist (UI prefs + draft).
- No other writes; profiles state stays owned by the shared profiles store / hard-no-touch profile API.

### Client/server contract

- Client never mutates profile/model state through `/api/operations/*`. The dispatch endpoint reads profile info **only by reference** (profile id, model name) — it never updates a profile.
- The "+" add-agent dialog selects an existing profile via the existing `/api/profiles` GET endpoint (read-only call, no mutation, no edits to that file).
- Focused-agent id is purely client-side.
- Outputs are read-only artifact metadata; the page itself does not write artifacts.

---

## 3. Backend API routes

**Decision: (B) Minimal new operations-specific routes with seeded fixtures.** Rationale:
- The legacy operations backend was deleted on purpose. A *full* (A) surface — task scheduler, dispatch orchestrator, artifact registry, live event bus — duplicates work the conductor revamp will eventually need and is too large for the UI-first phase.
- A *minimal* surface (4 GET aggregators + 1 dispatch POST + 1 agent create/abort) lets the UI ship end-to-end without depending on hermes-agent gateway behaviour we don't yet expose.
- All "live" data in M1–M5 comes from a small in-memory seed (loaded from `~/.hermes/operations/state.json` if present, else fixture). Real wiring to gateway/agent runtime is a follow-up phase.
- This mirrors the (A) decision in the conductor plan but down-shifts because operations has a wider surface and we want to avoid blocking on backend.

### Routes (all under `src/routes/api/operations/`)

```
GET  /api/operations/team                  → { kpis, agents }
GET  /api/operations/agents/:id            → { agent, mission, activity, tools, sessionOutputs }
GET  /api/operations/outputs?range=today   → { outputs }
POST /api/operations/dispatch/preview      → body { prompt, mode, priority, budgetTokens } → { preview: RoutingPreviewModel }
POST /api/operations/dispatch              → body { prompt, mode, priority, budgetTokens, deadlineMinutes, tags } → { missionId, accepted: true }
POST /api/operations/agents                → body { name, role, model, profileId } → { id }
POST /api/operations/agents/:id/abort      → { ok: true }
```

All routes:
- Require existing `auth-middleware` session token (**not modified**).
- Apply existing `rate-limit` per IP (**not modified**).
- POST routes require `Content-Type: application/json` (existing CSRF gate).
- Persist agent registry + dispatched-mission metadata to `~/.hermes/operations/` (new directory, JSON files; no schema migration of any other file).
- **Never** call into `/api/profiles/*`; if a profile id is referenced, the route reads it through the existing read-only profile loader (e.g. `loadProfiles()` from `src/server/profile-store.ts` if exported, else import the JSON directly — confirm in M5).

### Payload shapes

```ts
// GET /api/operations/team
{ kpis: OperationsKpis, agents: AgentSummary[] }

// GET /api/operations/agents/:id
{
  agent: AgentSummary,
  mission: MissionSnapshot | null,
  activity: ActivityEntry[],            // last 20
  tools: ToolUsage[],
  sessionOutputs: ArtifactOutput[]      // 0–8
}

// GET /api/operations/outputs?range=today
{ outputs: ArtifactOutput[] }

// POST /api/operations/dispatch/preview body
{ prompt: string, mode: DispatchMode, priority: Priority, budgetTokens: number }
// → 200 { preview: RoutingPreviewModel }

// POST /api/operations/dispatch body
DispatchDraft & { /* same shape */ }
// → 200 { missionId: string, accepted: true }

// POST /api/operations/agents body
{ name: string, role: AgentRole, model: string, profileId: string }
// → 200 { id: string }
```

### Hard-no-touch list (repeated verbatim for executor)

`src/routes/api/profiles/*` (shared with /profiles, /tasks, /jobs, chat-composer), `src/server/gateway-api.ts`, `src/server/gateway-capabilities.ts`, `src/server/hermes-api.ts`, `src/server/auth-middleware.ts`, `src/server/rate-limit.ts`, all chat infra (`src/routes/api/chat-events.ts`, `src/routes/api/send.ts`, `src/routes/api/sessions/*`, `chat-store.ts`, `chat-backends.ts`), the conductor revamp files just shipped (`src/screens/gateway/conductor/*`, `src/styles/matrix-conductor.css`, `src/routes/api/conductor/*`, `src/stores/conductor-ui-store.ts`).

---

## 4. Styling approach

### File structure

- `src/styles/matrix-operations.css` — new, owns every selector prefixed `.ops-*`, `.agent-*`, `.disp-*`, `.out-*`, `.route-*`, `.focus-*` ported from `Operations.html`.
- Imported once at the top of `src/screens/agents/operations-screen.tsx`.
- No global selectors, no edits to existing `matrix-*.css`. CSS custom properties only — never hex values inline. Mirrors exactly the conformance level of `matrix-conductor.css` (commits `ff8dfe6b`, `4340daa9`, `f3150f28`).

### Token usage map (matches design `Operations.html`)

| Surface | Primary token | Fallback |
|---|---|---|
| Page background | `var(--m-bg)` | `var(--theme-bg)` |
| Top bar background | `var(--m-sidebar)` | `var(--theme-panel)` |
| Panel surfaces (roster, focus panels, dispatch, outputs) | `var(--m-panel)` | `var(--theme-surface)` |
| Borders (strong) | `var(--m-border)` | `var(--theme-border)` |
| Borders (subtle) | `var(--m-border-subtle)` | rgba fallback |
| Accent / live / `ok` KPI | `var(--m-green-500)` | `var(--theme-accent)` |
| Warn (`warn` KPI, blocked agent) | `var(--m-warning)` | `var(--theme-warning)` |
| Error (nova retry, err meta) | `var(--m-danger)` | `var(--theme-danger)` |
| Info blue (tool tag) | `var(--m-info)` | `var(--theme-info)` |
| Pink (handoff tag) | `var(--m-pink)` | `var(--theme-pink, var(--theme-accent))` |
| Capacity bar fill (normal/warn/err) | `var(--m-green-500)` / `var(--m-warning)` / `var(--m-danger)` | matching `--theme-*` |
| Text strong | `var(--m-text-strong)` | `var(--theme-fg)` |
| Text muted | `var(--m-text-muted)` | `var(--theme-fg-muted)` |
| Text faint | `var(--m-text-faint)` | `var(--theme-fg-faint, var(--theme-fg-muted))` |
| Mono font stack | `var(--m-font-mono)` | `var(--theme-font-mono)` |
| Fill (hover, active tab) | `var(--m-fill-subtle)` | `rgba(255,255,255,0.04)` |
| Glow effects | `var(--m-glow-sm)` / `var(--m-glow-md)` | none (silent degrade) |
| Pulse `live` dot | `var(--m-green-500)` + `--m-glow-sm` | `var(--theme-accent)` |
| Pulse `blocked` dot | `var(--m-warning)` | `var(--theme-warning)` |
| Pulse `error` dot | `var(--m-danger)` | `var(--theme-danger)` |
| Pulse `idle` dot | `var(--m-text-faint)` | `var(--theme-fg-faint)` |

Every `--m-*` paired with a `var(--theme-*, …)` fallback so non-matrix themes render.

### Animation choices

- `@keyframes pulse-live` on `.av .pulse.live` — 1.6s ease-in-out infinite (opacity 0.5→1, glow oscillation).
- `@keyframes pulse-blocked` on `.av .pulse.blocked` — slower 2.2s, no glow.
- `@keyframes pulse-error` on `.av .pulse.error` — fast 0.9s, red flash.
- `@keyframes spark-draw` on top-bar sparkline `<path>` (optional, M2) — 600ms once on mount via `stroke-dashoffset`.
- Capacity-bar fill: `transition: width 240ms ease-out;` on `.cap > span`.
- Dispatch button: `transition: background 160ms ease, box-shadow 160ms ease;` plus `box-shadow: 0 0 0 1px var(--m-green-500), var(--m-glow-md)` on hover.
- Routing-preview arrow: static (no animation in M1–M6).
- Output card hover: `transform: translateY(-1px); box-shadow: var(--m-glow-sm);` 160ms.
- No JS-driven typing/stream effect in M1–M5.

### Layout target

- Design target: `min-width: 1360px`. Below `1200px` collapse `DispatchPanel` into a slide-over (icon button in top bar opens it). Below `1024px` show "Operations is optimised for wider screens" stub (same pattern shipped on conductor).
- Use `clamp()` for FocusHero avatar size if M3 ships: `clamp(40px, 4vw, 56px)`.

### Conformance to `matrix-conductor.css`

- Same selector-prefix discipline (`.cnd-*` → `.ops-*`).
- Same token fallback policy.
- Same animation duration vars (`--m-dur-fast`, `--m-dur-med`).
- Same panel chrome: `1px solid var(--m-border)`, `border-radius: var(--m-radius-md)`, `background: var(--m-panel)`.

---

## 5. Iteration milestones for ralph-loop + visual-verdict

Each milestone = one ralph iteration: edit (sonnet subagent) → `pnpm dev` background → headless screenshot of `http://localhost:3000/operations` at `1440×900`, dark + `matrix` theme → run OMC `visual-verdict` against `docs/Design Assets/Hermes-Switchui/screenshots/operations-fixed.png` → iterate until verdict ≥ "match" for that milestone's scoped region.

### M1 — Static grid shell + top bar (no data, no backend)

- Create folder `src/screens/agents/operations/`, all components as static JSX with hard-coded values from the HTML (`7/9 LIVE · 14.2k TOK/MIN · 3 QUEUE · 2 ERRORS · 24H` plus sparkline path).
- Create `src/styles/matrix-operations.css` with the full token-mapped stylesheet (top bar + grid skeleton + placeholders for left/centre/right/bottom zones).
- Replace stub `OperationsScreen` to render `<OperationsLayout>`.
- **Done when:** screenshot shows the 4-zone grid skeleton, the top breadcrumb, four KPI stats with correct colours (green ok, yellow warn), the inline sparkline, and pause+settings icon buttons. Top 56px strip < 5% pixel delta vs `operations-fixed.png`.
- **Files:** `operations-screen.tsx`, `operations/operations-layout.tsx`, `operations/operations-top-bar.tsx`, `src/styles/matrix-operations.css`.
- **Backend:** none.

### M2 — Team roster (left column), static cards

- Implement `TeamRoster` + `RosterHeader` + `RosterFilters` + `RosterList` + `AgentCard` with the 9 hard-coded agents from `Operations.html` lines 902–1000 (sage, neo, workspace, pixel, echo, drift, blaze, nova, water).
- Render avatar initials, status pulse variants (live / blocked / error / idle), role badge, task line, capacity bar (incl. `warn` and `err` modifiers), token + relative time meta.
- Filter tabs visible but not yet wired (M5).
- **Done when:** left column matches screenshot end-to-end — pulses animate, capacity bars render correct widths (64% sage, 82% neo, 38% workspace, 50% pixel, 24% echo, 100% drift warn, 70% blaze, 12% nova err, 0% water idle), `agent.active` highlight on sage. Visual-verdict ≥ "close" on left column.
- **Files:** `team-roster.tsx`, `roster-header.tsx`, `roster-filters.tsx`, `roster-list.tsx`, `agent-card.tsx`, additions to `matrix-operations.css`.
- **Backend:** none.

### M3 — Centre focus panel (optional, gated on screenshot ground-truth)

- **Gate:** before starting, re-inspect `operations-fixed.png`. If centre column shows the focused-agent hero + 2×2 sub-grid (mission / activity / tools / outputs) as in `Operations.html` lines 1004–1130, proceed. If the screenshot shows a simpler centre (or omits it), skip M3 and let `DispatchPanel` widen — defer this decision to user (see open question Q1).
- If proceeding: implement `FocusPanel`, `FocusHero`, `MissionPanel`, `ActivityPanel`, `ToolsUsedPanel`, `SessionOutputsPanel`, all with hard-coded sage data from the HTML.
- **Done when:** centre column visual-verdict ≥ "close" against the centre region of the screenshot. Phase strip shows `plan done · route done · execute now (3/5) · review · report`, elapsed `04:18`, timeline contains 6 entries, tool grid has 6 cells, outputs list has 4 rows.
- **Files:** `focus-panel.tsx`, `focus-hero.tsx`, `mission-panel.tsx`, `activity-panel.tsx`, `tools-used-panel.tsx` (+ matrix-operations.css additions).
- **Backend:** none.

### M4 — Dispatch panel (right column), static

- Implement `DispatchPanel` + `DispatchModeTabs` + `DispatchComposer` + `RoutingPreview`.
- Static content: mode tabs `AUTO active · BROADCAST · MANUAL`; textarea with placeholder from HTML; 4 meta pills (`PRIORITY · NORMAL` active, `BUDGET · 25k TOK`, `DEADLINE · 30m`, `+ TAGS`); routing preview with hard-coded 4 steps (sage 98% → blaze 94% → echo 71% med → sage 96%) + arrow connectors + est cost `~8.4k tok` / est time `~3:40`; footer `SAVE DRAFT` + `DISPATCH →` buttons.
- **Done when:** right column visual-verdict ≥ "close". `READY` live pill animates. Pills + tabs match screenshot.
- **Files:** `dispatch-panel.tsx`, `dispatch-mode-tabs.tsx`, `dispatch-composer.tsx`, `routing-preview.tsx`.
- **Backend:** none.

### M5 — Team outputs strip (bottom) + roster filters wired + Zustand UI store

- Implement `TeamOutputsStrip` + `OutputCard` with the 8 hard-coded artifacts from the HTML (PROJECT.md, ARCHITECTURE.md, launch-tweet.draft, benchloop-summary.json, market-signals-1106.csv, standup-1106.md, conductor-frame-008.png, .hermes-index.bin). Horizontal scroll rail.
- Wire `src/stores/operations-ui-store.ts`. Bind: roster filter tabs (filters list client-side), focused-agent card highlight, dispatch composer textarea + meta pills, mode tabs, outputs category tabs, auto-refresh toggle, new-agent dialog open/close.
- Move all hard-coded data into `src/screens/agents/operations/mock-data.ts`.
- **Done when:** full viewport visual-verdict ≥ "match" against `operations-fixed.png`. Clicking filter tabs visibly filters roster; clicking an agent toggles focused highlight; clicking output category tabs filters the rail; auto-refresh toggle flips visibly. No regressions on other routes.
- **Files:** `team-outputs-strip.tsx`, `output-card.tsx`, `src/stores/operations-ui-store.ts`, `operations/mock-data.ts`, edits across M1–M4 components to consume store.
- **Backend:** none.

### M6 — Backend routes + TanStack Query integration

- Add `src/routes/api/operations/team.ts`, `agents.$id.ts`, `outputs.ts`, `dispatch.preview.ts`, `dispatch.ts`, `agents.create.ts`, `agents.$id.abort.ts` (or equivalent `createFileRoute` server handlers).
- Implement file-backed registry at `~/.hermes/operations/{agents.json,missions/*.json,outputs.json}`. Seed from existing mock-data.ts on first read.
- Add `src/screens/agents/operations/use-operations-queries.ts` returning the 4 queries + mutations; replace mock-data imports.
- **Done when:** with backend running, KPIs + roster + outputs reflect on-disk state; refetch every 2s while live agents exist; focused-agent panel polls only its own endpoint; outputs auto-refresh respects the toggle. Visual-verdict still ≥ "match".
- **Files:** seven `src/routes/api/operations/*.ts`, `use-operations-queries.ts`, edits to components to consume queries.
- **Backend:** required.

### M7 — Dispatch + new-agent submit wiring, routing-preview debounce

- `NewAgentDialog` submit → `POST /api/operations/agents` → optimistic insert + roster highlights new agent.
- `DispatchComposer` textarea: debounced (600ms idle) auto-trigger of `POST /api/operations/dispatch/preview`; updates `RoutingPreview` in place.
- `DISPATCH →` button → `POST /api/operations/dispatch` → invalidates team + outputs queries; if priority=high or budget>50k, gate behind `DispatchConfirmDialog` first.
- **Done when:** end-to-end flow: type prompt → preview updates within 1s of idle → submit → mission accepted → new artifacts appear in outputs strip within ≤5s (auto-refresh on). Aborting an agent via card menu flips its status. Visual-verdict ≥ "match" for default + dispatching states.
- **Files:** `new-agent-dialog.tsx` (submit), `dispatch-confirm-dialog.tsx` (optional), `dispatch-panel.tsx` (submit handler), small additions to `operations-ui-store.ts`, `use-operations-queries.ts`.
- **Backend:** required (M6).

---

## 6. Acceptance criteria + open questions

### Acceptance criteria

- `pnpm lint` clean; `pnpm test` green for any new test files.
- `tsc --noEmit` clean (surfaces via `pnpm build`).
- `pnpm build` succeeds without new warnings.
- Visual-verdict ≥ "match" against `operations-fixed.png` at viewport `1440×900`, dark theme, `matrix` theme active.
- Non-matrix themes (`claude-nous`, `claude-official`, `claude-classic`, `claude-slate`, dark + light) render `/operations` without missing colours — verified by switching theme and screenshotting all 5 bases × 2 modes.
- Manual smoke:
  1. Visit `/operations`; verify top bar KPIs render with correct colour states.
  2. Click each roster filter tab; list filters; counts match.
  3. Click an agent card; highlight moves; (M3 if shipped) centre panel re-renders.
  4. Click dispatch mode tabs; active state moves.
  5. Type a prompt; routing preview refreshes after ~600ms idle.
  6. Click `DISPATCH →`; mission accepted; new output appears in strip within ≤5s.
  7. Open "+" add-agent dialog; create a draft worker; appears in roster.
  8. Toggle auto-refresh off; output strip stops polling; click manual refresh icon — refreshes once.
  9. Switch theme to `claude-nous`; layout intact, colours sane, pulses still animate.
  10. Resize to 1100px wide; right dispatch panel collapses to slide-over.
  11. No regressions on `/profiles`, `/tasks`, `/jobs` (which share `/api/profiles/*`).
  12. No regressions on `/conductor` (sibling revamp must stay pixel-stable).
- Hard-no-touch list unmodified (verify with `git diff --name-only main` excluding listed paths).

### Open questions for the user (block ralph loop until answered before M3 and M6)

1. **Centre `ops-focus` panel — keep or drop?** Reference HTML has a rich focused-agent hero + 2×2 panel. User's bullet-list description omits it. Confirm whether M3 ships or is dropped (and the right `DispatchPanel` widens to fill the space).
2. **Agent registry persistence.** OK to write agent + mission metadata to `~/.hermes/operations/*.json` (new dir), or co-locate under existing hermes-agent store?
3. **Profile-API interaction.** `NewAgentDialog` needs a profile picker. Confirm we may *read* `/api/profiles` (GET only, no edits to the route file). If not, fall back to a free-text profile-id input.
4. **Dispatch orchestration.** Does the dispatch POST actually drive the gateway (start a real chat/stream), or is M6/M7 a metadata-only record (orchestration wiring deferred)? Plan currently assumes metadata-only; a real "send to hermes-agent" call is a follow-up phase.
5. **SSE vs poll.** 2s/5s polling proposed for M6. Want an SSE upgrade in this revamp, or defer until conductor's lane streaming lands?
6. **Outputs source of truth.** Are artifacts (a) scanned from a filesystem path, (b) recorded by the dispatch endpoint as agents emit them, or (c) seeded fixtures only for now? Plan assumes (c) for M6 with a hook for (b) in a follow-up.
7. **"Park after M5" option.** If we stop after M5 (full static UI + UI-store interactions, no backend), is that an acceptable first shippable cut for `/operations` (analogous to the Matrix3D park)?
8. **Pause-team / abort-agent semantics.** Real pause/abort, or visual-only stub until orchestration wiring lands?

---

## File index (new)

```
src/screens/agents/operations-screen.tsx                          (modified — body replaced, named export preserved)
src/screens/agents/operations/operations-layout.tsx
src/screens/agents/operations/operations-top-bar.tsx
src/screens/agents/operations/team-roster.tsx
src/screens/agents/operations/roster-header.tsx
src/screens/agents/operations/roster-filters.tsx
src/screens/agents/operations/roster-list.tsx
src/screens/agents/operations/agent-card.tsx
src/screens/agents/operations/focus-panel.tsx                     (M3, optional)
src/screens/agents/operations/focus-hero.tsx                      (M3)
src/screens/agents/operations/mission-panel.tsx                   (M3)
src/screens/agents/operations/activity-panel.tsx                  (M3)
src/screens/agents/operations/tools-used-panel.tsx                (M3)
src/screens/agents/operations/dispatch-panel.tsx
src/screens/agents/operations/dispatch-mode-tabs.tsx
src/screens/agents/operations/dispatch-composer.tsx
src/screens/agents/operations/routing-preview.tsx
src/screens/agents/operations/team-outputs-strip.tsx
src/screens/agents/operations/output-card.tsx
src/screens/agents/operations/new-agent-dialog.tsx
src/screens/agents/operations/dispatch-confirm-dialog.tsx         (M7, optional)
src/screens/agents/operations/types.ts
src/screens/agents/operations/mock-data.ts                        (M5)
src/screens/agents/operations/use-operations-queries.ts           (M6)
src/stores/operations-ui-store.ts                                  (M5)
src/styles/matrix-operations.css
src/routes/api/operations/team.ts                                  (M6)
src/routes/api/operations/agents.$id.ts                            (M6)
src/routes/api/operations/agents.create.ts                         (M6)
src/routes/api/operations/agents.$id.abort.ts                      (M6)
src/routes/api/operations/outputs.ts                               (M6)
src/routes/api/operations/dispatch.preview.ts                      (M6)
src/routes/api/operations/dispatch.ts                              (M6)
```
