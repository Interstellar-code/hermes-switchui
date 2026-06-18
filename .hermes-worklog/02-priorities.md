# SwitchUI — Next-Week Priorities (week of Jun 14)

Grounded in 00-activity.md (128 commits, 21 releases) and 01-accomplishments.md,
plus a codebase audit of open TODO/FIXME markers, unmerged feature branches, and
shipped-but-inert code as of 2026-06-13.

## Ranked priorities

### P0 — Stabilize the chat hot-path before adding more to it
Last week shipped 15+ perf/reliability fixes (#212–#226, Tracks 1 & 2) under a
recurring "Too many re-renders" crash. The fix firefight was reactive; it needs
proactive coverage before more features pile onto the chat surface.

- Add regression tests for the message-array identity + collapsed-head windowing
  contract (#212/#213). These are the load-bearing pieces and have no tests.
- Stability soak: open the chat on a long thread (>80 messages), verify streaming
  smoothness across session switches, realtime-buffer clear (#218/#220), and
  AnimatePresence key dedup (#226).
- Close out the three single-commit fixes still sitting on branches:
  `fix/52-gateway-restart-banner`, `fix/53-sending-failsafe`,
  `fix/54-composer-query-invalidate`, `fix/composer-workspace-context`,
  `fix/auth-secure-cookie-lan-warning`. Each is 1 commit ahead of main — review
  and merge or reject.

### P1 — Re-enable the disabled model-suggestions hook
`useModelSuggestions` (`src/hooks/use-model-suggestions.ts:161`) is currently a
no-op returning nulls — it was disabled because it triggered an infinite
re-render loop ("Maximum update depth exceeded"). The hook is shipped code that
does nothing. Fix the dependency-array/memoization issue documented in the TODO
and re-enable; this is a user-visible feature regression hiding in plain sight.

### P2 — Land the in-flight chat-queue and chat-delegations work
Two feature branches have substantial unmerged progress:
- `feat/chat-queue` — 24 commits ahead of main. Message-queue composer sends
  while streaming. This is the engine behind the "queue while busy" UX already
  referenced in the shadcn composer cutover; reconcile with main and ship.
- `feat/chat-delegations-approvals` — 4 commits ahead, marked WIP. Surface the
  delegation + approval UI that the operations/conductor area expects.
  `fix/approvals-wired-to-real-store` (2 commits) is the companion wiring fix.

Decision needed: are these still the desired direction, or has scope shifted?
If yes, finish and merge; if no, archive the branches to reduce noise.

### P3 — Close the base-ui → shadcn migration (Phase 3)
Phase 2 migrated Tooltip, Dialog, and Command consumers, but **12 base-ui
imports remain** in `src/`. Until those are gone, the codebase carries two
overlapping UI primitives and the migration is only ~80% done. Finish the
remaining consumers, then remove `@base-ui-components` as a dependency.

### P4 — Validate Board Templates with real usage
Board Templates (#231–#235) shipped end-to-end this week (5-step wizard,
raw-YAML editor, per-task `scheduled_at`, "Save as template"). It's the newest
major surface and has had no real-user exercise. Run a full instantiate →
edit → re-save → dispatch cycle against a live Hermes kanban backend; the
`scheduled_at` deferred-dispatch path and the metrics-footer removal are the
highest-risk bits to verify.

### P5 — Surface token usage in the conductor view
`conductor-store.ts:90` has a standing TODO: `token_usage not yet in
workflow_runs schema`, with `tokens` hardcoded to `'—'`. Either ship the
schema field + read path, or remove the UI affordance so it stops displaying
a placeholder. Lower urgency than P0–P4 but a quick credibility win.

## Deferred / watch-only

- **Self-Improve plugin page (#206–#211)** shipped P0–P3 this week. No code
  TODOs; let it get real use before iterating.
- **Hermes Plugin Config Sync (#228)** + compat self-heal shipped. Monitor
  the 30s heartbeat registration; no action unless it misbehaves.
- **Matrix3D + console fixes** landed; the WebGL-context-preservation fix
  (#3ddce6c9) deserves an eye but isn't blocking.

## Rationale

The week's velocity was high (21 releases, 128 commits, 8 features) and
predominantly additive. The backlog signals a consistent theme: **ship-then-
stabilize cycles are accumulating inert code (disabled hooks, placeholder
fields, two UI-primitive layers) and unmerged branch debt (9 feat/fix branches
ahead of main).** Next week should lean toward consolidation — proving what
shipped, finishing what's started, and removing dead layers — before opening
new feature surfaces.
