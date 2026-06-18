# SwitchUI — Weekly Accomplishments (Jun 7–13)

## Features Shipped

- **Kanban Board Templates (#231–#235)** — End-to-end reusable board definitions with a 5-step creation wizard, raw-YAML editor, per-task `scheduled_at` for deferred dispatch, and "Save as template" flow.
- **shadcn Composer Cutover (#187/#190)** — Replaced the live composer with `ChatComposerShadcn` featuring auto-growing textarea, slash/@ autocomplete, image paste, reply-to quoting, message queue, context counter, and tool-display toggle; feature flag dropped after rollout.
- **Self-Improve Plugin Page (#206–#211)** — Full P0–P3 UI for `karpathy-self-improve`: capability-gated observability scorecard, proposal queue with approve/reject/propose, lifecycle stepper (Proposed→Approved→Applied→Verified), scenario checklist, pause/resume, and baseline chart.
- **Hermes Plugin Section + Config Sync (#228)** — Settings page now mirrors saved settings to the Hermes plugin endpoint with a status pill, compat banner, connection card, and self-healing re-registration when cached incompatible verdicts go stale.
- **Custom Slash Commands (#196)** — DB-backed command persistence in SwitchUI-owned SQLite, visible slash discovery in the composer, and cmdk-aligned facade usable without local-state tracking.
- **Session Management + Meta Bar** — CLI and A2A sessions surfaced as first-class chat sources with Delete support; per-session cost/token/api detail in the chat UI; meta bar redesigned to drop tok/api and add message/tool/skill counts.
- **Cron Run Sessions** — Cron jobs now name their run sessions, link cron history and session search to run IDs, send JSON on trigger, keep history and linked chats in sync, and show history even when run endpoints are unavailable.
- **Website / Docs (Starlight)** — Unified website docs with the Matrix shell; embedded flow-diagram rendering instead of downloads; self-contained embedded previews; Plugins docs section; dynamic version badge from GitHub releases.

## Fixes & Reliability

- **Chat Hot-Path Performance (#212–#226)** — Eliminated recurring "Too many re-renders" crashes via message-array identity stabilization, collapsed-head windowing for threads >80 entries, consolidated redundant pollers onto ≤3 module-level timers, gateway `AbortSignal.timeout(10s)`, 503 degraded flag, live-poll 800→1500ms, unified session-list invalidation, and AnimatePresence key deduping.
- **Chat Reliability Tracks 1 & 2** — Merged state-architecture overhaul with drain-watchdog escape hatch for SSE-desync stall, liveness-authoritative recovery with interrupted affordance, `runPhase` state machine, `selectIsComposerBusy` cutover, runPersistence adapter with queue→sessionStorage migration, and portable persistence via `X-Hermes-Session-Id` header.
- **Matrix3D + Console Fixes** — Crew activity rewired to per-profile DB ground truth; canvas remount churn stopped to preserve WebGL context; `kanbanFetch` timeout raised above worst-case auth flow.

## Refactors & Cleanup

- **shadcn/ui Migration (Phase 2)** — Migrated 9 Tooltip consumers, 19 Dialog consumers (render→asChild pattern), Command + slash menu to cmdk, and deleted the dead `alert-dialog.tsx` with zero consumers.
- **Plugin Compat Self-Heal (#229/#230)** — Frontend version now resolved via `__APP_VERSION__` define (require() unavailable in Vite SSR ESM runtime); re-registers when stale incompatible verdicts are detected.

## Releases

Twenty-one versions shipped from v2.3.27 (Jun 7) through v2.3.47 (Jun 13), averaging three releases per day.
