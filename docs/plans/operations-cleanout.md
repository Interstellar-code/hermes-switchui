# Operations Page Cleanout Plan

**Date:** 2026-05-09
**Author:** Planner (sonnet)
**Pre-revamp scope:** Identify dead and redundant code before /operations UI revamp. No code changes — plan only.

---

## 1. File Inventory (operations-only)

These files are exclusively consumed by the `/operations` route. Nothing outside `src/screens/agents/` or `src/routes/operations.tsx` imports them.

| Path | LOC | Last Modified | Purpose | Classification |
|------|-----|--------------|---------|----------------|
| `src/routes/operations.tsx` | 41 | 2026-04-20 | Route shell + error/pending wrappers | KEEP (gutted during revamp) |
| `src/screens/agents/operations-screen.tsx` | 265 | 2026-04-20 | Top-level screen orchestrator, `THEME_STYLE` constants | DELETE (replace entirely) |
| `src/screens/agents/hooks/use-operations.ts` | 766 | 2026-05-03 | Core data hook: profiles API, sessions, cron, agent state machine | EVALUATE (some logic survives) |
| `src/screens/agents/hooks/use-agent-chat.ts` | 108 | 2026-04-20 | Chat history + send mutation for a single session key | EVALUATE (shared concept, not shared file) |
| `src/screens/agents/agent-presets.ts` | 144 | 2026-05-01 | Hardcoded agent persona library + localStorage seeder | EVALUATE (presets survive; seeder is bloat) |
| `src/screens/agents/components/operations-agent-card.tsx` | 453 | 2026-05-12 | Per-agent card: inline chat, cron panel, play/pause | DELETE (replace with Matrix card) |
| `src/screens/agents/components/operations-agent-chat.tsx` | 123 | 2026-04-20 | **Dead** — standalone chat panel, never imported anywhere | DELETE — zero callers (evidence: grep returned only own file) |
| `src/screens/agents/components/operations-agent-detail.tsx` | 318 | 2026-04-20 | Modal: edit name/emoji/model/system-prompt + delete | DELETE (replace with Matrix drawer/modal) |
| `src/screens/agents/components/operations-agent-jobs.tsx` | 219 | 2026-04-20 | **Dead** — job CRUD panel, never imported anywhere | DELETE — zero callers (evidence: grep returned only own file) |
| `src/screens/agents/components/operations-new-agent-modal.tsx` | 331 | 2026-04-20 | Modal: create new agent from preset | DELETE (replace with Matrix modal) |
| `src/screens/agents/components/operations-settings-modal.tsx` | 259 | 2026-04-20 | Modal: global ops settings (model, autoApprove, feed length) | DELETE (replace — `autoApprove` is explicitly placeholder) |
| `src/screens/agents/components/full-outputs-view.tsx` | 413 | 2026-04-20 | "Outputs" tab: renders cron job results | DELETE — backed by stub hook (see §6) |

**Operations-only total: ~3,440 LOC across 12 files**

---

## 2. File Inventory (shared with other screens)

These files are used by operations AND other screens. Must NOT be deleted; decouple first.

| Path | LOC | Last Modified | Purpose | Used by (outside operations) | Classification |
|------|-----|--------------|---------|------------------------------|----------------|
| `src/hooks/use-agent-outputs.ts` | 66 | 2026-05-01 | **Stub hook** — always returns empty list, no-op refresh | Only `full-outputs-view.tsx` | DELETE — Codex audit 2026-05-13: hook's only consumer is full-outputs-view.tsx, also slated for deletion. |
| `src/lib/orchestrator-identity.ts` | 163 | 2026-05-12 | Orchestrator name stored in localStorage | `agent-view-panel.tsx`, `dashboard-config.ts` | KEEP — shared, do not touch |
| `src/lib/cron-api.ts` | — | — | `fetchCronJobs`, `toggleCronJob`, `runCronJob`, `upsertCronJob` | `jobs/` screen, `crons-wizard.tsx`, etc. | KEEP — shared |
| `src/lib/gateway-api.ts` | — | — | `fetchSessions`, `fetchSessionHistory`, `sendToSession`, `fetchModels` | Chat, gateway, conductor screens | KEEP — shared |
| `src/routes/api/history.ts` | 140 | 2026-05-09 | Session history API | `agent-chat/AgentChatModal`, `agent-stream-panel`, chat screens | KEEP — shared |
| `src/screens/dashboard/lib/formatters.ts` | — | — | `formatRelativeTime`, `formatModelName` | Dashboard, jobs, tasks, etc. | KEEP — shared |
| `src/components/agent-view/agent-progress.tsx` | — | — | Circular progress ring around avatar | `agent-view-panel.tsx` | KEEP — shared |
| `src/components/avatars/index.ts` (PixelAvatar) | — | — | Pixel-art avatar component | Used in chat, conductor | KEEP — shared |
| `src/components/prompt-kit/markdown.tsx` | — | — | Markdown renderer | Chat, conductor, many screens | KEEP — shared |

---

## 3. Backend Routes Used

| Route File | Method | Path | What It Does | Callers Outside Operations | Shared? | Safe to Delete? |
|-----------|--------|------|-------------|---------------------------|---------|----------------|
| `src/routes/api/profiles/list.ts` | GET | `/api/profiles/list` | Lists Hermes profiles (agents) | `profiles/` screen, `tasks/`, `jobs/crons-wizard`, chat composer | YES | NO — heavily shared |
| `src/routes/api/profiles/create.ts` | POST | `/api/profiles/create` | Creates a new Hermes profile | `profiles/` screen, `agent-wizard` | YES | NO |
| `src/routes/api/profiles/update.ts` | POST | `/api/profiles/update` | Patches model/system_prompt in config.yaml | `profiles/` screen, `agent-detail-drawer` | YES | NO |
| `src/routes/api/profiles/delete.ts` | POST | `/api/profiles/delete` | Deletes a Hermes profile | `profiles/` screen | YES | NO |
| `src/routes/api/profiles/activate.ts` | POST | `/api/profiles/activate` | Activates a profile | `profiles/` screen | YES | NO — stale (2026-04-10) |
| `src/routes/api/profiles/read.ts` | GET | `/api/profiles/read` | Reads a single profile | `profiles/` screen | YES | NO |
| `src/routes/api/profiles/rename.ts` | POST | `/api/profiles/rename` | Renames a profile | `profiles/` screen | YES | NO |
| `src/routes/api/history.ts` | GET | `/api/history` | Session message history | Chat, agent-chat modal, conductor | YES | NO |

**Summary:** Operations calls 4 of these 8 profile routes (`list`, `create`, `update`, `delete`) and `history`. None are operations-exclusive. Zero backend routes are safe to delete.

---

## 4. Server-Side Modules Used

| Module | What It Does | Reached Via | Operations-Unique? |
|--------|-------------|-------------|-------------------|
| Hermes profiles FS layer (`~/.hermes/profiles/`) | Reads/writes per-profile config.yaml | `profiles/list`, `create`, `update`, `delete` routes | NO — also used by `profiles/` screen |
| Hermes sessions gateway | Returns live session list + history | `gateway-api.ts → fetchSessions / fetchSessionHistory` | NO — used by chat, conductor |
| Cron gateway | Cron job CRUD + run triggers | `cron-api.ts` | NO — used by `jobs/` screen |

No server-side module is operations-exclusive.

---

## 5. Active Features (wired to real backend)

- **Agent roster**: Reads Hermes profiles via `/api/profiles/list`, maps each profile to an `OperationsAgent`. Wired and functional.
- **Create agent**: `/api/profiles/create` + `/api/profiles/update` for system prompt. Wired.
- **Edit agent** (model, emoji, system prompt): `/api/profiles/update`. Wired.
- **Delete agent**: `/api/profiles/delete`. Wired.
- **Inline chat (card)**: `useAgentChat` → `/api/history` (fetch) + `sendToSession` (gateway-api). Wired, polled every 5 s.
- **Cron job panel** (toggle/run): `toggleCronJob` / `runCronJob` from `cron-api`. Wired.
- **Orchestrator card**: Embeds full `ChatScreen` for `activeFriendlyId="main"`. Wired — uses existing chat infrastructure.
- **Recent Activity feed**: Derives from sessions + cron job last-run data. Wired (read-only).

---

## 6. Demo / Dead / TODO Features

| Feature | Location | Evidence | Classification |
|---------|----------|----------|----------------|
| **Outputs tab / FullOutputsView** | `full-outputs-view.tsx` | `use-agent-outputs.ts` is explicitly a **stub** — always returns `[]`, no-op `refresh`. File comment: "Replace with a real hook when we wire up an outputs feed." | DEAD — renders empty state every time |
| **autoApprove setting** | `operations-settings-modal.tsx:199` | Label reads "Reserved for future workflow automation." Checkbox persisted to localStorage but never read by any business logic. | TODO — placeholder only |
| **`OperationsAgentChat` component** | `operations-agent-chat.tsx` | Zero import sites across entire codebase. Standalone chat panel with textarea + message list. Superseded by inline `OperationsInlineChat` inside `operations-agent-card.tsx`. | DEAD — unreachable |
| **`OperationsAgentJobs` component** | `operations-agent-jobs.tsx` | Zero import sites across entire codebase. Job CRUD UI with add/toggle. Job management moved to `/jobs` route (card links there). | DEAD — unreachable |
| **Play/Pause button on agent card** | `operations-agent-card.tsx:215-222` | "Pause" sets local `isPaused` state but does NOT call any API — no actual pause propagated to backend. "Play" sends generic `"Run your primary task now"` chat message. Not a real scheduler control. | DEMO — fake pause |
| **OrchestratorCard progress ring** | `orchestrator-card.tsx:73` | Hardcoded `value={82}` and `status="running"` — never connected to actual orchestrator state. | DEMO — hardcoded value |
| **`pc1-coder`, `pc1-planner`, `pc1-critic` presets** | `agent-presets.ts:105-122` | Filtered out of `OperationsNewAgentModal` via `!id.startsWith('pc1-')`. Hidden from roster via `HIDDEN_AGENTS` Set. Still seeded into localStorage on load. | DEAD — seeded but never shown |
| **`ClaudeProfileSummary` type** | `use-operations.ts:12` | Defined but only used internally inside `fetchClaudeProfiles` → `fetchOperationsConfig` adapter. Not exported, not tested. | EVALUATE — internal only |
| **`selectedAgent` / `setSelectedAgent` / `saveAgentMeta`** | `use-operations.ts:737-741` | Exported from `useOperations()` but never destructured by `operations-screen.tsx` (only `agents`, `recentActivity`, `configQuery`, `sessionsQuery`, `cronJobsQuery`, `settings`, `saveSettings`, `defaultModel`, `createAgent`, `saveAgent`, `deleteAgent` are used). | DEAD exports from hook |

---

## 7. Redundancy with Other Pages

| Feature | Operations Location | Better Alternative | Recommendation |
|---------|--------------------|--------------------|----------------|
| Agent creation (name, model, system prompt) | `operations-new-agent-modal.tsx` | `/profiles` screen — full `agent-wizard.tsx` with more fields | Duplicate intent; operations' modal is simpler but redundant |
| Agent config edit (model, system prompt) | `operations-agent-detail.tsx` | `/profiles` → `agent-detail-drawer.tsx` | Both call same API routes; decouple ops UI, keep profiles as source of truth |
| Cron job creation per agent | `operations-agent-jobs.tsx` (dead) + cron panel in card | `/jobs` → `crons-wizard.tsx` | Operations card links to `/jobs` for adding — jobs screen is canonical |
| Orchestrator chat embed | `orchestrator-card.tsx` (lazy-loads `ChatScreen`) | `/chat` or conductor `ChatScreen` embed | Conductor + Operations both embed `ChatScreen` for `main`. After merge, keep one. |
| Session history display | `use-agent-chat.ts` → `/api/history` | Chat screen, `AgentChatModal` | Three independent fetch paths to same endpoint — consolidate |
| Agent roster / status | Agent cards grid | `/conductor` → remote-agents-panel | Conductor shows live session status. Operations shows profile-level config state. Different level — flag for new design to reconcile |

The user noted conductor and operations are being merged — `orchestrator-card.tsx` is the bridge: it already embeds the full `ChatScreen`. The new design should absorb this without a separate orchestrator card.

---

## 8. Bloatware Indicators

- **Duplicate `ModelSelector` component**: Defined identically in `operations-new-agent-modal.tsx` (lines 43-131) AND `operations-agent-detail.tsx` (lines 24-153). Same logic, same props, no shared abstraction. ~200 LOC of copy-paste.
- **Duplicate `normalizeModel` function**: Appears in `operations-new-agent-modal.tsx` and `operations-settings-modal.tsx` and `operations-agent-detail.tsx`. Three copies.
- **`THEME_STYLE` CSS variable object** (operations-screen.tsx lines 21-43): Locally defined here AND independently redefined in `conductor.tsx` (line 43) and `agent-hub-layout.tsx` (line 11). Three independent copies of the same theme token map.
- **`agent-presets.ts` pc1-* entries**: 3 presets that are actively filtered out of every UI surface but still seeded into localStorage on every page load.
- **`use-agent-outputs.ts`** (66 LOC): Entire file is a stub with comments saying "replace when wired." The Outputs tab renders a permanent empty state.
- **`operations-agent-chat.tsx`** (123 LOC): Component with full textarea + history + markdown render — dead file, no import.
- **`operations-agent-jobs.tsx`** (219 LOC): Full job CRUD UI — dead file, no import.
- **`autoApprove` setting**: Stored, never read. ~40 LOC of ceremony for a future feature that has no backend.
- **`useOperations()` unused returns**: `selectedAgent`, `setSelectedAgent`, `saveAgentMeta`, `refreshAll`, `slugifyJobLabel` — exported but never consumed by `operations-screen.tsx`. Adds surface area with no callers.
- **Motion/framer on every card**: `motion.div` stagger animation on each agent card (0.04s * index delay). Reasonable for <6 cards; becomes jank with 20+ agents. Premature polish.
- **`OrchestratorCard` hardcoded progress**: `value={82}` and `status="running"` — cosmetic demo that misleads users about real orchestrator state.

---

## 9. Recommended Deletion List

Ordered by safety (safest first):

| # | Target | Risk | Reason |
|---|--------|------|--------|
| 1 | `src/screens/agents/components/operations-agent-chat.tsx` | SAFE | Zero callers. Superseded by inline chat in card. |
| 2 | `src/screens/agents/components/operations-agent-jobs.tsx` | SAFE | Zero callers. Jobs managed at `/jobs`. |
| 3 | `src/hooks/use-agent-outputs.ts` | SAFE | Only caller is `full-outputs-view.tsx` which is itself deletion candidate. Both go together. Codex audit 2026-05-13: hook's only consumer is full-outputs-view.tsx, also slated for deletion. |
| 4 | `src/screens/agents/components/full-outputs-view.tsx` | SAFE | Backed by stub hook — always renders empty state. Delete with #3. |
| 5 | Remove `pc1-*` entries from `src/screens/agents/agent-presets.ts` | SAFE | Already filtered from all UI. Pollutes localStorage. Keep file, trim 3 entries (~20 LOC). |
| 6 | `src/screens/agents/components/operations-agent-card.tsx` | SAFE (at revamp) | Replace entirely during Matrix revamp. Coordinate with new card. |
| 7 | `src/screens/agents/components/operations-agent-detail.tsx` | SAFE (at revamp) | Replace with Matrix drawer. API calls remain via `use-operations.ts`. |
| 8 | `src/screens/agents/components/operations-new-agent-modal.tsx` | SAFE (at revamp) | Replace with Matrix modal. |
| 9 | `src/screens/agents/components/operations-settings-modal.tsx` | SAFE (at revamp) | Replace; drop `autoApprove` field. |
| 10 | `src/screens/agents/components/orchestrator-card.tsx` | EVALUATE | If conductor merge absorbs the `ChatScreen` embed, this whole card goes. Confirm with conductor agent. **Name collision**: `agent-view-panel.tsx:189` defines a local `OrchestratorCard` function inline (different component, same name). Pre-deletion check: confirm `agent-view-panel.tsx` does NOT import operations' orchestrator-card; the duplicate name is internal-only and safe. |
| 11 | `src/screens/agents/operations-screen.tsx` | SAFE (at revamp) | Replace with Matrix screen. **DELETION-LAST**: survives the entire cleanout until the Matrix revamp ships a replacement AND `src/routes/operations.tsx:3` is updated to import the replacement. Do not delete before that import is switched. |

### Deletion Order Constraints

- `src/screens/agents/operations-screen.tsx` is **deletion-last**. The route shell `src/routes/operations.tsx:3` imports it directly. It must not be removed until the Matrix replacement component exists and the route import is updated.

---

## 10. Recommended Refactor List

Files that survive but need cleanup before or during revamp:

| File | What to Slim | Priority |
|------|-------------|----------|
| `src/screens/agents/hooks/use-operations.ts` (766 LOC) | - Extract `fetchOperationsConfig` adapter into its own file<br>- Remove unused hook returns (`selectedAgent`, `setSelectedAgent`, `saveAgentMeta`, `refreshAll`, `slugifyJobLabel`)<br>- Extract `ClaudeProfileSummary` type to a shared profiles types file | HIGH — bloated hook used by new screen |
| `src/screens/agents/agent-presets.ts` | Remove `pc1-*` presets (lines 105-122). Consider moving preset data to a JSON file to separate data from logic. | MEDIUM |
| `src/lib/orchestrator-identity.ts` | Used by operations AND agent-view-panel. No cleanout needed, but the new Matrix design should own the orchestrator naming UX clearly — coordinate with conductor. | LOW |
| `THEME_STYLE` constant | Currently copy-pasted in 3 files. Extract to a shared `src/lib/theme-style.ts` before revamp to avoid a 4th copy. | MEDIUM |

---

## 11. Hard No-Touch List

These files are depended on by other screens. Do not delete or restructure during the operations revamp:

| File | Depended On By |
|------|---------------|
| `src/routes/api/profiles/list.ts` | `profiles/` screen, `tasks/`, `chat-composer`, `jobs/crons-wizard` |
| `src/routes/api/profiles/create.ts` | `profiles/agent-wizard.tsx` |
| `src/routes/api/profiles/update.ts` | `profiles/agent-detail-drawer.tsx` |
| `src/routes/api/profiles/delete.ts` | `profiles/` screen |
| `src/routes/api/profiles/activate.ts` | `profiles/` screen |
| `src/routes/api/profiles/read.ts` | `profiles/` screen |
| `src/routes/api/profiles/rename.ts` | `profiles/` screen |
| `src/routes/api/history.ts` | `chat/`, `agent-chat/AgentChatModal`, `agent-stream-panel`, `conductor` |
| `src/lib/cron-api.ts` | `jobs/` screen, `crons-wizard`, gateway hooks |
| `src/lib/gateway-api.ts` | Chat, conductor, gateway, profiles screens |
| `src/lib/orchestrator-identity.ts` | `agent-view-panel.tsx`, `dashboard-config.ts` |
| `src/screens/agents/agents-screen.tsx` | Routed at `/agents` — separate route, do NOT confuse with `/operations` |
| `src/components/agent-view/agent-progress.tsx` | `agent-view-panel.tsx` |
| `src/components/avatars/` (PixelAvatar) | Chat, conductor |
| `src/components/prompt-kit/markdown.tsx` | Chat, conductor, many screens |
| `src/screens/dashboard/lib/formatters.ts` | Dashboard, tasks, jobs, operations |

---

## 12. Risks & Open Questions

| # | Risk / Question | Severity | Notes |
|---|----------------|----------|-------|
| 1 | **Conductor merge scope**: `orchestrator-card.tsx` lazy-loads `ChatScreen`. If conductor absorbs operations, this card may be replaced by conductor's own embed. Deleting it early could break the current `/operations` until revamp ships. | HIGH | Coordinate with conductor analysis agent before deleting `orchestrator-card.tsx`. |
| 2 | **localStorage orphan data**: `operations:agents:*` keys and `operations-settings` in localStorage accumulate across browsers. No migration on delete. Old data will linger in users' browsers indefinitely. | MEDIUM | Add a one-time migration/purge in the new screen's mount effect. |
| 3 | **`pc1-*` preset localStorage entries**: Seeded on every page load for `pc1-coder`, `pc1-planner`, `pc1-critic`. These are hidden from UI but names are hardcoded Interstellar-specific local model configs. If users have these profiles in their gateway, the `HIDDEN_AGENTS` filter hides them from operations but they appear in `/profiles`. | LOW | Verify whether pc1 profiles are in production gateway before removing from presets. |
| 4 | **`autoApprove` backend**: The field is stored in localStorage but has no backend wiring. Future workflow automation may want this. Decision needed: drop entirely or keep with a "coming soon" indicator. | LOW | User decides scope of Settings modal in new design. |
| 5 | **`use-operations.ts` coupling**: The hook does profile-to-agent adaptation (maps Hermes profiles → `OperationsAgent`). This adapter logic is specific to operations' data model. The new Matrix screen will need either this hook or a replacement. Do not delete before the new screen's data layer is designed. | HIGH | Treat hook as EVALUATE not DELETE. Slim it; don't nuke it. |
| 6 | **`agents-screen.tsx` vs `operations-screen.tsx`**: Both live in `src/screens/agents/`. `agents-screen.tsx` is at route `/agents` (not `/operations`) and has already been simplified to a stub redirecting to conductor. No conflict, but naming is confusing. | LOW | Consider renaming directory from `agents/` to `operations/` during revamp. |
| 7 | **Evidence gap on `/api/profiles/__tests__/`**: Profile route tests exist (`src/routes/api/profiles/__tests__/`). Not audited. If any test imports operations-specific mocks, those would need updating when operations data layer changes. | LOW | Executor should grep for operations-specific fixtures in that test directory. |
| 8 | **`routeTree.gen.ts` regeneration**: `src/routeTree.gen.ts` references `/operations` at lines 171-172 and 1763-1766. This file is **auto-generated** by the TanStack Router Vite plugin — no manual edit needed. It regenerates automatically when `src/routes/operations.tsx` is modified or removed during `pnpm dev` or `pnpm build`. | LOW | No action required; just don't hand-edit routeTree.gen.ts. |
