# SwitchUI — Docs Freshness Context (7-day window)

- Generated: 2026-06-13 (task t_66897043)
- Window: `--since="7 days ago"` against repo at `/Volumes/Ext-nvme/Development/hermes-switchui`
- Method: read-only `git log --since` + `find` on docs tree. No writes to repo state.
- Author across window: Rohit Sharma. 111 non-merge commits total.

---

## 1. Feature / Fix / Perf commits (last 7 days, with files touched)

Excludes pure `chore: bump version`, `Release vX`, and docs-only commits (those are listed in §3 where relevant). Ordered newest-first. Scope tags grouped at the bottom.

### feat(kanban) — Board Templates suite
- `b5d6f4da` feat(kanban): 5-step template creation wizard (#231 follow-up) — 2026-06-12 16:07
  - src/lib/hermes-kanban-types.ts
  - src/screens/board-templates/board-templates-screen.tsx
  - src/styles/matrix-boards.css
- `bf41c98b` feat(kanban): template task runtime/turn fields + keep-status copy (#233) — 2026-06-12 15:00
  - src/lib/hermes-kanban-types.ts
  - src/screens/board-templates/board-templates-screen.tsx
  - src/screens/tasks/tasks-screen.tsx
- `01e0ed22` feat(kanban): Board Templates management page (#231) — 2026-06-12 13:47
  - src/lib/board-templates-api.ts
  - src/lib/hermes-kanban-types.ts
  - src/routeTree.gen.ts
  - src/routes/api/hermes-kanban/boards.$slug.save-as-template.ts
  - src/routes/api/hermes-kanban/templates.$slug.instantiate.ts
  - src/routes/api/hermes-kanban/templates.$slug.ts
  - src/routes/api/hermes-kanban/templates.ts
  - src/routes/board-templates.tsx
  - src/screens/board-templates/board-templates-screen.tsx
  - src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx
  - src/screens/tasks/tasks-screen.tsx
  - src/server/hermes-kanban-client.ts

### fix(plugin-sync) + feat(settings) — Hermes plugin config sync
- `86fd4b9d` fix(plugin-sync): re-register when cached incompatible verdict is stale — 2026-06-12 09:45
  - src/server/hermes-plugin-sync.test.ts
  - src/server/hermes-plugin-sync.ts
- `d0b678d3` fix(plugin-sync): resolve frontend version via __APP_VERSION__ define — 2026-06-12 09:08
  - src/server/hermes-plugin-sync.ts
- `fa283154` feat(settings): mirror saved settings to hermes plugin endpoint (P4, #228) — 2026-06-12 09:02
  - src/screens/settings/lib/saver.ts
- `2d8b39a2` feat(settings): Hermes plugin section + backend config-sync wiring (P1-P3, #228) — 2026-06-12 08:57
  - src/routeTree.gen.ts
  - src/routes/api/hermes-plugin.settings.ts
  - src/routes/api/hermes-plugin.ts
  - src/screens/settings/sections/section-hermes-plugin.tsx
  - src/screens/settings/settings-screen.tsx
  - src/server/gateway-capabilities.ts
  - src/server/hermes-plugin-sync.test.ts
  - src/server/hermes-plugin-sync.ts

### fix(chat) + perf(chat) — Reliability & performance cluster (Track 1/2)
- `a90f9ad7` fix(chat): contain AgentViewPanel re-render crash + dedupe AnimatePresence keys — 2026-06-12 01:25
  - src/components/agent-view/agent-view-panel.tsx
  - src/components/error-boundary.tsx
  - src/screens/chat/chat-screen.tsx
- `bccd7569` fix(chat): calm idle session pollers + crash-diagnostics error boundary — 2026-06-12 01:13
  - src/components/error-boundary.tsx
  - src/screens/chat/hooks/use-chat-sessions.ts
  - src/stores/chat-activity-store.ts
- `193d56fb` fix(chat): complete composer busy-state cutover (#219) — 2026-06-12 00:20
  - src/screens/chat/chat-screen.tsx
  - src/stores/chat-store.ts
- `8f1b671f` perf(chat): consolidate redundant pollers and timers (#214) — 2026-06-12 00:17
  - src/routes/api/session-status.ts
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/components/chat-message-list.tsx
  - src/screens/chat/components/message-item.tsx
  - src/screens/chat/hooks/use-shared-ticker.ts
  - src/server/hermes-api.ts
- `bb121c2a` perf(chat): chat-store hot-path hygiene (#221) — 2026-06-12 00:09
  - src/screens/chat/hooks/use-realtime-chat-history.ts
  - src/screens/chat/internal-message-filter.ts
  - src/stores/chat-store.test.ts
  - src/stores/chat-store.ts
- `53108a58` perf(chat): collapsed-head windowing for long threads (#213); fix stale-render gaps in areMessagesEqual (#222) — 2026-06-12 00:05
  - src/screens/chat/components/chat-message-list.test.tsx
  - src/screens/chat/components/chat-message-list.tsx
  - src/screens/chat/components/message-item.areMessagesEqual.test.ts
  - src/screens/chat/components/message-item.tsx
- `98f59056` fix(chat): unified session-list invalidation + deterministic realtime buffer cleanup (#218 #220) — 2026-06-11 23:49
  - src/routes/chat/$sessionKey.tsx
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/hooks/use-auto-session-title.ts
  - src/screens/chat/hooks/use-delete-session.ts
  - src/screens/chat/hooks/use-realtime-chat-history.ts
  - src/screens/chat/hooks/use-rename-session.ts
  - src/screens/chat/sessions-feed.ts
- `3d039971` perf(chat): stabilize message-array identity during streaming + single rAF smoother (#212); gateway timeouts, 503 on history failure, live-poll 800→1500ms, focus-refetch stream guard (#215 #216 #217) — 2026-06-11 23:40
  - src/routes/api/history.ts
  - src/routes/api/send-stream.ts
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/hooks/use-chat-history.ts
  - src/screens/chat/hooks/use-streaming-message.ts
  - src/server/hermes-api.ts
- `be02c656` feat(chat): preserve formatting on paste + table copy button — 2026-06-11 22:12
  - package.json
  - pnpm-lock.yaml
  - src/components/prompt-kit/markdown.tsx
  - src/lib/clipboard.ts
  - src/lib/html-to-markdown.ts
  - src/screens/chat/components/chat-composer-shadcn.tsx
  - src/screens/chat/components/message-item.tsx
  - src/types/turndown-plugin-gfm.d.ts

### feat(self-improve) — P0–P3 self-improving agent scorecard
- `23e4c0e9` feat(self-improve): narrative UX redesign — single scope, hero diff, stepper (#210) — 2026-06-11 20:37
  - docs/plans/self-improve-ux-redesign-210.md
  - src/screens/self-improve/components/experiment-card.tsx
  - src/screens/self-improve/components/info-tooltip.tsx
  - src/screens/self-improve/components/lifecycle-stepper.tsx
  - src/screens/self-improve/components/profile-scope-select.tsx
  - src/screens/self-improve/components/scenario-checklist.tsx
  - src/screens/self-improve/components/score-context.tsx
  - src/screens/self-improve/self-improve-screen.css
  - src/screens/self-improve/self-improve-screen.tsx
- `eed99e3f` fix(self-improve): source profile selectors from real agent profiles — 2026-06-11 10:56
  - src/hooks/use-agent-profiles.ts
  - src/screens/self-improve/self-improve-screen.tsx
- `8c72e247` fix(self-improve): avoid double-parens in single-profile Propose label — 2026-06-11 10:39
  - src/screens/self-improve/self-improve-screen.tsx
- `bf291835` feat(self-improve): P3 scenarios, pause/resume, baseline chart — 2026-06-11 10:09
  - src/lib/self-improve-api.ts
  - src/lib/self-improve-types.ts
  - src/routeTree.gen.ts
  - src/routes/api/self-improve/-scenarios.test.ts
  - src/routes/api/self-improve/profiles.$profile.pause.ts
  - src/routes/api/self-improve/profiles.$profile.resume.ts
  - src/routes/api/self-improve/scenarios.$id.ts
  - src/routes/api/self-improve/scenarios.ts
  - src/screens/self-improve/components/baseline-chart.tsx
  - src/screens/self-improve/self-improve-screen.css
  - src/screens/self-improve/self-improve-screen.tsx
  - src/server/self-improve-client.test.ts
  - src/server/self-improve-client.ts
- `232c70b6` feat(self-improve): P2 lifecycle apply/verify/revert + history drawer — 2026-06-11 09:55
  - src/lib/self-improve-api.ts
  - src/routeTree.gen.ts
  - src/routes/api/self-improve/-experiments.test.ts
  - src/routes/api/self-improve/experiments.$id.apply.ts
  - src/routes/api/self-improve/experiments.$id.revert.ts
  - src/routes/api/self-improve/experiments.$id.verify.ts
  - src/screens/self-improve/components/history-drawer.tsx
  - src/screens/self-improve/self-improve-screen.css
  - src/screens/self-improve/self-improve-screen.tsx
  - src/server/self-improve-client.test.ts
  - src/server/self-improve-client.ts
- `a701ce66` feat(self-improve): P1 proposal queue with approve/reject/propose — 2026-06-11 09:45
  - src/lib/self-improve-api.ts
  - src/lib/self-improve-types.ts
  - src/routeTree.gen.ts
  - src/routes/api/self-improve/-experiments.test.ts
  - src/routes/api/self-improve/experiments.$id.approve.ts
  - src/routes/api/self-improve/experiments.$id.history.ts
  - src/routes/api/self-improve/experiments.$id.reject.ts
  - src/routes/api/self-improve/experiments.$id.ts
  - src/routes/api/self-improve/experiments.ts
  - src/routes/api/self-improve/propose.ts
  - src/screens/self-improve/components/diff-view.tsx
  - src/screens/self-improve/components/eval-table.tsx
  - src/screens/self-improve/self-improve-screen.css
  - src/screens/self-improve/self-improve-screen.tsx
  - src/server/self-improve-client.test.ts
  - src/server/self-improve-client.ts
- `2c17cea0` feat(self-improve): P0 capability-gated observability scorecard — 2026-06-11 09:26
  - src/components/mobile-hamburger-menu.tsx
  - src/components/mobile-tab-bar.tsx
  - src/hooks/use-self-improve-available.ts
  - src/lib/self-improve-api.ts
  - src/lib/self-improve-types.ts
  - src/routeTree.gen.ts
  - src/routes/api/self-improve/baselines.ts
  - src/routes/api/self-improve/health.ts
  - src/routes/api/self-improve/metrics.latest.ts
  - src/routes/api/self-improve/metrics.ts
  - src/routes/self-improve.tsx
  - src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx
  - src/screens/self-improve/self-improve-screen.css
  - src/screens/self-improve/self-improve-screen.tsx
  - src/server/self-improve-client.test.ts
  - src/server/self-improve-client.ts

### misc chat fixes (sidebar, matrix3d, sessions)
- `412800e7` fix(sidebar): resumed sessions jump to Today on send — 2026-06-11 01:09
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/sessions-feed.ts
- `c1b1f8ef` feat(website): fetch version badge dynamically from GitHub releases — 2026-06-11 01:01
  - website/src/components/HeroRain.astro
  - website/src/components/TopNav.astro
  - website/src/pages/index.astro
- `3ddce6c9` fix(matrix3d): stop canvas remount churn that loses WebGL context — 2026-06-11 00:01
  - src/features/retro-office/RetroOffice3D.tsx
- `146e6228` fix(kanban): raise kanbanFetch timeout above worst-case auth flow — 2026-06-11 00:01
  - src/server/hermes-kanban-client.ts
- `8d4888fc` fix(matrix3d): rewire crew activity to per-profile DB ground truth — 2026-06-10 23:33
  - src/lib/crew-delegation.test.ts
  - src/lib/crew-delegation.ts
  - src/lib/workspace-agents.ts
  - src/routes/api/crew-status.ts
  - src/screens/matrix3d/use-matrix3d-office-data.test.ts
  - src/screens/matrix3d/use-matrix3d-office-data.ts

### feat(chat) — session sources & meta bar (06-09 cluster)
- `7d40f191` fix(chat): keep Task sessions in the Task chip (precedence over cli/a2a) — 2026-06-09 22:39
  - src/screens/chat/sessions-feed.test.ts
  - src/screens/chat/sessions-feed.ts
- `24d32aaf` fix(chat): enable Delete for Telegram, CLI, and A2A sessions — 2026-06-09 22:31
  - src/screens/chat/components/sidebar/v2/sidebar-card-context-menu-v2.tsx
- `0666fe23` feat(chat): surface CLI and A2A sessions as first-class sources — 2026-06-09 22:21
  - src/screens/chat/components/sidebar/v2/sidebar-card-v2.tsx
  - src/screens/chat/components/sidebar/v2/sidebar-source-chips-v2.tsx
  - src/screens/chat/sessions-feed-types.ts
  - src/screens/chat/sessions-feed.test.ts
  - src/screens/chat/sessions-feed.ts
- `2065db32` fix(update): only offer update when local is behind remote — 2026-06-09 21:56
  - src/server/update-system.test.ts
  - src/server/update-system.ts
- `3b583fd0` fix(dashboard): silence recharts width(-1)/height(-1) warning — 2026-06-09 21:33
  - src/screens/dashboard/components/analytics-chart-card.tsx
- `8ebf6746` fix(chat): make Telegram sessions clickable in V2 sidebar — 2026-06-09 21:33
  - src/screens/chat/components/sidebar/v2/sidebar-card-v2.tsx
- `9704f489` fix(docs): render embedded flow diagrams instead of downloading them — 2026-06-09 20:13
  - src/routes/api/-docs-asset.test.ts
  - src/routes/api/docs-asset.ts
  - src/server/docs-render.test.ts
  - src/server/docs-render.ts
- `74bb80fc` fix(gateway): find hermes binary and honor custom gateway port — 2026-06-09 20:00
  - src/server/claude-agent.ts
- `d0d12280` fix(website): auto-derive displayed version from package.json — 2026-06-09 18:27
  - package.json
  - website/src/components/HeroRain.astro
  - website/src/components/TopNav.astro
  - website/src/pages/index.astro
  - website/src/site-version.ts
- `8fdd1f26` fix(build): skip build:website when website/ absent (unblocks Docker image) — 2026-06-09 15:53
  - package.json
- `f0321e03` feat(chat): drop tok/api from meta bar, add message/tool/skill counts to source tabs — 2026-06-09 15:38
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/components/v2/chat-header-v2.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.test.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.tsx
  - src/screens/chat/components/v2/chat-skills-tab-v2.tsx
  - src/screens/chat/components/v2/chat-source-tabs-v2.tsx
- `de844470` fix(chat): sidebar delete refresh + telegram session classification — 2026-06-09 15:38
  - src/routes/api/sessions.ts
  - src/screens/chat/components/sidebar/v2/sidebar-source-chips-v2.tsx
  - src/screens/chat/hooks/use-delete-session.ts
  - src/screens/chat/sessions-feed.ts
  - src/screens/chat/types.ts
  - src/screens/chat/utils.ts
  - src/server/hermes-api.ts
- `e8191cb8` feat(chat): strip live/profile/tools from meta bar, surface tok + api — 2026-06-09 10:30
  - src/screens/chat/components/v2/chat-meta-bar-v2.test.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.tsx
- `162aa3f4` feat(chat): surface per-session cost + token/api detail in chat UI — 2026-06-09 10:17
  - src/hooks/use-session-status.ts
  - src/lib/format.ts
  - src/routes/api/session-status.ts
  - src/screens/chat/components/v2/chat-header-v2.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.test.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.tsx
  - src/screens/dashboard/components/cost-ledger-card.tsx
  - src/server/hermes-api.ts
- `2e61ad51` feat(chat): client-side slash commands (/reset /stop /title /reasoning) — 2026-06-09 09:56
  - src/components/slash-command-menu.tsx
  - src/screens/chat/chat-screen-utils.ts
  - src/screens/chat/chat-screen.tsx
- `d4d3e069` fix(chat): restore tok/s + tools fields in meta bar, fix react-query test mock — 2026-06-09 09:45
  - src/screens/chat/components/v2/chat-meta-bar-v2.test.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.tsx
- `b98e6227` fix(chat): add missing Button import for interrupted affordance — 2026-06-09 00:17
  - src/screens/chat/chat-screen.tsx
- `484b33a1` feat(ui): Matrix-themed tabs for slash command picker + inline menu — 2026-06-08 23:57
  - src/components/slash-command-menu.test.tsx
  - src/components/slash-command-menu.tsx
- `87baecd2` fix(ui): use dark Shiki theme when Matrix theme is active — 2026-06-08 23:38
  - src/components/prompt-kit/code-block/index.tsx
- `edff7d0a` fix(update): allow update when only package.json version is dirty — 2026-06-08 22:20
  - src/server/update-system.test.ts
  - src/server/update-system.ts
- `3ef535a8` fix(chat): move handleResendInterrupted after 'send' to fix TDZ error — 2026-06-08 16:02
  - src/screens/chat/chat-screen.tsx

### feat(chat) — Track 2 chat-state architecture
- `448b5c05` feat(chat): runPersistence adapter + queue→sessionStorage migration (Track 2 / Phase 2.3) — 2026-06-08 14:59
  - src/stores/chat-store.ts
  - src/stores/run-persistence.test.ts
  - src/stores/run-persistence.ts
- `a7ec39b6` feat(chat): selectIsComposerBusy cutover (Track 2 / Phase 2.2) — 2026-06-08 14:50
  - src/screens/chat/chat-screen.tsx
  - src/stores/chat-store.test.ts
  - src/stores/chat-store.ts
- `a30403a8` feat(chat): runPhase state machine (Track 2 / Phase 2.1) — 2026-06-08 14:45
  - .omc/plans/unify-chat-state-architecture.md
  - src/stores/chat-store.test.ts
  - src/stores/chat-store.ts
  - src/stores/run-phase.test.ts
  - src/stores/run-phase.ts
- `cea955b1` fix(chat): liveness-authoritative recovery with interrupted affordance (Track 1.2) — 2026-06-08 12:53
  - src/screens/chat/chat-screen-utils.test.ts
  - src/screens/chat/chat-screen-utils.ts
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/hooks/use-active-run-check.test.ts
  - src/screens/chat/hooks/use-active-run-check.ts
  - src/stores/chat-store.test.ts
  - src/stores/chat-store.ts
- `192abff3` fix(chat): send X-Hermes-Session-Id for portable persistence (STEP 0) — 2026-06-08 12:37
  - src/lib/send-stream-session-headers.ts
  - src/routes/api/send-stream.ts
  - src/server/chat-backends.ts
  - src/server/hermes-api.ts
  - src/server/hermes-chat-session-key.test.ts
  - src/server/openai-compat-api.ts
  - src/server/responses-api.ts
- `6b3bf9ea` fix(chat): drain-watchdog escape hatch for SSE-desync stall (Track 1.1) — 2026-06-08 12:37
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/hooks/use-drain-watchdog.test.ts
  - src/screens/chat/hooks/use-drain-watchdog.ts
- `0ccd2547` fix: wrap agent-card Tooltip in TooltipProvider — 2026-06-08 11:52
  - src/components/agent-view/agent-card.tsx

### feat(ui) — shadcn adoption + composer cutover
- `a28cbf8a` feat(ui): migrate 19 base-ui Dialog consumers to shadcn (Phase 2 #2) — 2026-06-07 21:11
  - src/components/agent-chat/AgentChatModal.tsx
  - src/components/agent-view/guardrails-modal.tsx
  - src/components/agent-view/kill-confirm-dialog.tsx
  - src/components/agent-view/steer-modal.tsx
  - src/components/file-explorer/file-explorer-sidebar.tsx
  - src/components/file-explorer/file-preview-dialog.tsx
  - src/components/settings-dialog/settings-dialog.tsx
  - src/components/usage-meter/context-alert-modal.tsx
  - src/components/usage-meter/usage-details-modal.tsx
  - src/components/usage-meter/usage-meter.tsx
  - src/screens/chat/components/message-item.tsx
  - src/screens/chat/components/providers-dialog.tsx
  - src/screens/files/files-screen.tsx
  - src/screens/mcp/components/install-confirmation-dialog.tsx
  - src/screens/mcp/components/mcp-server-dialog.tsx
  - src/screens/mcp/components/sources-manager-dialog.tsx
  - src/screens/profiles/profiles-screen.tsx
  - src/screens/settings/components/provider-wizard.tsx
  - src/screens/tasks/task-dialog.tsx
- `85adf210` feat(ui): migrate 9 base-ui Tooltip consumers to shadcn (Phase 2 #1) — 2026-06-07 21:06
  - src/components/agent-avatar.tsx
  - src/components/agent-view/agent-card.tsx
  - src/components/chat-panel-toggle.tsx
  - src/components/chat-panel.tsx
  - src/components/export-menu.tsx
  - src/components/orchestrator-avatar.tsx
  - src/components/prompt-kit/message.tsx
  - src/components/prompt-kit/prompt-input.tsx
  - src/screens/chat/components/message-actions-bar.tsx
- `d16643f9` feat(chat): shadcn composer live cutover at /chat (#187) (#190) — 2026-06-07 20:50
  - .claude/scheduled_tasks.lock
  - .serena/.gitignore
  - .serena/project.yml
  - CHANGELOG.md
  - package.json
  - pnpm-lock.yaml
  - src/components/shadcn/ui/command.tsx
  - src/components/shadcn/ui/dialog.tsx
  - src/components/shadcn/ui/input.tsx
  - src/components/shadcn/ui/popover.tsx
  - src/components/shadcn/ui/textarea.tsx
  - src/components/shadcn/ui/tooltip.tsx
  - src/screens/chat/chat-screen-utils.test.ts
  - src/screens/chat/chat-screen-utils.ts
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/components/chat-composer-shadcn.tsx
  - src/screens/chat/components/chat-composer.tsx
  - src/screens/chat/components/chat-message-list.test.tsx
  - src/screens/chat/components/chat-message-list.tsx
  - src/screens/chat/components/message-actions-bar.tsx
  - src/screens/chat/components/message-item.tsx
  - src/screens/chat/components/v2/chat-meta-bar-v2.tsx
  - src/screens/chat/components/v2/session-selectors-v2.tsx
  - src/stores/chat-store.test.ts
  - src/stores/chat-store.ts
  - website/package-lock.json

### feat(commands) — custom slash commands (06-07, non-conventional messages)
These commits use plain imperative messages (no `feat:` prefix); they add a feature (SwitchUI-owned SQLite command store + composer slash menu), so they're listed here for completeness.
- `a9fa2c4c` Persist custom chat commands in SwitchUI-owned SQLite storage — 2026-06-07 22:16
  - src/components/command-palette.tsx
  - src/components/mobile-hamburger-menu.tsx
  - src/components/mobile-tab-bar.tsx
  - src/components/slash-command-menu.tsx
  - src/lib/commands-api.test.ts
  - src/lib/commands-api.ts
  - src/routeTree.gen.ts
  - src/routes/api/commands.$id.ts
  - src/routes/api/commands.ts
  - src/routes/commands.tsx
  - src/screens/chat/chat-screen.tsx
  - src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx
  - src/screens/commands/commands-screen.tsx
  - src/server/commands-store.test.ts
  - src/server/commands-store.ts
  - src/server/switchui-db.ts
- `7d4e32fb` Dock the shadcn composer on mobile — 2026-06-08 09:27
  - src/screens/chat/components/chat-composer-shadcn-mobile.test.ts
  - src/screens/chat/components/chat-composer-shadcn.tsx

### Version bumps / releases (chore, excluded from feature list — for context)
- `22a7b29a` chore: bump version to 2.3.47 + changelog — 2026-06-13 13:06
- `5c5e6c86` chore: bump version to 2.3.46 + changelog — 2026-06-12 16:20
- `aa6c13de` chore: bump version to 2.3.45 + changelog — 2026-06-12 13:59
- `5053ce5d` chore: bump version to 2.3.44 + changelog — 2026-06-12 09:58
- `fb5668bd` Release v2.3.43 — dynamic version badge + sidebar last-activity ordering — 2026-06-11 08:46
- `4c8611c6` Release v2.3.42 — Matrix3D activity sync + WebGL/kanban console fixes — 2026-06-11 00:48
- `9a8a478f` Release v2.3.41 — expose Plugins docs on the Starlight site — 2026-06-10 17:42
- `745dab0d` Release v2.3.40 — docs plugins section + website version fix — 2026-06-10 13:33
- `caeebf43` Release v2.3.39 — 2026-06-10 11:13
- `c84fd719` chore: bump version to 2.3.34 + changelog — 2026-06-09 22:41
- `402c91d7` chore: bump version to 2.3.33 + changelog — 2026-06-09 22:31
- `9c102e5e` ci(docker): free runner disk before buildx to avoid ResourceExhausted — 2026-06-09 22:31
- `28c7e6fe` chore(chat): remove tap-debug mount console noise — 2026-06-09 22:31
- `bf99123e` chore: bump version to 2.3.32 + changelog — 2026-06-09 22:00
- `210bc791` chore: bump version to 2.3.31 + changelog — 2026-06-09 21:21
- `6da61d46` test(mcp): repair marketplace dialog tests after shadcn migration — 2026-06-09 20:13
- `2f43ff30` chore: bump version to 2.3.30 + changelog — 2026-06-09 20:00
- `789a8ec2` chore: bump version to 2.3.29 + changelog — 2026-06-09 15:45
- `73e13f0e` chore: bump version to 2.3.28 + changelog — 2026-06-08 22:02

### Docs-only commits (included here because they affect docs freshness directly)
- `3096d6ec` docs(self-improve): add self-improving agent assessment & proposal — 2026-06-11 13:25
- `dd6e7cf7` docs: mark Track 2 (storage consolidation) as shipped — 2026-06-08 15:02
- `febc2705` test(chat): parity truth table for isChatRuntimeBusy (Track 2 / Phase 2.2) — 2026-06-08 15:01
- `e55c9d25` docs: mark Phase 1.2 as done (was in-progress in status table) — 2026-06-08 14:29
- `a013d350` docs: mark Track 1 (reliability) as shipped — 2026-06-08 12:56
- `8f57e97d` docs: STEP 0 complete — portable persistence endpoint not needed — 2026-06-08 12:08
- `22e9f5e0` Record completed shadcn adoption state — 2026-06-08 09:08
- `23801e80` Stop stale chat activity indicators — 2026-06-08 09:00
- `e66e6bcf` Remove the dead chat composer boundary — 2026-06-08 08:54
- `67094c77` Mirror MCP drawer interactions for command management — 2026-06-08 07:10
- `2b0709dd` Align command management with the MCP workspace — 2026-06-08 06:36
- `9f4bea4e` Prevent companion services from triggering duplicate-start failures — 2026-06-08 06:00
- `b6f8e6f0` Prevent stale chat activity from self-locking the queue — 2026-06-07 23:52
- `e4728840` Make command macros usable from composer without tracking local state — -management — 2026-06-07 23:27
- `77227612` Add visible slash command discovery to the chat composer — 2026-06-07 23:25
- `ed3d620a` Align command surfaces on cmdk before slash-menu cutover — 2026-06-07 21:31
- `6d51ce51` chore(ui): delete dead src/components/ui/alert-dialog.tsx — 2026-06-07 21:13
- Website/docs sync (06-09/10, plain messages): `127dec29`, `09a06bb5`, `abc196ba`, `3b5853a7`, `fb85cb8d`, `e6833b52`, `79d63e4f`, `d17852c4`, `cb470866`, `fa137e96`, `88ec1d64`, `6732cb01`, `64fea353`, `d17852c4`

### Scope tags (quick filter)

- **kanban**: board templates page + 5-step wizard + runtime/turn fields (#231, #233)
- **settings/plugin-sync**: Hermes plugin section + backend config-sync wiring (#228)
- **chat/perf**: poller consolidation, message-array identity, windowing, session-list invalidation, busy-state cutover (Track 1/2 reliability, #212–222)
- **self-improve**: P0–P3 capability-gated scorecard + lifecycle apply/verify/revert + scenarios + narrative UX redesign (#210)
- **chat/features**: CLI/A2A session sources, per-session cost meta bar, client-side slash commands, paste-format preservation
- **ui/shadcn**: composer cutover, Dialog+Tooltip migration, Matrix-themed command picker
- **commands**: SwitchUI-owned SQLite command store, composer slash menu, macros
- **matrix3d**: crew activity DB sync, WebGL context churn
- **website**: dynamic version badge, docs plugins section, doc prefix/navigation

---

## 2. Full current docs tree

Source: `find . -path ./node_modules -prune -o \( -name "README*" -o -name "*.md" -o -name "*.mdx" \) -print`, sorted. Excludes node_modules. Includes root-level, `docs/`, `.omc/` (plans/releases/specs), `.omx/`, website, and various tool-generated trees (.claude worktrees, .serena, assets/personas, graphify-out, skills).

### Repo-root docs
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- CONTRIBUTING.md
- FEATURES-INVENTORY.md
- FUTURE-FEATURES.md
- README.md
- SECURITY.md

### docs/ (user-facing documentation site + plans)
docs/
- welcome.md
- _rebrand-flags.md
- _screenshot-index.md
- _shared-terms.md
- demo-checklist.md
- faq.md
- self-improving-agent-proposal.md
- Deployment: deployment/unraid.md
- Getting started: getting-started/{authoring-docs.md, connecting-provider.md, first-chat.md, install.md, theme.md}
- Help: help/docs.md
- How-to: how-to/{connect-hermes-to-telegram-and-configure-topics.md, use-the-manifest-provider-to-reduce-llm-costs.md}
- Knowledge: knowledge/memory.md
- Main (feature pages): main/{boards.md, chat.md, conductor.md, dashboard.md, files.md, jobs.md, matrix3d.md, operations.md, tasks.md, terminal.md, workflows.md}
  - chat/: {composer.md, context-window.md, files.md, sessions.md, shortcuts.md, slash-commands.md}
  - workflows/: {editing.md, output.md, overview.md, running.md}
- Plans: plans/{archon-engine-db-schema.md, archon-engine-research.md, archon-hermes-integration.md, archon-plan-codex-review.md, archon-workflows-research.md, boards-page-plan.md, central-agent-project-model.md, conductor-cleanout.md, conductor-ui-implementation.md, docs-page-port.md, matrix3d-page.md, matrix3d-phase3-orchestration.md, operations-cleanout.md, operations-ui-implementation.md, persona-driven-agent-system.md, self-improve-ux-redesign-210.md, specs/ (archon-A.0-stubs, archon-A.1-a-executor, archon-A.1-b-schemas-validation, archon-A.1-c-wiring, archon-A.1.1-engine-store, archon-A.3-kanban-dispatcher, archon-A.7-subgraphs, archon-A.8-phase-wrapper), switch-coding-capability-analysis.md, unified-kanban-task-system.md, workflow-db-single-source-of-truth.md, workflow-hermes-plugin.md, workflow-kanban-contract.md, workspace-rebrand-audit.md}
- Plugins: plugins/{a2a-fleet.md, lazy-load-mcp.md, matrix-coder.md, overview.md, workflow-engine.md}
- Settings: settings/{mcp.md, preferences.md, profiles.md, sidebar.md, skills.md, themes.md, workflows-backend-toggle.md}
  - mcp/: {connecting.md, installing.md}
  - providers/: {api-keys.md, built-in.md, custom-endpoint.md, switching-models.md}
  - skills/: {building-skill.md, installing-skill.md, what-are-skills.md}
- Specs: specs/{tables-hermes-plugin-draft.md, tables-switchui-spec.md}
- Tips: tips/{composer-tricks.md, search.md, shortcuts.md}
- Troubleshooting: troubleshooting/{agent-connect.md, crash-recovery.md, models.md, sessions.md, telegram.md}
- Design Assets: "Design Assets/Hermes-Switchui/uploads/persona-driven-agent-system.md"

### .omc/ (internal plans, releases, specs)
.omc/
- RELEASE_RULE.md
- v1-audit.md
- plans/: {conductor-cleanout.md, hermes-dep-post-messages-endpoint.md, hermes-plugin-section-228.md, kanban-template-suite.md, legacy-tasks-cleanup.md, matrix3d-sync-fix.md, open-questions.md, operations-cleanout.md, phase2-batch-1-3.md, sessions-sidebar-phase1-audit.md, sessions-sidebar-phase3a-callers.md, sessions-sidebar.md, shadcn-adoption.md, swarm-removal.md, unify-chat-state-architecture.md, workflow-plugin-refactor.md, workflows-audit-map.md, workflows-audit-review.md, workflows-audit-verify.md}
- releases/: {v2.3.28.md … v2.3.34.md (gap v2.3.35–v2.3.43), v2.3.44.md, v2.3.45.md, v2.3.46.md, v2.3.47.md}
- specs/: {board-templates/{SPEC.md, WIZARD.md}, workflow-plugin-cutover/{README.md, phase-0-gateway-cancel.md, phase-1-plugin-client-audit.md, phase-2-default-plugin.md, phase-3-delete-native.md}}

### .omx/ (secondary tool-generated plans/state)
.omx/
- notepad.md
- plans/: {commands-backend-sidebar-delta.md}
- state/sessions/omx-1777718517156-lrdx1l/AGENTS.md

### website/
- website/README.md
- website/CHANGELOG.md

### Other tool/asset trees (docs that exist but are NOT user-facing)
- .claude/worktrees/agent-a2e0df1107521c40d/AGENTS.md
- .hermes-audit/{00-context.md, 01-commits.md, 02-changelog.md, 03-docs.md, 04-issues.md, 05-summary.md}
- .hermes/A2A.md
- .serena/memories/{memory_maintenance.md, verification-preferences.md}
- assets/personas/curated/ (16 persona .md files: design-system-curator, design-ux-architect, devops-automator, devops-incident-response-commander, engineering-backend-architect, engineering-code-reviewer, engineering-security-engineer, engineering-software-architect, product-senior-project-manager, product-sprint-prioritizer, research-data-scientist, research-researcher, testing-qa-engineer, testing-test-strategist, writing-doc-curator, writing-technical-writer)
- graphify-out/GRAPH_REPORT.md
- skills/workspace-dispatch/SKILL.md
- src/server/__fixtures__/personas/engineering/{code-reviewer.md, software-architect.md}

---

## 3. Docs freshness — touched vs untouched in the 7-day window

Method: `git log --since="7 days ago" --name-only` filtered to `*.md/*.mdx/README`.

### 3a. DOCS TOUCHED in last 7 days (22 files)

CHANGELOG.md
.omc/plans/hermes-dep-post-messages-endpoint.md
.omc/plans/open-questions.md
.omc/plans/shadcn-adoption.md
.omc/plans/unify-chat-state-architecture.md
.omc/releases/v2.3.28.md
.omc/releases/v2.3.29.md
.omc/releases/v2.3.44.md
docs/deployment/unraid.md
docs/getting-started/authoring-docs.md
docs/getting-started/connecting-provider.md
docs/how-to/connect-hermes-to-telegram-and-configure-topics.md
docs/how-to/use-the-manifest-provider-to-reduce-llm-costs.md
docs/plans/self-improve-ux-redesign-210.md
docs/plugins/a2a-fleet.md
docs/plugins/lazy-load-mcp.md
docs/plugins/matrix-coder.md
docs/plugins/overview.md
docs/plugins/workflow-engine.md
docs/self-improving-agent-proposal.md
docs/settings/workflows-backend-toggle.md
docs/troubleshooting/agent-connect.md
docs/troubleshooting/telegram.md

### 3b. DOCS NOT TOUCHED in last 7 days

The remainder of the docs tree from §2, including (high-signal subset, likely freshness gaps given this week's code activity):

**Root:** AGENTS.md, CLAUDE.md, CONTRIBUTING.md, FEATURES-INVENTORY.md, FUTURE-FEATURES.md, README.md, SECURITY.md

**docs/ user-facing feature pages — NOT updated despite related code shipping:**
- docs/main/chat.md — no touch, but `chat` scope had ~30 commits this week (session sources, meta bar, slash commands, reliability, paste-format, windowing).
- docs/main/chat/composer.md, docs/main/chat/slash-commands.md, docs/main/chat/sessions.md — composer cutover + slash command feature shipped; docs untouched.
- docs/main/chat/context-window.md, docs/main/chat/files.md, docs/main/chat/shortcuts.md — untouched.
- docs/main/boards.md / docs/main/tasks.md — Board Templates feature shipped (#231, #233) with new `/board-templates` route and wizard; docs/main/boards.md NOT touched. (A `.omc/specs/board-templates/SPEC.md` + `WIZARD.md` exist under .omc, but the user-facing docs/main/boards.md was not updated.)
- docs/main/matrix3d.md — crew activity rewired to per-profile DB + WebGL fix shipped; docs/main/matrix3d.md NOT touched.
- docs/main/jobs.md — cron run session-naming + history linking shipped (06-10 cluster); docs/main/jobs.md NOT touched.
- docs/settings/preferences.md, docs/settings/sidebar.md — settings section rework (#228, Hermes plugin section) shipped; docs/settings/preferences.md NOT touched. (A new `docs/settings/workflows-backend-toggle.md` was touched, but the broader settings doc surface wasn't.)
- docs/settings/skills/* — untouched.
- docs/welcome.md, docs/faq.md, docs/demo-checklist.md — untouched.

**docs/plans/ — mostly untouched** (archon-*, conductor-*, matrix3d-*, operations-*, persona-driven-*, workflow-*). Note: `docs/plans/self-improve-ux-redesign-210.md` WAS touched; the other self-improve plan `docs/self-improving-agent-proposal.md` was also touched. The remaining ~25 plan files under docs/plans/ were not modified this week.

**.omc/plans/ — mostly untouched** (19 of 20 files). Touched this week: `hermes-dep-post-messages-endpoint.md`, `open-questions.md`, `shadcn-adoption.md`, `unify-chat-state-architecture.md`. Untouched: conductor-cleanout, hermes-plugin-section-228, kanban-template-suite, legacy-tasks-cleanup, matrix3d-sync-fix, operations-cleanout, phase2-batch-1-3, sessions-sidebar-*, swarm-removal, workflow-plugin-refactor, workflows-audit-*.

**.omc/releases/ — gap v2.3.35–v2.3.43**: release notes exist for v2.3.28–v2.3.34 and v2.3.44–v2.3.47, but there are NO release-note files for v2.3.35 through v2.3.43 (9 versions). The `Release vX` commits for those versions exist in git, but the per-version `.omc/releases/*.md` files were never created. Either they were skipped or the release-notes generation step was bypassed for that range.

**Other:** website/CHANGELOG.md and website/README.md not touched this week (website changes were code/.astro/.ts, not docs).

---

## 4. Headline observations (for downstream freshness workers)

1. **Board Templates (#231, #233) is the largest unreconciled docs gap.** Full feature shipped (management page, 5-step wizard, runtime/turn fields, save-as-template + instantiate API routes, nav entry) but `docs/main/boards.md` and `docs/main/tasks.md` were not updated. The spec lives only under `.omc/specs/board-templates/`.

2. **Self-Improve feature shipped P0–P3 + narrative redesign (#210) with no user-facing docs page.** All code under `src/screens/self-improve/` and `src/routes/api/self-improve/`; plan docs touched (`docs/plans/self-improve-ux-redesign-210.md`, `docs/self-improving-agent-proposal.md`) but there is no `docs/main/self-improve.md` or equivalent feature page. The `/self-improve` route was added to primary-nav-v2 but isn't represented in the docs site tree.

3. **Chat reliability/perf work (Track 1/2, #212–222) is documented only in `.omc/plans/unify-chat-state-architecture.md`.** No user-facing docs reflect the new composer busy-state, drain-watchdog, or session persistence behavior. `docs/main/chat/composer.md` and `docs/main/chat/sessions.md` are stale relative to the cutover.

4. **Settings Hermes-plugin section (#228) shipped without updating `docs/settings/preferences.md`.** The new `section-hermes-plugin.tsx` and config-sync wiring are live; the settings doc page wasn't touched.

5. **Session sources feature (CLI/A2A/Telegram as first-class sources) shipped; `docs/main/chat/sessions.md` not updated.** Telegram troubleshooting page WAS updated, but the sessions feature page wasn't.

6. **`.omc/releases/` has a 9-version gap (v2.3.35–v2.3.43).** Release commits exist; release-note markdown files don't. Worth confirming whether this is intentional or a process slip.

7. **Website docs were synced for plugins (06-10) but not for the subsequent kanban/self-improve/settings work.** The `docs/plugins/*` pages are current as of v2.3.40; everything shipped after (v2.3.41–v2.3.47) has no corresponding docs update.
