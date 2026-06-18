# SwitchUI — Weekly Digest (Jun 7–13)

## Shipped
- **Kanban Board Templates** — 5-step wizard, raw-YAML editor, deferred dispatch (`scheduled_at`), save-as-template flow (#231–#235)
- **shadcn Composer** — Auto-grow textarea, slash/@ autocomplete, image paste, reply-to quoting, message queue; feature flag dropped (#187/#190)
- **Self-Improve Plugin UI** — P0–P3 scorecard, proposal queue, lifecycle stepper, baseline chart (#206–#211)
- **Hermes Plugin Config Sync** — Settings ↔ Hermes endpoint, self-healing re-registration (#228 + #229/#230)
- **Custom Slash Commands** — DB-backed persistence, slash discovery, cmdk facade (#196)
- **Session Management** — CLI/A2A sessions as chat sources, Delete support, per-session cost/token/api detail
- **Cron Run Sessions** — Named sessions, linked history + session search, JSON triggers
- **Docs / Website** — Starlight unified docs, embedded flow diagrams, dynamic version badge
- **Chat Reliability** — Message-array identity stabilization, collapsed-head windowing, consolidated pollers, gateway timeout/503 handling, live-poll 800→1500ms, drain-watchdog + liveness recovery (#212–#226)
- **21 releases** v2.3.27 → v2.3.47 (~3/day)

## In-flight
- `feat/chat-queue` — 24 commits unmerged (message-queue composer)
- `feat/chat-delegations-approvals` — 4 commits + `fix/approvals-wired-to-real-store` (2 commits)
- `base-ui` → `shadcn` migration — **12 imports remaining** (~80% done)
- `use-model-suggestions` — disabled at `src/hooks/use-model-suggestions.ts:161`, infinite re-render
- Conductor token usage — hardcoded `'—'` at `src/server/conductor-store.ts:90`
- 5 single-commit fix branches ahead of main

## Next week
Theme: **consolidation before new surfaces**
- **P0** — Add regression tests for chat hot-path; merge 5 fix branches
- **P1** — Re-enable model-suggestions hook
- **P2** — Land chat-queue + delegations/approvals (or archive if scope shifted)
- **P3** — Finish remaining 12 base-ui → shadcn imports, drop `@base-ui-components`
- **P4** — End-to-end soak on Board Templates (instantiate → edit → dispatch)
- **P5** — Ship token-usage schema or remove conductor placeholder
