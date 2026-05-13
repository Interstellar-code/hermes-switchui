# Conductor Page Cleanout Plan

**Date:** 2026-05-09
**Author:** planner/sonnet
**Pre-revamp scope:** Identify dead and redundant code before /conductor UI revamp. Do NOT plan the new design here.

---

## 1. File Inventory (conductor-only)

| Path | LOC | Last Modified | Purpose | Classification |
|------|-----|---------------|---------|----------------|
| `src/routes/conductor.tsx` | 10 | 2026-05-03 | Route shell — renders `<Conductor />` | KEEP (route must exist) |
| `src/screens/gateway/conductor.tsx` | 2404 | 2026-05-03 | Monolithic page component, all phases: home/preview/active/complete | DELETE (full replacement) |
| `src/screens/gateway/hooks/use-conductor-gateway.ts` | 1706 | 2026-04-30 | All conductor state: missions, workers, polling, portable/dashboard modes, SSE streaming | DELETE (full replacement) |
| `src/routes/api/conductor-spawn.ts` | 303 | 2026-05-05 | POST spawns mission; GET polls mission status from dashboard; builds orchestrator prompt | EVALUATE (keep POST logic, may slim) |
| `src/routes/api/conductor-stop.ts` | 75 | 2026-05-09 | POST deletes sessions + stops dashboard missions | KEEP (clean, generic) |
| `src/server/conductor-mission-sanitize.ts` | 76 | 2026-05-08 | Strips Cloudflare 5xx HTML and self-workspace URLs from goal input | KEEP (tested utility) |
| `src/server/conductor-mission-sanitize.test.ts` | — | — | Unit tests for above | KEEP |

**Conductor-only totals:** ~4,498 LOC across 5 non-trivial files.

---

## 2. File Inventory (shared with other screens)

These are imported by conductor but also used elsewhere. They must NOT be deleted; only decoupled from conductor-specific assumptions.

| Path | LOC | Last Modified | Purpose | Other Callers | Classification |
|------|-----|---------------|---------|---------------|----------------|
| `src/screens/gateway/components/office-view.tsx` | 908 | — | Visual grid of agent cards (`AgentWorkingRow`) | `overview-tab`, `agent-hub-layout` | KEEP / shared |
| `src/screens/gateway/components/agents-working-panel.tsx` | 474 | — | Panel listing working agents | `office-view`, `live-activity-panel`, `overview-tab`, `agent-hub-layout` | KEEP / shared |
| `src/components/workflow-help-modal.tsx` | 84 | — | Help modal for workflow dispatch | `src/screens/agents/agents-screen.tsx` | KEEP / shared |
| `src/screens/gateway/components/live-activity-panel.tsx` | 497 | — | Live agent activity feed | `agent-hub-layout` | DELETE / Codex audit 2026-05-13 confirmed zero non-conductor consumers |
| `src/screens/gateway/components/overview-tab.tsx` | 319 | — | Overview tab for agent-hub (has `// TODO(orphan)` comment) | `agent-hub-layout` | DELETE / Codex audit 2026-05-13 confirmed zero non-conductor consumers |
| `src/screens/gateway/agent-hub-layout.tsx` | 132 | — | Layout shell for agent hub | `agents-screen`, `overview-tab`, `hub-utils`, `hub-constants` | KEEP / shared |
| `src/lib/gateway-api.ts` | 512 | — | REST client for Hermes gateway | Many pages | KEEP / core |
| `src/server/gateway-capabilities.ts` | 942 | — | Gateway feature probing, `dashboardFetch` | Many API routes | KEEP / core |
| `src/server/hermes-api.ts` | 840 | — | Gateway session management | Many API routes | KEEP / core |
| `src/server/auth-middleware.ts` | 308 | — | Session auth | All API routes | KEEP / core |
| `src/server/rate-limit.ts` | 110 | — | CSRF + rate limit | All API routes | KEEP / core |
| `src/screens/gateway/components/streaming-text.tsx` | 152 | 2026-04-19 | Text streaming animator | `chat-screen`, `agent-output-panel` | KEEP / shared |

---

## 3. Backend Routes Used by Conductor

| File | Method | URL Path | What It Does | Shared? | Safe to Delete? |
|------|--------|----------|-------------|---------|----------------|
| `src/routes/api/conductor-spawn.ts` | POST | `/api/conductor-spawn` | Spawns mission (dashboard or portable mode), builds orchestrator prompt | conductor-only callers | EVALUATE — keep POST; GET polling may merge into spawn route |
| `src/routes/api/conductor-spawn.ts` | GET | `/api/conductor-spawn` | Polls mission status from dashboard backend | conductor-only | EVALUATE |
| `src/routes/api/conductor-stop.ts` | POST | `/api/conductor-stop` | Kills sessions and dashboard missions | conductor-only | KEEP |
| `src/routes/api/send-stream.ts` | POST | `/api/send-stream` | SSE streaming for portable conductor orchestrator | SHARED (chat, memory, onboarding) | KEEP |
| `src/routes/api/history.ts` | GET | `/api/history` | Fetches session message history | SHARED (other screens) | KEEP |
| `src/routes/api/models.ts` | GET | `/api/models` | Returns available models for model selector | SHARED | KEEP |
| `src/routes/api/files.ts` | GET | `/api/files` | Directory browser in settings modal | SHARED | KEEP |
| `src/routes/api/preview-file.ts` | GET | `/api/preview-file` | Serves output HTML preview (iframe) | conductor-only usage | EVALUATE |
| `src/lib/gateway-api.ts:pauseAgent` | POST | `/api/agent-pause` | Pause/resume agent session | SHARED (`gateway-api.ts`) | KEEP |

---

## 4. Server-Side Modules Used by Conductor

| Module | Path | Conductor-unique? | Safe to Delete? |
|--------|------|--------------------|----------------|
| `conductor-mission-sanitize` | `src/server/conductor-mission-sanitize.ts` | Yes — only called from `conductor-spawn.ts` | KEEP (tested, small, needed if spawn route kept) |
| `gateway-capabilities` (`dashboardFetch`, `ensureGatewayProbed`) | `src/server/gateway-capabilities.ts` | No — used by many API routes | KEEP |
| `hermes-api` (`deleteSession`) | `src/server/hermes-api.ts` | No | KEEP |
| `auth-middleware` | `src/server/auth-middleware.ts` | No | KEEP |
| `rate-limit` (`requireJsonContentType`) | `src/server/rate-limit.ts` | No | KEEP |

---

## 5. Active Features (wired to real backend)

- **Mission goal input + submit** — posts to `/api/conductor-spawn` (POST), spawns orchestrator session; backend-wired.
- **Portable mode streaming** — falls back to `/api/send-stream` SSE when `capabilities.conductor` is false; wired.
- **Dashboard mode polling** — GET `/api/conductor-spawn?missionId=...` at 2.5–3 s intervals while running; wired to hermes dashboard API.
- **Worker session tracking** — polls `/api/sessions` for worker sessions labeled `worker-*`; wired.
- **Session history view** — GET `/api/history?sessionKey=...` per worker; wired.
- **Mission pause/resume** — POST `/api/agent-pause`; wired via `gateway-api.ts`.
- **Mission stop** — POST `/api/conductor-stop`; wired.
- **Model selector** — GET `/api/models`; wired.
- **Directory browser** — GET `/api/files`; wired.
- **Output preview iframe** — GET `/api/preview-file`; wired when path extracted from worker output.
- **Mission history** (localStorage) — persisted via `ACTIVE_MISSION_STORAGE_KEY`; client-side only, functional.
- **Goal draft persistence** (localStorage via `CONDUCTOR_GOAL_DRAFT_STORAGE_KEY`) — functional.

---

## 6. Demo / Dead / TODO Features

- **Quick action buttons** (`research`, `build`, `review`, `deploy`) — L82-97 in `conductor.tsx` — insert canned prompts. No backend distinction; effectively demo UX with no special backend path. Classification: DEMO.
- **`FileBrowserEntry` type** — defined at L35 of conductor.tsx; the directory browser (settings modal) is functional but the type is locally duplicated from gateway-api. Classification: BLOAT.
- **`BLENDED_COST_PER_MILLION_TOKENS = 5`** (L101) — hardcoded cost estimate; no model-specific pricing. Classification: DEMO.
- **`AGENT_NAMES` / `AGENT_EMOJIS` arrays** (L99-100) — static persona names assigned round-robin, no real agent identity. Classification: DEMO (cosmetic).
- **`usePreviewAvailability` hook** (L394-445) — probes preview URL with `fetch()` up to 4 times / 6 s timeout. Only reaches iframe if worker writes HTML to `/tmp/dispatch-*`. Classification: ACTIVE but fragile; path detection is heuristic-only (L667-698).
- **`CyclingStatus` / `PlanningIndicator`** (L209-237) — animated placeholder text during decomposition. No real progress signal from backend. Classification: DEMO (cosmetic).
- **`PLANNING_STEPS` / `WORKING_STEPS` arrays** (L196-207) — cycling strings shown during phases. Classification: DEMO.
- **`use-mission-orchestrator.ts`** (1042 LOC, modified 2026-04-19) — ZERO callers anywhere in src/. Classification: DEAD — safe to delete immediately.
- **`export-mission.tsx`** (140 LOC, modified 2026-04-19) — ZERO callers. Classification: DEAD.
- **`mission-timeline.tsx`** (162 LOC, modified 2026-04-19) — ZERO callers. Classification: DEAD.
- **`run-compare.tsx`** (204 LOC, modified 2026-04-19) — ZERO callers. Classification: DEAD.
- **`template-picker.tsx`** — only caller is itself (self-reference in file definition). ZERO external callers. Classification: DEAD.
- **`workflow-templates.ts`** (163 LOC) — only caller is `template-picker.tsx` which is dead. Classification: DEAD.
- **`run-console.tsx`** — only caller is itself (no external import found). Contains `mission-event-log` and `run-learnings`. Classification: DEAD cluster.
- **`mission-event-log.tsx`** — imported only by `run-console.tsx` (dead). Classification: DEAD.
- **`run-learnings.tsx`** (227 LOC) — imported only by `run-console.tsx` (dead). Classification: DEAD.
- **`mission-events.ts`** (221 LOC) — imported only by `run-console.tsx` and `mission-event-log.tsx` (both dead). Classification: DEAD.
- **Supervised mode UI** — checkbox in settings (`supervised: boolean`); passed to spawn, accepted by backend. Backend effect unverified. Classification: TODO / EVALUATE.
- **`continueDraft` / "Continue Mission" flow** (L850-872 conductor.tsx) — sends a follow-up prompt to active orchestrator session via portable stream. Wired but only works in portable mode; dashboard mode continuation untested. Classification: ACTIVE (portable) / TODO (dashboard).

---

## 7. Redundancy with Other Pages

| Feature | Conductor Location | Alternative Location | Recommendation |
|---------|-------------------|---------------------|----------------|
| Agent card grid (office view) | `conductor.tsx` → `<OfficeView>` → `<AgentWorkingPanel>` | `agent-hub-layout.tsx` → same components | Shared already; revamp should consume agent-hub's version directly |
| Recent session list | `conductor.tsx` L1096-1100, polls `/api/sessions` | Operations screen (`use-operations`) also shows sessions | Overlap. Operations = persistent agents/cron; Conductor = ephemeral missions. Distinct enough to keep separate feeds. |
| Model selector dropdown | `ModelSelectorDropdown` (L523) inline in conductor | Operations settings modal has its own model picker | Duplicate implementation — consolidate to shared component |
| Worker output display | `WorkerCard` L329 + full output section L2026 | `agent-output-panel.tsx` in agent-hub | Parallel implementations; revamp should reuse `agent-output-panel` |
| Mission cost / token summary | `MissionCostSection` L139 | `cost-analytics.tsx` in gateway components | Parallel. `cost-analytics.tsx` is more generic; revamp should reuse it |
| Activity feed with sessions | `activityItems` blending history + sessions L1101 | `live-feed-panel.tsx`, `live-activity-panel.tsx` in gateway | Conductor has an ad-hoc inline version; revamp should use `live-activity-panel` |
| Pause/resume worker | `handlePause` in `use-conductor-gateway.ts` | `gateway-api.ts` `pauseAgent` is the shared primitive | Already shared at API level; no UI-level sharing |
| Task board / task list | `conductor.tsx` L2280+ inline task list | `task-board.tsx` in gateway components | Parallel implementation; revamp should use `task-board.tsx` |

---

## 8. Bloatware Indicators

- **Monolith size**: `conductor.tsx` is 2404 LOC for a single screen. It inlines 15+ helper functions, 10+ sub-components, and the entire render tree in one file.
- **Duplicate `THEME_STYLE` block**: Identical CSS-variable map defined in both `conductor.tsx` (L43-98) and `operations-screen.tsx`. Should be a shared constant.
- **`FileBrowserEntry` type locally duplicated** (L35 conductor.tsx) — already exists in gateway-api context.
- **`HistoryMessage` type duplicated** — defined in both `conductor.tsx` (L20) and `use-conductor-gateway.ts` (L11); should be exported once.
- **`getLastAssistantMessage` / `extractMessageText`** (L644-665) — utility functions embedded in conductor.tsx with no export; likely duplicated elsewhere.
- **1706-LOC hook** (`use-conductor-gateway.ts`) handles mission state, polling, SSE streaming, localStorage persistence, pause/resume, history fetch, worker tracking, and settings — at least 4 distinct responsibilities that should be split.
- **`use-mission-orchestrator.ts` (1042 LOC, zero callers)** — largest dead file in the repo.
- **Hardcoded `PLANNING_STEPS` / `WORKING_STEPS` arrays** — text-only; no real backend signal drives phase transitions.
- **`loadDispatchSkill()` in `conductor-spawn.ts`** — reads a local file from up to 4 candidate paths at request time; fragile and blocking. Should be loaded once at startup.
- **`buildOrchestratorPrompt()` (L71-117 conductor-spawn.ts)** — 46-line prompt template inlined in the route file. Should live in a separate module.

---

## 9. Recommended Deletion List

In priority order (safest first):

1. `src/screens/gateway/hooks/use-mission-orchestrator.ts` — 1042 LOC, zero callers. **Risk: SAFE**
2. `src/screens/gateway/components/export-mission.tsx` — 140 LOC, zero callers. **Risk: SAFE**
3. `src/screens/gateway/components/mission-timeline.tsx` — 162 LOC, zero callers. **Risk: SAFE**
4. `src/screens/gateway/components/run-compare.tsx` — 204 LOC, zero callers. **Risk: SAFE**
5. `src/screens/gateway/components/template-picker.tsx` — zero external callers. **Risk: SAFE**
6. `src/screens/gateway/lib/workflow-templates.ts` — only caller is `template-picker.tsx` (dead). **Risk: SAFE**
7. `src/screens/gateway/components/run-console.tsx` — zero external callers (verify with one final grep before delete). **Risk: SAFE after verify**
8. `src/screens/gateway/components/mission-event-log.tsx` — only caller is `run-console.tsx` (dead). **Risk: SAFE after #7**
9. `src/screens/gateway/components/run-learnings.tsx` — only caller is `run-console.tsx` (dead). **Risk: SAFE after #7**
10. `src/screens/gateway/lib/mission-events.ts` — only callers are items #7 and #8 (dead). **Risk: SAFE after #7-8**
11. `src/screens/gateway/components/live-activity-panel.tsx` — Codex audit 2026-05-13: zero non-conductor consumers. **Risk: SAFE** (moved from shared-preserve per Fix 1)
12. `src/screens/gateway/components/overview-tab.tsx` — Codex audit 2026-05-13: zero non-conductor consumers; has `// TODO(orphan)` marker. **Risk: SAFE** (moved from shared-preserve per Fix 1)
13. `src/screens/gateway/conductor.tsx` — the monolith itself, replaced by revamp. **Risk: DELETION-LAST** (see constraint below)
14. `src/screens/gateway/hooks/use-conductor-gateway.ts` — replaced by revamp. **Risk: NEEDS-DECOUPLE** (only caller is conductor.tsx; confirm after #13)

**Total safe-delete LOC before revamp starts:** ~1,942 LOC (items 1-10) + items 11-12 after third-wave audit.

### Deletion Order Constraints

**Conductor screen (`src/screens/gateway/conductor.tsx`) is deletion-last.** `src/routes/conductor.tsx` imports it directly (`import { Conductor } from '@/screens/gateway/conductor'`). The screen file must not be deleted until the Matrix revamp ships a replacement component and `src/routes/conductor.tsx` is updated to import it.

Recommended wave order:

1. **First wave — SAFE, fully isolated dead code:** `use-mission-orchestrator`, `export-mission`, `mission-timeline`, `run-compare`, `template-picker`, `workflow-templates` (items 1–6). Zero downstream impact.
2. **Second wave — SAFE after #7 confirmed dead:** `run-console`, `mission-event-log`, `run-learnings`, `mission-events` (items 7–10). Slightly more entangled; grep-verify before delete.
3. **Third wave — after Codex re-audit:** `live-activity-panel`, `overview-tab` (items 11–12). Reclassified from shared-preserve; confirm no new callers appeared since 2026-05-13 audit.
4. **Last — only after replacement is wired:** `src/screens/gateway/conductor.tsx` (item 13), then `use-conductor-gateway.ts` (item 14).

### routeTree.gen.ts — No Manual Edit Needed

`src/routeTree.gen.ts` references `/conductor` at lines 206–207 and 1812–1815. This file is **auto-generated** by the TanStack Router Vite plugin. When `src/routes/conductor.tsx` is modified or replaced, the route tree regenerates automatically during `pnpm dev` or `pnpm build`. Do not edit `routeTree.gen.ts` by hand.

---

## 10. Recommended Refactor List

Files that must survive but should be slimmed or restructured before the revamp writes new code against them:

| File | What to Slim | Why |
|------|-------------|-----|
| `src/routes/api/conductor-spawn.ts` | Extract `buildOrchestratorPrompt()` to `src/server/conductor-orchestrator-prompt.ts`; extract `loadDispatchSkill()` to module-level singleton | Keeps route handler thin; makes prompt logic independently testable |
| `src/screens/gateway/components/office-view.tsx` | Audit props — conductor passed custom `homeOfficeRows` shape; post-revamp callers may differ | Avoid breaking agent-hub |
| `src/screens/gateway/components/agents-working-panel.tsx` | Same prop audit | Same reason |
| `src/lib/gateway-api.ts` | No slimming needed, but confirm `fetchSessions` filter logic matches new conductor's session-labeling conventions | Conductor filters `worker-*` prefix; may need to expose a typed helper |
| `src/server/gateway-capabilities.ts` | No structural change needed; but `conductor` capability flag gating should be documented for revamp | Revamp must handle `capabilities.conductor === false` (portable fallback) |

---

## 11. Hard No-Touch List

These files are depended on by other screens and must not be modified as part of conductor cleanup:

- `src/lib/gateway-api.ts` — core for chat, operations, sessions
- `src/server/gateway-capabilities.ts` — core for all API routes
- `src/server/hermes-api.ts` — core for all API routes
- `src/server/auth-middleware.ts` — core for all API routes
- `src/server/rate-limit.ts` — core for all API routes
- `src/routes/api/send-stream.ts` — used by chat, memory, onboarding
- `src/routes/api/history.ts` — used by chat screen
- `src/routes/api/models.ts` — used by chat, settings
- `src/routes/api/files.ts` — used by files page
- `src/screens/gateway/components/streaming-text.tsx` — used by chat-screen, agent-output-panel
- `src/screens/gateway/components/office-view.tsx` — used by agent-hub-layout, overview-tab
- `src/screens/gateway/components/agents-working-panel.tsx` — used by agent-hub-layout, live-activity-panel, overview-tab
- `src/screens/gateway/agent-hub-layout.tsx` — used by agents-screen
- `src/screens/gateway/lib/mission-checkpoint.ts` — used by `src/stores/mission-store.ts` and `hub-utils.tsx`
- `src/stores/mission-store.ts` — used by `hub-constants.tsx` and `use-agent-view.ts`
- `src/components/workflow-help-modal.tsx` — used by agents-screen
- `src/routes/conductor.tsx` (route shell) — must remain; revamp replaces the screen it points to

---

## 12. Risks and Open Questions

1. **`run-console.tsx` has zero confirmed external callers** but the grep searched by filename string. Confirm with a full AST-level symbol search before deleting, because it may be dynamically imported or lazy-loaded.

2. **`mission-checkpoint.ts` is shared** (`mission-store.ts`, `hub-utils.tsx`). The conductor page does NOT directly import it, but `use-conductor-gateway.ts` references mission state that may write to the same store. Verify no regression when `use-conductor-gateway.ts` is removed.

3. **Portable mode vs dashboard mode**: The revamp must decide whether to keep both execution paths or drop the portable fallback. The portable path (SSE via `/api/send-stream`) shares infrastructure with chat. The dashboard path requires `capabilities.conductor` from the hermes dashboard plugin. This decision affects `conductor-spawn.ts` scope.

4. **`/api/preview-file` is only called from conductor** (output iframe). If the revamp drops the inline preview feature, this route can be deleted too. User decision needed.

5. **Supervised mode** — the UI checkbox exists, the backend parameter is passed through, but whether the hermes dashboard honors `supervised: true` was not verified. Mark as TODO until tested.

6. **`loadDispatchSkill()` path resolution** — reads from 4 candidate paths at request time. If none exists, the orchestrator prompt is built without the dispatch skill instructions. This is a silent degradation. Revamp should surface this as a warning.

7. **`CONDUCTOR_GOAL_DRAFT_STORAGE_KEY` localStorage key** — if the revamp changes the goal input component, old drafts in user browsers will still load. Intentional migration or key bump needed.

8. **Operations page overlap** — user mentioned new design will absorb conductor + operations. The operations screen (`src/screens/agents/operations-screen.tsx`) is a separate, fully independent surface. This plan does NOT cover operations cleanout — that is out of scope per instructions.
