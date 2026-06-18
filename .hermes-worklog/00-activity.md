# SwitchUI — Weekly Activity (7d)

**Repo:** hermes-switchui (origin: Interstellar-code/hermes-switchui · upstream: outsourc-e/hermes-workspace)
**Branch:** `main`
**Window:** 2026-06-06 17:27 → 2026-06-13 17:27 (+0200)
**Generated:** 2026-06-13 17:27 +0200

## Summary

| Metric | Value |
|---|---|
| Commits | 128 |
| Merges | 17 |
| Tags released | 21 (`v2.3.27` → `v2.3.47`) |
| Files changed | 547 |
| Insertions | 46,255 |
| Deletions | 8,195 |

### Contributors

| Author | Commits |
|---|---|
| Rohit Sharma | 111 |
| Interstellar-code (GitHub merge bot) | 17 |

*All 17 Interstellar-code commits are PR merge commits squashing Rohit's branch work; no other humans authored commits this week.*

## Releases (tags created in window)

Twenty-one version tags landed, spanning v2.3.27 (Jun 7) through v2.3.47 (Jun 13):

| Tag | Date | Anchor |
|---|---|---|
| v2.3.47 | 2026-06-13 | Board Templates: per-task `scheduled_at`, instantiate modal redesign, metrics footer removal |
| v2.3.46 | 2026-06-12 | template wizard merge (#235) |
| v2.3.45 | 2026-06-12 | Board Templates management page (#231/#232) |
| v2.3.44 | 2026-06-12 | plugin-compat self-heal (#230) |
| v2.3.43 | 2026-06-11 | dynamic version badge + sidebar last-activity ordering |
| v2.3.42 | 2026-06-11 | Matrix3D activity sync + WebGL/kanban console fixes |
| v2.3.41 | 2026-06-10 | Plugins docs on Starlight site |
| v2.3.40 | 2026-06-10 | docs plugins section + website version fix |
| v2.3.39 | 2026-06-10 | cron run-session linking release |
| v2.3.38 | 2026-06-10 | cron history UI + JSON trigger |
| v2.3.37 | 2026-06-10 | website/docs consolidation |
| v2.3.36 | 2026-06-10 | website docs navigation/base path |
| v2.3.35 | 2026-06-09 | embedded flow-diagram rendering |
| v2.3.34 | 2026-06-09 | Task-session chip precedence fix |
| v2.3.33 | 2026-06-09 | Docker disk-free before buildx |
| v2.3.32 | 2026-06-09 | update-offer guard (local < remote) |
| v2.3.31 | 2026-06-09 | recharts width(-1) warning silence |
| v2.3.30 | 2026-06-09 | gateway binary discovery + custom port |
| v2.3.29 | 2026-06-09 | meta bar redesign + per-session cost/token surfacing |
| v2.3.28 | 2026-06-08 | Shiki dark theme under Matrix theme |
| v2.3.27 | 2026-06-07 | shadcn composer cutover at /chat (#187/#190) |

## Major Workstreams

### 1. Kanban Board Templates (#231–#235) — Jun 12–13
End-to-end frontend for reusable Kanban board definitions (hermes-agent #135 P2).
- **#231** Board Templates management page: Types, server client, BFF proxy routes, TanStack Query hooks, raw-YAML editor, instantiate modal, "Save as template" button. 12 files, +1671/-15.
- **#233** Template task runtime/turn fields + keep-status copy.
- **#235** 5-step template creation wizard (2-col + tooltips + validation). Per-task `scheduled_at` for deferred dispatch; removes system metrics footer.
- PRs: #231, #232, #233, #234, #235.

### 2. Chat Hot-Path Performance (#212–#222) — Jun 11–12
Series of perf and stability fixes addressing the recurring "Too many re-renders" crash and streaming stutter.
- **#212** Stabilize message-array identity during streaming; single rAF smoother.
- **#213** Collapsed-head windowing for threads >80 entries (render last 60 + "Show earlier").
- **#214** Consolidate redundant pollers/timers onto ≤3 module-level timers via shared ticker.
- **#215/#216/#217** Gateway `AbortSignal.timeout(10s)`, 503 + degraded flag on history failure, live-poll 800→1500ms, focus-refetch stream guard.
- **#218/#220** Unified `invalidateSessionLists()`, synchronous realtime-buffer clear on session switch.
- **#221** chat-store hot-path hygiene (append-in-common-path, debounced streaming-state persist).
- **#222** Fix stale tool-output / footer in `areMessagesEqual` (content signature + isLastAssistant).
- **#219** Composer busy-state cutover to reactive Zustand subscription.
- Crash diagnostics: error boundary now captures React componentStack, persists last 3 crashes to localStorage, Copy details button.
- **#226** Contain AgentViewPanel re-render crash + dedupe AnimatePresence keys (took down the whole chat route).
- PRs: #223 (merge of high-impact batch), #224, #225, #226.

### 3. Chat Reliability — Tracks 1 & 2 (Jun 7–8)
State-architecture overhaul merged from `feat/track1-chat-state-reliability`.
- **Track 1 (reliability):** drain-watchdog escape hatch for SSE-desync stall (1.1); liveness-authoritative recovery with interrupted affordance (1.2); queue gating tied to recoverable runtime activity, not visual indicators.
- **Track 2 (storage):** runPhase state machine (2.1); `selectIsComposerBusy` cutover (2.2); runPersistence adapter + queue→sessionStorage migration (2.3); portable persistence via `X-Hermes-Session-Id` header (STEP 0).

### 4. Self-Improve Plugin Page (#206–#211) — Jun 11
Full UI for the `karpathy-self-improve` plugin, P0–P3.
- **#206** P0 capability-gated observability scorecard; P1 proposal queue (approve/reject/propose); P2 lifecycle apply/verify/revert + history drawer; P3 scenarios, pause/resume, baseline chart.
- Profile selectors sourced from `/api/profiles/list` instead of metrics snapshots.
- **#210/#211** Narrative UX redesign: single global profile scope, hero red/green diff, lifecycle stepper (Proposed→Approved→Applied→Verified), scenario checklist, jargon tooltips. 9 files, +1671/-678. Live score read from `eval_runs(kind=live)`.

### 5. Hermes Plugin Section + Config Sync (#228) — Jun 12
- `hermes-plugin-sync.ts`: globalThis singleton, register-gated 30s heartbeat (60s backoff), status-code-aware snapshot (404 vs 5xx/timeout), allowlist-only settings mirror.
- `/api/hermes-plugin` GET snapshot + `/api/hermes-plugin/settings` POST (auth + CSRF).
- `section-hermes-plugin.tsx`: status pill, compat banner, connection card, split degraded states. 14 unit tests.
- **#229/#230** Compat self-heal: re-register when cached incompatible verdict is stale; resolve frontend version via `__APP_VERSION__` define (require() unavailable in Vite SSR ESM runtime).

### 6. shadcn/ui Migration (Phase 2) — Jun 7–8
Continuation of the base-ui → shadcn/Radix migration.
- **#192** 9 Tooltip consumers migrated.
- **#193** 19 Dialog consumers migrated (`render={<Button>}` → `asChild`).
- **#194** Delete dead `alert-dialog.tsx` (zero consumers).
- **#195** Command + slash menu migrated to cmdk.

### 7. shadcn Composer Cutover (#187/#190) — Jun 7
Live composer at `/chat` replaced by `ChatComposerShadcn`. Squash-merged PR includes: auto-growing textarea, Enter-to-send, slash/@ autocomplete, image paste + file-picker attachments, reply-to quoting chip, message queue (FIFO drain on stream complete), context counter, model/profile/workspace/thinking selectors (later relocated to meta bar), tool-display 3-state toggle, image-compression pipeline. Feature-flag rollout then flag dropped. 26 files, +4036/-149.

### 8. Custom Slash Commands (Jun 7–8)
- DB-backed persistence in SwitchUI-owned SQLite (avoided mutating Hermes state.db; `better-sqlite3` rebuilt for local Node).
- Composer integration: visible slash discovery, cmdk-aligned facade, usable without local-state tracking.
- Commands remain prompt macros only (no shell execution) by directive.

### 9. Session Management + Meta Bar (Jun 9)
- Surface CLI and A2A sessions as first-class sources; enable Delete for Telegram/CLI/A2A sessions; Telegram sessions clickable in V2 sidebar.
- Per-session cost + token/api detail in chat UI; meta bar redesigned (drop tok/api → add message/tool/skill counts to source tabs).
- Client-side slash commands (`/reset /stop /title /reasoning`).
- Task-session chip precedence over cli/a2a.

### 10. Matrix3D + Console Fixes (Jun 10–11)
- Rewire crew activity to per-profile DB ground truth.
- Stop canvas remount churn that loses WebGL context.
- Raise `kanbanFetch` timeout above worst-case auth flow.

### 11. Cron Run Sessions (Jun 10)
- Name cron run sessions from their jobs; link cron history and session search to run IDs; send JSON when triggering cron jobs; keep history and linked chats in sync; show history when run endpoints unavailable; allow cron deletes to reach jobs backend.

### 12. Website / Docs (Starlight) (Jun 9–10)
Unify website docs with the Matrix shell; embedded flow-diagram rendering (was downloading them); self-contained embedded previews; Plugins docs section; dynamic version badge from GitHub releases; auto-derive displayed version from package.json; skip `build:website` when website/ absent (unblocks Docker).

## Merge Commits (17)

All merges are GitHub squash-merges from `feat/*` branches, authored by the Interstellar-code bot:

```
ed61af30 #235 feat/template-wizard
2b6b522e #234 feat/kanban-template-delta-233
b28670ff #232 feat/board-templates-231
8eaf1e28 #230 fix/plugin-compat-self-heal
c26e1ff2 #229 feat/hermes-plugin-section-228
12cc2ce9 #226 fix/agent-view-panel-rerender-crash
8f5a978f #225 fix/chat-rerender-and-sessions-poller
8fe8773f #224 fix/chat-medium-impact
025cdbee #223 fix/chat-hot-path-high-impact
ef094a8a #211 feat/self-improve-ux-redesign-210
6a40fb1f #207 feat/self-improve-page-206
338f7652 Merge feat/track1-chat-state-reliability (local merge, Track 1+2)
95c3485d #195 feat/shadcn-command-slash-phase2-4-5
7481a6c5 #194 chore/delete-base-ui-alert-dialog
43e48f4b #193 feat/shadcn-dialog-phase2-2
a857842c #192 feat/shadcn-tooltip-phase2-1
b5ab1973 #196 feat/commands-backend-sidebar
```

## Full Commit Log (128, newest first)

```
22a7b29a 2026-06-13 13:06 Rohit Sharma       chore: bump version to 2.3.47 + changelog
5c5e6c86 2026-06-12 16:20 Rohit Sharma       chore: bump version to 2.3.46 + changelog
ed61af30 2026-06-12 16:13 Interstellar-code  Merge #235 feat/template-wizard
b5d6f4da 2026-06-12 16:07 Rohit Sharma       feat(kanban): 5-step template creation wizard (#231 follow-up)
2b6b522e 2026-06-12 15:05 Interstellar-code  Merge #234 feat/kanban-template-delta-233
bf41c98b 2026-06-12 15:00 Rohit Sharma       feat(kanban): template task runtime/turn fields + keep-status copy (#233)
aa6c13de 2026-06-12 13:59 Rohit Sharma       chore: bump version to 2.3.45 + changelog
b28670ff 2026-06-12 13:57 Interstellar-code  Merge #232 feat/board-templates-231
01e0ed22 2026-06-12 13:47 Rohit Sharma       feat(kanban): Board Templates management page (#231)
5053ce5d 2026-06-12 09:58 Rohit Sharma       chore: bump version to 2.3.44 + changelog
8eaf1e28 2026-06-12 09:46 Interstellar-code  Merge #230 fix/plugin-compat-self-heal
86fd4b9d 2026-06-12 09:45 Rohit Sharma       fix(plugin-sync): re-register when cached incompatible verdict is stale
c26e1ff2 2026-06-12 09:09 Interstellar-code  Merge #229 feat/hermes-plugin-section-228
d0b678d3 2026-06-12 09:08 Rohit Sharma       fix(plugin-sync): resolve frontend version via __APP_VERSION__ define
fa283154 2026-06-12 09:02 Rohit Sharma       feat(settings): mirror saved settings to hermes plugin endpoint (P4, #228)
2d8b39a2 2026-06-12 08:57 Rohit Sharma       feat(settings): Hermes plugin section + backend config-sync wiring (P1-P3, #228)
12cc2ce9 2026-06-12 01:25 Interstellar-code  Merge #226 fix/agent-view-panel-rerender-crash
a90f9ad7 2026-06-12 01:25 Rohit Sharma       fix(chat): contain AgentViewPanel re-render crash + dedupe AnimatePresence keys
8f5a978f 2026-06-12 01:13 Interstellar-code  Merge #225 fix/chat-rerender-and-sessions-poller
bccd7569 2026-06-12 01:13 Rohit Sharma       fix(chat): calm idle session pollers + crash-diagnostics error boundary
8fe8773f 2026-06-12 00:24 Interstellar-code  Merge #224 fix/chat-medium-impact
193d56fb 2026-06-12 00:20 Rohit Sharma       fix(chat): complete composer busy-state cutover (#219)
8f1b671f 2026-06-12 00:17 Rohit Sharma       perf(chat): consolidate redundant pollers and timers (#214)
bb121c2a 2026-06-12 00:09 Rohit Sharma       perf(chat): chat-store hot-path hygiene (#221)
53108a58 2026-06-12 00:05 Rohit Sharma       perf(chat): collapsed-head windowing for long threads (#213); fix stale-render gaps (#222)
025cdbee 2026-06-11 23:53 Interstellar-code  Merge #223 fix/chat-hot-path-high-impact
98f59056 2026-06-11 23:49 Rohit Sharma       fix(chat): unified session-list invalidation + realtime buffer cleanup (#218 #220)
3d039971 2026-06-11 23:40 Rohit Sharma       perf(chat): stabilize message-array identity during streaming + single rAF smoother (#212); gateway timeouts, 503, live-poll 800→1500ms, focus-refetch guard (#215 #216 #217)
ef094a8a 2026-06-11 22:18 Interstellar-code  Merge #211 feat/self-improve-ux-redesign-210
be02c656 2026-06-11 22:12 Rohit Sharma       feat(chat): preserve formatting on paste + table copy button
23e4c0e9 2026-06-11 20:37 Rohit Sharma       feat(self-improve): narrative UX redesign — single scope, hero diff, stepper (#210)
6a40fb1f 2026-06-11 13:25 Interstellar-code  Merge #207 feat/self-improve-page-206
3096d6ec 2026-06-11 13:25 Rohit Sharma       docs(self-improve): add self-improving agent assessment & proposal
eed99e3f 2026-06-11 10:56 Rohit Sharma       fix(self-improve): source profile selectors from real agent profiles
8c72e247 2026-06-11 10:39 Rohit Sharma       fix(self-improve): avoid double-parens in single-profile Propose label
bf291835 2026-06-11 10:09 Rohit Sharma       feat(self-improve): P3 scenarios, pause/resume, baseline chart
232c70b6 2026-06-11 09:55 Rohit Sharma       feat(self-improve): P2 lifecycle apply/verify/revert + history drawer
a701ce66 2026-06-11 09:45 Rohit Sharma       feat(self-improve): P1 proposal queue with approve/reject/propose
2c17cea0 2026-06-11 09:26 Rohit Sharma       feat(self-improve): P0 capability-gated observability scorecard
fb5668bd 2026-06-11 08:46 Rohit Sharma       Release v2.3.43 — dynamic version badge + sidebar last-activity ordering
412800e7 2026-06-11 01:09 Rohit Sharma       fix(sidebar): resumed sessions jump to Today on send
c1b1f8ef 2026-06-11 01:01 Rohit Sharma       feat(website): fetch version badge dynamically from GitHub releases
4c8611c6 2026-06-11 00:48 Rohit Sharma       Release v2.3.42 — Matrix3D activity sync + WebGL/kanban console fixes
3ddce6c9 2026-06-11 00:01 Rohit Sharma       fix(matrix3d): stop canvas remount churn that loses WebGL context
146e6228 2026-06-11 00:01 Rohit Sharma       fix(kanban): raise kanbanFetch timeout above worst-case auth flow
8d4888fc 2026-06-10 23:33 Rohit Sharma       fix(matrix3d): rewire crew activity to per-profile DB ground truth
9a8a478f 2026-06-10 17:42 Rohit Sharma       Release v2.3.41 — expose Plugins docs on the Starlight site
745dab0d 2026-06-10 13:33 Rohit Sharma       Release v2.3.40 — docs plugins section + website version fix
caeebf43 2026-06-10 11:13 Rohit Sharma       Release v2.3.39
127dec29 2026-06-10 09:24 Rohit Sharma       Send JSON when triggering cron jobs
09a06bb5 2026-06-10 09:11 Rohit Sharma       Link cron history and session search to run IDs
abc196ba 2026-06-10 08:32 Rohit Sharma       Name cron run sessions from their jobs
3b5853a7 2026-06-10 08:06 Rohit Sharma       Clarify cron history fallback and clean all cron chats
fb85cb8d 2026-06-10 07:52 Rohit Sharma       Show cron history when run endpoints are unavailable
e6833b52 2026-06-10 07:47 Rohit Sharma       Keep cron run history and linked chats in sync
79d63e4f 2026-06-10 07:38 Rohit Sharma       Allow cron deletes to reach the jobs backend
d17852c4 2026-06-10 03:34 Rohit Sharma       Keep docs authoring guidance aligned with Starlight
cb470866 2026-06-10 02:30 Rohit Sharma       Align release metadata around the deployed website
fa137e96 2026-06-10 02:06 Rohit Sharma       Unify website docs with the Matrix shell
88ec1d64 2026-06-10 00:40 Rohit Sharma       Keep website docs navigation within its base
6732cb01 2026-06-10 00:17 Rohit Sharma       Keep embedded website docs self-contained and readable
64fea353 2026-06-09 23:39 Rohit Sharma       Keep docs and website previews usable without duplicating content
c84fd719 2026-06-09 22:41 Rohit Sharma       chore: bump version to 2.3.34 + changelog
7d40f191 2026-06-09 22:39 Rohit Sharma       fix(chat): keep Task sessions in the Task chip (precedence over cli/a2a)
402c91d7 2026-06-09 22:31 Rohit Sharma       chore: bump version to 2.3.33 + changelog
9c102e5e 2026-06-09 22:31 Rohit Sharma       ci(docker): free runner disk before buildx to avoid ResourceExhausted
28c7e6fe 2026-06-09 22:31 Rohit Sharma       chore(chat): remove tap-debug mount console noise
24d32aaf 2026-06-09 22:31 Rohit Sharma       fix(chat): enable Delete for Telegram, CLI, and A2A sessions
0666fe23 2026-06-09 22:21 Rohit Sharma       feat(chat): surface CLI and A2A sessions as first-class sources
bf99123e 2026-06-09 22:00 Rohit Sharma       chore: bump version to 2.3.32 + changelog
2065db32 2026-06-09 21:56 Rohit Sharma       fix(update): only offer update when local is behind remote
3b583fd0 2026-06-09 21:33 Rohit Sharma       fix(dashboard): silence recharts width(-1)/height(-1) warning
8ebf6746 2026-06-09 21:33 Rohit Sharma       fix(chat): make Telegram sessions clickable in V2 sidebar
210bc791 2026-06-09 21:21 Rohit Sharma       chore: bump version to 2.3.31 + changelog
6da61d46 2026-06-09 21:21 Rohit Sharma       test(mcp): repair marketplace dialog tests after shadcn migration
9704f489 2026-06-09 20:13 Rohit Sharma       fix(docs): render embedded flow diagrams instead of downloading them
2f43ff30 2026-06-09 20:00 Rohit Sharma       chore: bump version to 2.3.30 + changelog
74bb80fc 2026-06-09 20:00 Rohit Sharma       fix(gateway): find hermes binary and honor custom gateway port
d0d12280 2026-06-09 18:27 Rohit Sharma       fix(website): auto-derive displayed version from package.json
8fdd1f26 2026-06-09 15:53 Rohit Sharma       fix(build): skip build:website when website/ absent (unblocks Docker image)
789a8ec2 2026-06-09 15:45 Rohit Sharma       chore: bump version to 2.3.29 + changelog
f0321e03 2026-06-09 15:38 Rohit Sharma       feat(chat): drop tok/api from meta bar, add message/tool/skill counts to source tabs
de844470 2026-06-09 15:38 Rohit Sharma       fix(chat): sidebar delete refresh + telegram session classification
e8191cb8 2026-06-09 10:30 Rohit Sharma       feat(chat): strip live/profile/tools from meta bar, surface tok + api
162aa3f4 2026-06-09 10:17 Rohit Sharma       feat(chat): surface per-session cost + token/api detail in chat UI
2e61ad51 2026-06-09 09:56 Rohit Sharma       feat(chat): client-side slash commands (/reset /stop /title /reasoning)
d4d3e069 2026-06-09 09:45 Rohit Sharma       fix(chat): restore tok/s + tools fields in meta bar, fix react-query test mock
b98e6227 2026-06-09 00:17 Rohit Sharma       fix(chat): add missing Button import for interrupted affordance
484b33a1 2026-06-08 23:57 Rohit Sharma       feat(ui): Matrix-themed tabs for slash command picker + inline menu
87baecd2 2026-06-08 23:38 Rohit Sharma       fix(ui): use dark Shiki theme when Matrix theme is active
edff7d0a 2026-06-08 22:20 Rohit Sharma       fix(update): allow update when only package.json version is dirty
73e13f0e 2026-06-08 22:02 Rohit Sharma       chore: bump version to 2.3.28 + changelog
338f7652 2026-06-08 22:01 Rohit Sharma       Merge feat/track1-chat-state-reliability — Track 1+2 chat state architecture
3ef535a8 2026-06-08 16:02 Rohit Sharma       fix(chat): move handleResendInterrupted after 'send' to fix TDZ error
dd6e7cf7 2026-06-08 15:02 Rohit Sharma       docs: mark Track 2 (storage consolidation) as shipped
febc2705 2026-06-08 15:01 Rohit Sharma       test(chat): parity truth table for isChatRuntimeBusy (Track 2 / Phase 2.2)
448b5c05 2026-06-08 14:59 Rohit Sharma       feat(chat): runPersistence adapter + queue→sessionStorage migration (Track 2 / Phase 2.3)
a7ec39b6 2026-06-08 14:50 Rohit Sharma       feat(chat): selectIsComposerBusy cutover (Track 2 / Phase 2.2)
a30403a8 2026-06-08 14:45 Rohit Sharma       feat(chat): runPhase state machine (Track 2 / Phase 2.1)
e55c9d25 2026-06-08 14:29 Rohit Sharma       docs: mark Phase 1.2 as done
a013d350 2026-06-08 12:56 Rohit Sharma       docs: mark Track 1 (reliability) as shipped
cea955b1 2026-06-08 12:53 Rohit Sharma       fix(chat): liveness-authoritative recovery with interrupted affordance (Track 1.2)
192abff3 2026-06-08 12:37 Rohit Sharma       fix(chat): send X-Hermes-Session-Id for portable persistence (STEP 0)
6b3bf9ea 2026-06-08 12:37 Rohit Sharma       fix(chat): drain-watchdog escape hatch for SSE-desync stall (Track 1.1)
8f57e97d 2026-06-08 12:08 Rohit Sharma       docs: STEP 0 complete — portable persistence endpoint not needed
0ccd2547 2026-06-08 11:52 Rohit Sharma       fix: wrap agent-card Tooltip in TooltipProvider
7d4e32fb 2026-06-08 09:27 Rohit Sharma       Dock the shadcn composer on mobile
2bf5a410 2026-06-08 09:19 Rohit Sharma       Type chat stream message metadata
22e9f5e0 2026-06-08 09:08 Rohit Sharma       Record completed shadcn adoption state
23801e80 2026-06-08 09:00 Rohit Sharma       Stop stale chat activity indicators
e66e6bcf 2026-06-08 08:54 Rohit Sharma       Remove the dead chat composer boundary
95c3485d 2026-06-08 08:21 Interstellar-code  Merge #195 feat/shadcn-command-slash-phase2-4-5
7481a6c5 2026-06-08 08:16 Interstellar-code  Merge #194 chore/delete-base-ui-alert-dialog
43e48f4b 2026-06-08 08:16 Interstellar-code  Merge #193 feat/shadcn-dialog-phase2-2
a857842c 2026-06-08 08:16 Interstellar-code  Merge #192 feat/shadcn-tooltip-phase2-1
b5ab1973 2026-06-08 08:16 Interstellar-code  Merge #196 feat/commands-backend-sidebar
67094c77 2026-06-08 07:10 Rohit Sharma       Mirror MCP drawer interactions for command management
2b0709dd 2026-06-08 06:36 Rohit Sharma       Align command management with the MCP workspace
9f4bea4e 2026-06-08 06:00 Rohit Sharma       Prevent companion services from triggering duplicate-start failures
b6f8e6f0 2026-06-07 23:52 Rohit Sharma       Prevent stale chat activity from self-locking the queue
e4728840 2026-06-07 23:27 Rohit Sharma       Make command macros usable from composer without tracking local state
77227612 2026-06-07 23:25 Rohit Sharma       Add visible slash command discovery to the chat composer
a9fa2c4c 2026-06-07 22:16 Rohit Sharma       Persist custom chat commands in SwitchUI-owned SQLite storage
ed3d620a 2026-06-07 21:31 Rohit Sharma       Align command surfaces on cmdk before slash-menu cutover
6d51ce51 2026-06-07 21:13 Rohit Sharma       chore(ui): delete dead src/components/ui/alert-dialog.tsx
a28cbf8a 2026-06-07 21:11 Rohit Sharma       feat(ui): migrate 19 base-ui Dialog consumers to shadcn (Phase 2 #2)
85adf210 2026-06-07 21:06 Rohit Sharma       feat(ui): migrate 9 base-ui Tooltip consumers to shadcn (Phase 2 #1)
d16643f9 2026-06-07 20:50 Interstellar-code  feat(chat): shadcn composer live cutover at /chat (#187) (#190)
```
