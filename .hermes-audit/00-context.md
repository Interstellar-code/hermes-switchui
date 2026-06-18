# 00-context.md — Weekly Audit Context

_Generated: 2026-06-13 by kanban collector (t_82f80ec2)_
_Window: last 7 days_

## REPO

- Path: `/Volumes/Ext-nvme/Development/hermes-switchui`
- GitHub: `https://github.com/Interstellar-code/hermes-switchui` (owner/name: `Interstellar-code/hermes-switchui`)
- origin remote: `https://github.com/Interstellar-code/hermes-switchui.git`
- Branch: `main`
- HEAD sha: `5c5e6c86623c6c66d948779118e19dd91b3eb2c4`

## COMMITS (last 7d, with stat)

```
5c5e6c86 Rohit Sharma 2026-06-12 chore: bump version to 2.3.46 + changelog
 CHANGELOG.md | 9 +++++++++
 package.json | 2 +-
 2 files changed, 10 insertions(+), 1 deletion(-)

ed61af30 Interstellar-code 2026-06-12 Merge pull request #235 from Interstellar-code/feat/template-wizard
b5d6f4da Rohit Sharma 2026-06-12 feat(kanban): 5-step template creation wizard (#231 follow-up)
 src/lib/hermes-kanban-types.ts                     |    4 +
 .../board-templates/board-templates-screen.tsx     | 1253 ++++++++++++++++++--
 src/styles/matrix-boards.css                       |   75 ++
 3 files changed, 1205 insertions(+), 127 deletions(-)

2b6b522e Interstellar-code 2026-06-12 Merge pull request #234 from Interstellar-code/feat/kanban-template-delta-233
bf41c98b Rohit Sharma 2026-06-12 feat(kanban): template task runtime/turn fields + keep-status copy (#233)
 src/lib/hermes-kanban-types.ts                         | 4 ++++
 src/screens/board-templates/board-templates-screen.tsx | 3 +++
 src/screens/tasks/tasks-screen.tsx                     | 6 +++++-
 3 files changed, 12 insertions(+), 1 deletion(-)

aa6c13de Rohit Sharma 2026-06-12 chore: bump version to 2.3.45 + changelog
 CHANGELOG.md | 8 ++++++++
 package.json | 2 +-
 2 files changed, 9 insertions(+), 1 deletion(-)

b28670ff Interstellar-code 2026-06-12 Merge pull request #232 from Interstellar-code/feat/board-templates-231
01e0ed22 Rohit Sharma 2026-06-12 feat(kanban): Board Templates management page (#231)
 src/lib/board-templates-api.ts                     | 189 ++++++
 src/lib/hermes-kanban-types.ts                     |  78 ++-
 src/routeTree.gen.ts                               | 136 ++++
 .../hermes-kanban/boards.$slug.save-as-template.ts |  46 ++
 .../hermes-kanban/templates.$slug.instantiate.ts   |  43 ++
 src/routes/api/hermes-kanban/templates.$slug.ts    |  95 +++
 src/routes/api/hermes-kanban/templates.ts          |  58 ++
 src/routes/board-templates.tsx                     |  34 +
 .../board-templates/board-templates-screen.tsx     | 698 +++++++++++++++++++++
 .../chat/components/sidebar/v2/primary-nav-v2.tsx  |   7 +-
 src/screens/tasks/tasks-screen.tsx                 | 211 ++++++-
 src/server/hermes-kanban-client.ts                 |  91 ++-
 12 files changed, 1671 insertions(+), 15 deletions(-)

5053ce5d Rohit Sharma 2026-06-12 chore: bump version to 2.3.44 + changelog
 .omc/releases/v2.3.44.md | 31 +++++++++++++++++++++++++++++++
 CHANGELOG.md             | 30 ++++++++++++++++++++++++++++++
 package.json             |  2 +-
 3 files changed, 62 insertions(+), 1 deletion(-)

8eaf1e28 Interstellar-code 2026-06-12 Merge pull request #230 from Interstellar-code/fix/plugin-compat-self-heal
86fd4b9d Rohit Sharma 2026-06-12 fix(plugin-sync): re-register when cached incompatible verdict is stale
 src/server/hermes-plugin-sync.test.ts | 49 +++++++++++++++++++++++++++++++++++
 src/server/hermes-plugin-sync.ts      | 13 +++++++++-
 2 files changed, 61 insertions(+), 1 deletion(-)

c26e1ff2 Interstellar-code 2026-06-12 Merge pull request #229 from Interstellar-code/feat/hermes-plugin-section-228
d0b678d3 Rohit Sharma 2026-06-12 fix(plugin-sync): resolve frontend version via __APP_VERSION__ define
 src/server/hermes-plugin-sync.ts | 20 +++++++++++++++++---
 1 file changed, 17 insertions(+), 3 deletions(-)

fa283154 Rohit Sharma 2026-06-12 feat(settings): mirror saved settings to hermes plugin endpoint (P4, #228)
 src/screens/settings/lib/saver.ts | 114 ++++++++++++++++++++++++++++++++++++++
 1 file changed, 114 insertions(+)

2d8b39a2 Rohit Sharma 2026-06-12 feat(settings): Hermes plugin section + backend config-sync wiring (P1-P3, #228)
 src/routeTree.gen.ts                               |  52 ++
 src/routes/api/hermes-plugin.settings.ts           |  35 ++
 src/routes/api/hermes-plugin.ts                    |  27 +
 .../settings/sections/section-hermes-plugin.tsx    | 436 ++++++++++++++++
 src/screens/settings/settings-screen.tsx           |   3 +
 src/server/gateway-capabilities.ts                 |   3 +
 src/server/hermes-plugin-sync.test.ts              | 345 +++++++++++++
 src/server/hermes-plugin-sync.ts                   | 548 +++++++++++++++++++++
 8 files changed, 1449 insertions(+)

12cc2ce9 Interstellar-code 2026-06-12 Merge pull request #226 from Interstellar-code/fix/agent-view-panel-rerender-crash
a90f9ad7 Rohit Sharma 2026-06-12 fix(chat): contain AgentViewPanel re-render crash + dedupe AnimatePresence keys
 src/components/agent-view/agent-view-panel.tsx |  9 +++++++
 src/components/error-boundary.tsx              | 37 ++++++++++++++++++++++++++
 src/screens/chat/chat-screen.tsx               | 14 +++++++++-
 3 files changed, 59 insertions(+), 1 deletion(-)

8f5a978f Interstellar-code 2026-06-12 Merge pull request #225 from Interstellar-code/fix/chat-rerender-and-sessions-poller
bccd7569 Rohit Sharma 2026-06-12 fix(chat): calm idle session pollers + crash-diagnostics error boundary
 src/components/error-boundary.tsx           | 90 +++++++++++++++++++++++++----
 src/screens/chat/hooks/use-chat-sessions.ts |  5 +-
 src/stores/chat-activity-store.ts           |  2 +-
 3 files changed, 85 insertions(+), 12 deletions(-)

8fe8773f Interstellar-code 2026-06-12 Merge pull request #224 from Interstellar-code/fix/chat-medium-impact
193d56fb Rohit Sharma 2026-06-12 fix(chat): complete composer busy-state cutover (#219)
 src/screens/chat/chat-screen.tsx | 37 ++++++++++++++++---------------------
 src/stores/chat-store.ts         | 12 ++++++------
 2 files changed, 22 insertions(+), 27 deletions(-)

8f1b671f Rohit Sharma 2026-06-12 perf(chat): consolidate redundant pollers and timers (#214)
 src/routes/api/session-status.ts                  |  4 +-
 src/screens/chat/chat-screen.tsx                  | 60 +++++++++++++++++--
 src/screens/chat/components/chat-message-list.tsx | 51 +++++++++-------
 src/screens/chat/components/message-item.tsx      | 56 +++++++++--------
 src/screens/chat/hooks/use-shared-ticker.ts       | 73 +++++++++++++++++++++++
 src/server/hermes-api.ts                          | 29 ++++++++-
 6 files changed, 216 insertions(+), 57 deletions(-)

bb121c2a Rohit Sharma 2026-06-12 perf(chat): chat-store hot-path hygiene (#221)
 .../chat/hooks/use-realtime-chat-history.ts        |  12 +-
 src/screens/chat/internal-message-filter.ts        |  29 +++
 src/stores/chat-store.test.ts                      | 211 ++++++++++++++++++++-
 src/stores/chat-store.ts                           | 144 ++++++++++----
 4 files changed, 351 insertions(+), 45 deletions(-)

53108a58 Rohit Sharma 2026-06-12 perf(chat): collapsed-head windowing for long threads (#213); fix stale-render gaps in areMessagesEqual (#222)
 .../chat/components/chat-message-list.test.tsx     |  62 ++++++++
 src/screens/chat/components/chat-message-list.tsx  | 165 ++++++++++++++-------
 .../message-item.areMessagesEqual.test.ts          |  94 ++++++++++++
 src/screens/chat/components/message-item.tsx       |  26 +++-
 4 files changed, 294 insertions(+), 53 deletions(-)

025cdbee Interstellar-code 2026-06-11 Merge pull request #223 from Interstellar-code/fix/chat-hot-path-high-impact
98f59056 Rohit Sharma 2026-06-11 fix(chat): unified session-list invalidation + deterministic realtime buffer cleanup (#218 #220)
 src/routes/chat/$sessionKey.tsx                    |  3 +-
 src/screens/chat/chat-screen.tsx                   | 12 ++--
 src/screens/chat/hooks/use-auto-session-title.ts   |  5 +-
 src/screens/chat/hooks/use-delete-session.ts       |  7 +-
 .../chat/hooks/use-realtime-chat-history.ts        | 80 +++++++++-------------
 src/screens/chat/hooks/use-rename-session.ts       |  6 +-
 src/screens/chat/sessions-feed.ts                  | 17 ++++-
 7 files changed, 68 insertions(+), 62 deletions(-)

3d039971 Rohit Sharma 2026-06-11 perf(chat): stabilize message-array identity during streaming + single rAF smoother (#212); gateway timeouts, 503 on history failure, live-poll 800→1500ms, focus-refetch stream guard (#215 #216 #217)
 src/routes/api/history.ts                       | 103 ++++++++++++++-----
 src/routes/api/send-stream.ts                   |   7 +-
 src/screens/chat/chat-screen.tsx                |  17 +++-
 src/screens/chat/hooks/use-chat-history.ts      |  18 +++-
 src/screens/chat/hooks/use-streaming-message.ts |  62 +++++-------
 src/server/hermes-api.ts                        | 127 ++++++++++++++++++------
 6 files changed, 237 insertions(+), 97 deletions(-)

ef094a8a Interstellar-code 2026-06-11 Merge pull request #211 from Interstellar-code/feat/self-improve-ux-redesign-210
be02c656 Rohit Sharma 2026-06-11 feat(chat): preserve formatting on paste + table copy button
 package.json                                       |   3 +
 pnpm-lock.yaml                                     |  32 ++++++
 src/components/prompt-kit/markdown.tsx             | 109 +++++++++++++++++++--
 src/lib/clipboard.ts                               |  29 ++++++
 src/lib/html-to-markdown.ts                        |  38 +++++++
 .../chat/components/chat-composer-shadcn.tsx       |  46 ++++++++-
 src/screens/chat/components/message-item.tsx       |  41 +++++++-
 src/types/turndown-plugin-gfm.d.ts                 |  11 +++
 8 files changed, 294 insertions(+), 15 deletions(-)

23e4c0e9 Rohit Sharma 2026-06-11 feat(self-improve): narrative UX redesign — single scope, hero diff, stepper (#210)
 docs/plans/self-improve-ux-redesign-210.md         | 132 ++++
 .../self-improve/components/experiment-card.tsx    | 531 +++++++++++++
 .../self-improve/components/info-tooltip.tsx       |  58 ++
 .../self-improve/components/lifecycle-stepper.tsx  | 108 +++
 .../components/profile-scope-select.tsx            |  26 +
 .../self-improve/components/scenario-checklist.tsx |  60 ++
 .../self-improve/components/score-context.tsx      | 117 +++
 src/screens/self-improve/self-improve-screen.css   | 492 ++++++++++++
 src/screens/self-improve/self-improve-screen.tsx   | 825 ++++-----------------
 9 files changed, 1671 insertions(+), 678 deletions(-)

6a40fb1f Interstellar-code 2026-06-11 Merge pull request #207 from Interstellar-code/feat/self-improve-page-206
3096d6ec Rohit Sharma 2026-06-11 docs(self-improve): add self-improving agent assessment & proposal
 docs/self-improving-agent-proposal.md | 207 ++++++++++++++++++++++++++++++++++
 1 file changed, 207 insertions(+)

eed99e3f Rohit Sharma 2026-06-11 fix(self-improve): source profile selectors from real agent profiles
 src/hooks/use-agent-profiles.ts                  | 24 ++++++++++++++++++++++++
 src/screens/self-improve/self-improve-screen.tsx | 21 +++++++++++++--------
 2 files changed, 37 insertions(+), 8 deletions(-)

8c72e247 Rohit Sharma 2026-06-11 fix(self-improve): avoid double-parens in single-profile Propose label
 src/screens/self-improve/self-improve-screen.tsx | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

bf291835 Rohit Sharma 2026-06-11 feat(self-improve): P3 scenarios, pause/resume, baseline chart
 src/lib/self-improve-api.ts                        |  63 ++++
 src/lib/self-improve-types.ts                      |  40 +++
 src/routeTree.gen.ts                               | 101 ++++++
 src/routes/api/self-improve/-scenarios.test.ts     | 239 ++++++++++++++
 .../api/self-improve/profiles.$profile.pause.ts    |  30 ++
 .../api/self-improve/profiles.$profile.resume.ts   |  30 ++
 src/routes/api/self-improve/scenarios.$id.ts       |  27 ++
 src/routes/api/self-improve/scenarios.ts           |  70 ++++
 .../self-improve/components/baseline-chart.tsx     | 145 ++++++++
 src/screens/self-improve/self-improve-screen.css   | 295 +++++++++++++++++
 src/screens/self-improve/self-improve-screen.tsx   | 365 ++++++++++++++++++++-
 src/server/self-improve-client.test.ts             | 156 +++++++++
 src/server/self-improve-client.ts                  |  71 ++++
 13 files changed, 1631 insertions(+), 1 deletion(-)

232c70b6 Rohit Sharma 2026-06-11 feat(self-improve): P2 lifecycle apply/verify/revert + history drawer
 src/lib/self-improve-api.ts                        |  42 +++
 src/routeTree.gen.ts                               |  69 ++++
 src/routes/api/self-improve/-experiments.test.ts   | 148 +++++++++
 .../api/self-improve/experiments.$id.apply.ts      |  30 ++
 .../api/self-improve/experiments.$id.revert.ts     |  37 +++
 .../api/self-improve/experiments.$id.verify.ts     |  30 ++
 .../self-improve/components/history-drawer.tsx     | 151 +++++++++
 src/screens/self-improve/self-improve-screen.css   | 362 +++++++++++++++++++++
 src/screens/self-improve/self-improve-screen.tsx   | 320 ++++++++++++++++++
 src/server/self-improve-client.test.ts             |  81 +++++
 src/server/self-improve-client.ts                  |  42 +++
 11 files changed, 1312 insertions(+)

a701ce66 Rohit Sharma 2026-06-11 feat(self-improve): P1 proposal queue with approve/reject/propose
 src/lib/self-improve-api.ts                        |  73 +++++
 src/lib/self-improve-types.ts                      | 102 +++++++
 src/routeTree.gen.ts                               | 159 ++++++++++
 src/routes/api/self-improve/-experiments.test.ts   | 235 +++++++++++++++
 .../api/self-improve/experiments.$id.approve.ts    |  37 +++
 .../api/self-improve/experiments.$id.history.ts    |  28 ++
 .../api/self-improve/experiments.$id.reject.ts     |  40 +++
 src/routes/api/self-improve/experiments.$id.ts     |  28 ++
 src/routes/api/self-improve/experiments.ts         |  52 ++++
 src/routes/api/self-improve/propose.ts             |  36 +++
 src/screens/self-improve/components/diff-view.tsx  |  46 +++
 src/screens/self-improve/components/eval-table.tsx |  69 +++++
 src/screens/self-improve/self-improve-screen.css   | 230 +++++++++++++++
 src/screens/self-improve/self-improve-screen.tsx   | 323 ++++++++++++++++++++-
 src/server/self-improve-client.test.ts             | 186 ++++++++++++
 src/server/self-improve-client.ts                  |  71 +++++
 16 files changed, 1713 insertions(+), 2 deletions(-)

2c17cea0 Rohit Sharma 2026-06-11 feat(self-improve): P0 capability-gated observability scorecard
 src/components/mobile-hamburger-menu.tsx           |   7 +
 src/components/mobile-tab-bar.tsx                  |   7 +
 src/hooks/use-self-improve-available.ts            |  32 +++
 src/lib/self-improve-api.ts                        |  69 +++++
 src/lib/self-improve-types.ts                      |  54 ++++
 src/routeTree.gen.ts                               | 117 ++++++++
 src/routes/api/self-improve/baselines.ts           |  24 ++
 src/routes/api/self-improve/health.ts              |  22 ++
 src/routes/api/self-improve/metrics.latest.ts      |  22 ++
 src/routes/api/self-improve/metrics.ts             |  42 +++
 src/routes/self-improve.tsx                        |  34 +++
 .../chat/components/sidebar/v2/primary-nav-v2.tsx  |   3 +
 src/screens/self-improve/self-improve-screen.css   | 310 ++++++++++++++++++++
 src/screens/self-improve/self-improve-screen.tsx   | 318 +++++++++++++++++++++
 src/server/self-improve-client.test.ts             | 131 +++++++++
 src/server/self-improve-client.ts                  |  82 ++++++
 16 files changed, 1274 insertions(+)

fb5668bd Rohit Sharma 2026-06-11 Release v2.3.43 — dynamic version badge + sidebar last-activity ordering
 CHANGELOG.md | 12 ++++++++++++
 package.json |  2 +-
 2 files changed, 13 insertions(+), 1 deletion(-)

412800e7 Rohit Sharma 2026-06-11 fix(sidebar): resumed sessions jump to Today on send
 src/screens/chat/chat-screen.tsx  | 5 +++++
 src/screens/chat/sessions-feed.ts | 2 +-
 2 files changed, 6 insertions(+), 1 deletion(-)

c1b1f8ef Rohit Sharma 2026-06-11 feat(website): fetch version badge dynamically from GitHub releases
 website/src/components/HeroRain.astro |  2 +-
 website/src/components/TopNav.astro   | 45 ++++++++++++++++++++++++++++++++++-
 website/src/pages/index.astro         |  2 +-
 3 files changed, 46 insertions(+), 3 deletions(-)

4c8611c6 Rohit Sharma 2026-06-11 Release v2.3.42 — Matrix3D activity sync + WebGL/kanban console fixes
 CHANGELOG.md | 10 ++++++++++
 package.json |  2 +-
 2 files changed, 11 insertions(+), 1 deletion(-)

3ddce6c9 Rohit Sharma 2026-06-11 fix(matrix3d): stop canvas remount churn that loses WebGL context
 src/features/retro-office/RetroOffice3D.tsx | 18 ++++++++----------
 1 file changed, 8 insertions(+), 10 deletions(-)

146e6228 Rohit Sharma 2026-06-11 fix(kanban): raise kanbanFetch timeout above worst-case auth flow
 src/server/hermes-kanban-client.ts | 8 +++++++-
 1 file changed, 7 insertions(+), 1 deletion(-)

8d4888fc Rohit Sharma 2026-06-10 fix(matrix3d): rewire crew activity to per-profile DB ground truth
 src/lib/crew-delegation.test.ts                    | 194 +++++++++++++++
 src/lib/crew-delegation.ts                         | 114 +++++++++
 src/lib/workspace-agents.ts                        |  11 +
 src/routes/api/crew-status.ts                      | 275 +++++++++++++--------
 .../matrix3d/use-matrix3d-office-data.test.ts      |   5 +-
 src/screens/matrix3d/use-matrix3d-office-data.ts   | 121 +--------
 6 files changed, 505 insertions(+), 215 deletions(-)

9a8a478f Rohit Sharma 2026-06-10 Release v2.3.41 — expose Plugins docs on the Starlight site
 CHANGELOG.md                  |  8 ++++++++
 package.json                  |  2 +-
 website/astro.config.mjs      | 10 ++++++++++
 website/src/content.config.ts |  1 +
 website/src/site-version.ts   |  2 +-
 5 files changed, 21 insertions(+), 2 deletions(-)

745dab0d Rohit Sharma 2026-06-10 Release v2.3.40 — docs plugins section + website version fix
 CHANGELOG.md                                       |  13 +
 docs/diagrams/matrix-coder-intent-detection.html   | 367 +++++++++++++++++++++
 docs/docs-manifest.yaml                            |  12 +
 docs/plugins/a2a-fleet.md                          |  90 +++++
 docs/plugins/lazy-load-mcp.md                      | 113 +++++++
 docs/plugins/matrix-coder.md                       | 120 +++++++
 docs/plugins/overview.md                           |  36 ++
 docs/plugins/workflow-engine.md                    | 114 +++++++
 package.json                                       |   2 +-
 website/astro.config.mjs                           |   8 +-
 .../diagrams/matrix-coder-intent-detection.html    | 367 +++++++++++++++++++++
 website/src/site-version.ts                        |   2 +-
 12 files changed, 1237 insertions(+), 7 deletions(-)

caeebf43 Rohit Sharma 2026-06-10 Release v2.3.39
 CHANGELOG.md | 15 +++++++++++++++
 package.json |  2 +-
 2 files changed, 16 insertions(+), 1 deletion(-)

127dec29 Rohit Sharma 2026-06-10 Send JSON when triggering cron jobs
 src/lib/jobs-api.test.ts | 26 +++++++++++++++++++++++++-
 src/lib/jobs-api.ts      |  2 ++
 2 files changed, 27 insertions(+), 1 deletion(-)

09a06bb5 Rohit Sharma 2026-06-10 Link cron history and session search to run IDs
 src/lib/jobs-api.test.ts                           |  9 ++++
 src/lib/jobs-api.ts                                | 33 ++++++++++++++
 src/routes/api/claude-jobs.$jobId.ts               | 23 ++++++++--
 .../chat/apply-filters-and-decorate.test.ts        | 53 +++++++++++++++++-----
 src/screens/chat/apply-filters-and-decorate.ts     | 15 +-----
 .../components/sidebar/v2/sidebar-search-v2.tsx    |  2 +-
 src/screens/chat/session-search.ts                 | 53 ++++++++++++++++++++++
 src/screens/chat/sessions-feed.ts                  | 18 +-------
 src/screens/jobs/components/cron-detail-drawer.tsx | 19 ++++++--
 9 files changed, 176 insertions(+), 49 deletions(-)

abc196ba Rohit Sharma 2026-06-10 Name cron run sessions from their jobs
 src/screens/chat/sessions-feed.test.ts | 73 ++++++++++++++++++++++++++++++----
 src/screens/chat/sessions-feed.ts      | 65 +++++++++++++++++++++++++++++-
 2 files changed, 128 insertions(+), 10 deletions(-)

3b5853a7 Rohit Sharma 2026-06-10 Clarify cron history fallback and clean all cron chats
 src/lib/jobs-api.ts                                | 11 ++++
 src/routes/api/-claude-jobs.$jobId.test.ts         | 71 +++++++++++++++++++---
 src/routes/api/claude-jobs.$jobId.ts               | 68 +++++++++++++++++----
 src/screens/jobs/components/cron-detail-drawer.tsx | 40 ++++++++----
 4 files changed, 159 insertions(+), 31 deletions(-)

fb85cb8d Rohit Sharma 2026-06-10 Show cron history when run endpoints are unavailable
 src/routes/api/-claude-jobs.$jobId.test.ts | 44 +++++++++++++++++++
 src/routes/api/claude-jobs.$jobId.ts       | 69 ++++++++++++++++++++++++++++--
 2 files changed, 109 insertions(+), 4 deletions(-)

e6833b52 Rohit Sharma 2026-06-10 Keep cron run history and linked chats in sync
 src/lib/jobs-api.ts                        |  54 +++++++++++-
 src/routes/api/-claude-jobs.$jobId.test.ts |  96 +++++++++++++++++++--
 src/routes/api/claude-jobs.$jobId.ts       | 129 +++++++++++++++++++++++++++--
 3 files changed, 266 insertions(+), 13 deletions(-)

79d63e4f Rohit Sharma 2026-06-10 Allow cron deletes to reach the jobs backend
 src/routes/api/-claude-jobs.$jobId.test.ts | 79 ++++++++++++++++++++++++++++++
 src/routes/api/claude-jobs.$jobId.ts       |  2 -
 2 files changed, 79 insertions(+), 2 deletions(-)

d17852c4 Rohit Sharma 2026-06-10 Keep docs authoring guidance aligned with Starlight
 docs/diagrams/docs-authoring-pipeline.html         | 434 +++++++++------------
 docs/getting-started/authoring-docs.md             |  25 +-
 .../diagrams/docs-authoring-pipeline.html          | 434 +++++++++------------
 3 files changed, 399 insertions(+), 494 deletions(-)

cb470866 Rohit Sharma 2026-06-10 Align release metadata around the deployed website
 CHANGELOG.md                |  9 +++++++++
 package.json                |  6 +++---
 website/astro.config.mjs    | 11 +++++++++++
 website/src/site-version.ts | 10 ++++------
 4 files changed, 27 insertions(+), 9 deletions(-)

fa137e96 Rohit Sharma 2026-06-10 Unify website docs with the Matrix shell
 website/astro.config.mjs                        |   3 +
 website/src/components/StarlightSiteTitle.astro |   8 +
 website/src/styles/starlight-docs.css           | 473 ++++++++++++++++++++++--
 3 files changed, 456 insertions(+), 28 deletions(-)

88ec1d64 Rohit Sharma 2026-06-10 Keep website docs navigation within its base
 CHANGELOG.md                             | 11 +++++++++++
 package.json                             |  2 +-
 website/astro.config.mjs                 | 17 +++++++++++++++--
 website/src/lib/starlight-docs-prefix.ts | 19 +++++++++++++++++--
 4 files changed, 44 insertions(+), 5 deletions(-)

6732cb01 Rohit Sharma 2026-06-10 Keep embedded website docs self-contained and readable
 CHANGELOG.md                             |   13 +
 docs/getting-started/authoring-docs.md   |    9 +
 package.json                             |    2 +-
 website/.gitignore                       |    2 +-
 website/astro.config.mjs                 |   36 +-
 website/package-lock.json                | 1071 +++++++++++++++++++++++++++++-
 website/package.json                     |    3 +-
 website/scripts/postbuild.mjs            |   49 +-
 website/scripts/sync-docs-assets.mjs     |   12 +
 website/src/components/TopNav.astro      |    3 +-
 website/src/lib/docs-rewrites.mjs        |   27 +-
 website/src/lib/starlight-docs-prefix.ts |    3 +-
 website/src/pages/docs/index.astro       |    3 +-
 website/src/styles/starlight-docs.css    |   65 ++
 14 files changed, 1284 insertions(+), 14 deletions(-)

64fea353 Rohit Sharma 2026-06-09 Keep docs and website previews usable without duplicating content
 CHANGELOG.md                                       |   14 +
 docs/deployment/unraid.md                          |    5 +
 docs/getting-started/connecting-provider.md        |    4 +-
 ...nect-hermes-to-telegram-and-configure-topics.md |    5 +
 ...se-the-manifest-provider-to-reduce-llm-costs.md |    2 +-
 docs/settings/workflows-backend-toggle.md          |    5 +
 docs/troubleshooting/agent-connect.md              |    2 +-
 docs/troubleshooting/telegram.md                   |    5 +
 package.json                                       |    4 +-
 website/astro.config.mjs                           |  131 ++
 website/package-lock.json                          | 1467 +++++++++++++++++++-
 website/package.json                               |    3 +-
 .../diagrams/agent-connect-diagnostic.html         |  358 +++++
 .../public/docs-assets/diagrams/api-keys-flow.html |  282 ++++
 .../docs-assets/diagrams/boards-architecture.html  |  364 +++++
 .../docs-assets/diagrams/chat-attachment-flow.html |  269 ++++
 .../diagrams/chat-message-lifecycle.html           |  238 ++++
 .../diagrams/conductor-architecture.html           |  333 +++++
 .../docs-assets/diagrams/context-window-flow.html  |  268 ++++
 .../docs-assets/diagrams/crash-recovery-flow.html  |  323 +++++
 .../diagrams/custom-endpoint-routing.html          |  313 +++++
 .../diagrams/dashboard-data-sources.html           |  282 ++++
 .../diagrams/docs-authoring-pipeline.html          |  272 ++++
 .../diagrams/dual-process-architecture.html        |  340 +++++
 .../docs-assets/diagrams/file-operations-flow.html |  293 ++++
 .../diagrams/hindsight-long-term-memory-flow.html  |  220 +++
 .../public/docs-assets/diagrams/install-paths.html |  304 ++++
 .../docs-assets/diagrams/jobs-lifecycle.html       |  292 ++++
 .../diagrams/manifest-cost-reduction-flow.html     |  208 +++
 .../diagrams/matrix3d-architecture.html            |  333 +++++
 .../diagrams/mcp-handshake-sequence.html           |  262 ++++
 .../docs-assets/diagrams/mcp-install-sequence.html |  247 ++++
 .../docs-assets/diagrams/mcp-server-lifecycle.html |  312 +++++
 .../diagrams/memory-tabs-architecture.html         |  290 ++++
 .../diagrams/models-source-architecture.html       |  291 ++++
 .../diagrams/operations-architecture.html          |  313 +++++
 .../docs-assets/diagrams/profile-data-model.html   |  301 ++++
 .../docs-assets/diagrams/provider-routing.html     |  254 ++++
 .../docs-assets/diagrams/session-lifecycle.html    |  249 ++++
 .../docs-assets/diagrams/sessions-diagnostic.html  |  320 +++++
 .../public/docs-assets/diagrams/skill-anatomy.html |  316 +++++
 .../docs-assets/diagrams/skill-authoring-flow.html |  291 ++++
 .../diagrams/skills-loading-pipeline.html          |  306 ++++
 .../diagrams/slash-command-resolution.html         |  284 ++++
 .../docs-assets/diagrams/tasks-board-sync.html     |  372 +++++
 .../diagrams/telegram-channel-and-topics-flow.html |  156 +++
 .../diagrams/terminal-pty-architecture.html        |  303 ++++
 .../diagrams/workflow-editor-model.html            |  384 +++++
 .../docs-assets/diagrams/workflow-node-types.html  |  300 ++++
 .../docs-assets/diagrams/workflow-output-flow.html |  336 +++++
 .../diagrams/workflow-run-sequence.html            |  275 ++++
 .../diagrams/workflows-architecture.html           |  306 ++++
 website/public/docs-assets/images/star-history.png |  Bin 0 -> 512089 bytes
 website/public/docs-assets/screenshots/chat.png    |  Bin 0 -> 358762 bytes
 .../public/docs-assets/screenshots/conductor.png   |  Bin 0 -> 443793 bytes
 .../public/docs-assets/screenshots/dashboard.png   |  Bin 0 -> 605741 bytes
 website/public/docs-assets/screenshots/files.png   |  Bin 0 -> 329556 bytes
 website/public/docs-assets/screenshots/jobs.png    |  Bin 0 -> 365043 bytes
 website/public/docs-assets/screenshots/memory.png  |  Bin 0 -> 624723 bytes
 .../public/docs-assets/screenshots/settings.png    |  Bin 0 -> 276951 bytes
 website/public/docs-assets/screenshots/skills.png  |  Bin 0 -> 809898 bytes
 website/public/docs-assets/screenshots/splash.png  |  Bin 0 -> 56865 bytes
 website/public/docs-assets/screenshots/tasks.png   |  Bin 0 -> 179343 bytes
 .../screenshots/terminal-redesign-rain-fixed.png   |  Bin 0 -> 455030 bytes
 .../terminal-redesign-rain-upgraded.png            |  Bin 0 -> 517775 bytes
 .../docs-assets/screenshots/terminal-redesign.png  |  Bin 0 -> 516217 bytes
 .../public/docs-assets/screenshots/terminal.png    |  Bin 0 -> 214938 bytes
 website/scripts/postbuild.mjs                      |  147 +-
 website/scripts/sync-docs-assets.mjs               |   23 +
 website/src/content.config.ts                      |   36 +
 website/src/lib/docs-rewrites.mjs                  |  101 ++
 website/src/lib/starlight-docs-prefix.ts           |   66 +
 website/src/pages/docs/[...slug].astro             |   31 +
 website/src/pages/docs/index.astro                 |    3 +
 website/src/pages/docs/welcome.astro               |  229 ---
 75 files changed, 13769 insertions(+), 274 deletions(-)

c84fd719 Rohit Sharma 2026-06-09 chore: bump version to 2.3.34 + changelog
 CHANGELOG.md | 9 +++++++++
 package.json | 2 +-
 2 files changed, 10 insertions(+), 1 deletion(-)

7d40f191 Rohit Sharma 2026-06-09 fix(chat): keep Task sessions in the Task chip (precedence over cli/a2a)
 src/screens/chat/sessions-feed.test.ts | 54 ++++++++++++----------------------
 src/screens/chat/sessions-feed.ts      | 46 ++++++++++++++++++++---------
 2 files changed, 51 insertions(+), 49 deletions(-)

402c91d7 Rohit Sharma 2026-06-09 chore: bump version to 2.3.33 + changelog
 CHANGELOG.md | 18 ++++++++++++++++++
 package.json |  8 ++++----
 2 files changed, 22 insertions(+), 4 deletions(-)

9c102e5e Rohit Sharma 2026-06-09 ci(docker): free runner disk before buildx to avoid ResourceExhausted
 .github/workflows/docker-publish.yml | 17 +++++++++++++++++
 1 file changed, 17 insertions(+)

28c7e6fe Rohit Sharma 2026-06-09 chore(chat): remove tap-debug mount console noise
 src/hooks/use-tap-debug.ts | 3 ---
 1 file changed, 3 deletions(-)

24d32aaf Rohit Sharma 2026-06-09 fix(chat): enable Delete for Telegram, CLI, and A2A sessions
 .../components/sidebar/v2/sidebar-card-context-menu-v2.tsx   | 12 ++++++++++--
 1 file changed, 10 insertions(+), 2 deletions(-)

0666fe23 Rohit Sharma 2026-06-09 feat(chat): surface CLI and A2A sessions as first-class sources
 .../chat/components/sidebar/v2/sidebar-card-v2.tsx | 11 +++-
 .../sidebar/v2/sidebar-source-chips-v2.tsx         | 23 +++++++
 src/screens/chat/sessions-feed-types.ts            |  2 +-
 src/screens/chat/sessions-feed.test.ts             | 72 +++++++++++++++++++++-
 src/screens/chat/sessions-feed.ts                  | 19 +++---
 5 files changed, 115 insertions(+), 12 deletions(-)

bf99123e Rohit Sharma 2026-06-09 chore: bump version to 2.3.32 + changelog
 CHANGELOG.md | 10 ++++++++++
 package.json |  2 +-
 2 files changed, 11 insertions(+), 1 deletion(-)

2065db32 Rohit Sharma 2026-06-09 fix(update): only offer update when local is behind remote
 src/server/update-system.test.ts | 162 ++++++++++++++++++++++++++++++++-
 src/server/update-system.ts      | 190 +++++++++++++++++++++++++++++----------
 2 files changed, 306 insertions(+), 46 deletions(-)

3b583fd0 Rohit Sharma 2026-06-09 fix(dashboard): silence recharts width(-1)/height(-1) warning
 src/screens/dashboard/components/analytics-chart-card.tsx | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

8ebf6746 Rohit Sharma 2026-06-09 fix(chat): make Telegram sessions clickable in V2 sidebar
 .../chat/components/sidebar/v2/sidebar-card-v2.tsx    | 19 +++++++++++++------
 1 file changed, 13 insertions(+), 6 deletions(-)

210bc791 Rohit Sharma 2026-06-09 chore: bump version to 2.3.31 + changelog
 CHANGELOG.md | 10 ++++++++++
 package.json |  2 +-
 2 files changed, 11 insertions(+), 1 deletion(-)

6da61d46 Rohit Sharma 2026-06-09 test(mcp): repair marketplace dialog tests after shadcn migration
 src/screens/mcp/-marketplace-install-confirmation.test.tsx | 14 ++++----------
 .../mcp/-marketplace-placeholder-detection.test.tsx        |  6 ++++--
 2 files changed, 8 insertions(+), 12 deletions(-)

9704f489 Rohit Sharma 2026-06-09 fix(docs): render embedded flow diagrams instead of downloading them
 src/routes/api/-docs-asset.test.ts | 39 ++++++++++++++++++++++++++++++++++++++
 src/routes/api/docs-asset.ts       | 26 ++++++++++++++++++-------
 src/server/docs-render.test.ts     | 27 ++++++++++++++++++++++++++
 src/server/docs-render.ts          | 33 ++++++++++++++++++++++++++++++++
 4 files changed, 118 insertions(+), 7 deletions(-)

2f43ff30 Rohit Sharma 2026-06-09 chore: bump version to 2.3.30 + changelog
 CHANGELOG.md | 11 +++++++++++
 package.json |  2 +-
 2 files changed, 12 insertions(+), 1 deletion(-)

74bb80fc Rohit Sharma 2026-06-09 fix(gateway): find hermes binary and honor custom gateway port
 src/server/claude-agent.ts | 77 ++++++++++++++++++++++++++++++++++++++++++----
 1 file changed, 71 insertions(+), 6 deletions(-)

d0d12280 Rohit Sharma 2026-06-09 fix(website): auto-derive displayed version from package.json
 package.json                          | 2 +-
 website/src/components/HeroRain.astro | 6 ++++--
 website/src/components/TopNav.astro   | 3 ++-
 website/src/pages/index.astro         | 3 ++-
 website/src/site-version.ts           | 7 +++++++
 5 files changed, 16 insertions(+), 5 deletions(-)

8fdd1f26 Rohit Sharma 2026-06-09 fix(build): skip build:website when website/ absent (unblocks Docker image)
 package.json | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

789a8ec2 Rohit Sharma 2026-06-09 chore: bump version to 2.3.29 + changelog
 .omc/releases/v2.3.29.md | 49 ++++++++++++++++++++++++++++++++++++++++++++++++
 CHANGELOG.md             | 14 ++++++++++++++
 package.json             |  2 +-
 3 files changed, 64 insertions(+), 1 deletion(-)

f0321e03 Rohit Sharma 2026-06-09 feat(chat): drop tok/api from meta bar, add message/tool/skill counts to source tabs
 src/screens/chat/chat-screen.tsx                   | 15 ++++++++++-
 src/screens/chat/components/v2/chat-header-v2.tsx  |  8 +++++-
 .../chat/components/v2/chat-meta-bar-v2.test.tsx   | 17 ++-----------
 .../chat/components/v2/chat-meta-bar-v2.tsx        | 29 ----------------------
 .../chat/components/v2/chat-skills-tab-v2.tsx      | 28 +++++++++++++++------
 .../chat/components/v2/chat-source-tabs-v2.tsx     | 13 +++++++++-
 6 files changed, 56 insertions(+), 54 deletions(-)

de844470 Rohit Sharma 2026-06-09 fix(chat): sidebar delete refresh + telegram session classification
 src/routes/api/sessions.ts                         | 10 ++++----
 .../sidebar/v2/sidebar-source-chips-v2.tsx         | 14 ++++++++---
 src/screens/chat/hooks/use-delete-session.ts       | 28 ++++++++++------------
 src/screens/chat/sessions-feed.ts                  | 25 ++++++++++++-------
 src/screens/chat/types.ts                          |  2 ++
 src/screens/chat/utils.ts                          |  3 +++
 src/server/hermes-api.ts                           | 10 ++++++--
 7 files changed, 60 insertions(+), 32 deletions(-)

e8191cb8 Rohit Sharma 2026-06-09 feat(chat): strip live/profile/tools from meta bar, surface tok + api
 .../chat/components/v2/chat-meta-bar-v2.test.tsx   | 30 ++++---
 .../chat/components/v2/chat-meta-bar-v2.tsx        | 91 +++++++---------------
 2 files changed, 45 insertions(+), 76 deletions(-)

162aa3f4 Rohit Sharma 2026-06-09 feat(chat): surface per-session cost + token/api detail in chat UI
 src/hooks/use-session-status.ts                    | 24 +++++++++++++
 src/lib/format.ts                                  | 18 ++++++++++
 src/routes/api/session-status.ts                   |  8 +++++
 src/screens/chat/components/v2/chat-header-v2.tsx  | 20 +++++++++++
 .../chat/components/v2/chat-meta-bar-v2.test.tsx   | 40 ++++++++++++++++++++--
 .../chat/components/v2/chat-meta-bar-v2.tsx        | 40 ++++++++++++++++++++++
 .../dashboard/components/cost-ledger-card.tsx      | 17 +--------
 src/server/hermes-api.ts                           | 17 ++++++++-
 8 files changed, 164 insertions(+), 20 deletions(-)

2e61ad51 Rohit Sharma 2026-06-09 feat(chat): client-side slash commands (/reset /stop /title /reasoning)
 src/components/slash-command-menu.tsx | 20 ++++++++++++
 src/screens/chat/chat-screen-utils.ts |  2 +-
 src/screens/chat/chat-screen.tsx      | 59 ++++++++++++++++++++++++++++++++++-
 3 files changed, 79 insertions(+), 2 deletions(-)

d4d3e069 Rohit Sharma 2026-06-09 fix(chat): restore tok/s + tools fields in meta bar, fix react-query test mock
 .../chat/components/v2/chat-meta-bar-v2.test.tsx   | 18 ++++++++++----
 .../chat/components/v2/chat-meta-bar-v2.tsx        | 28 +++++++++++++---------
 2 files changed, 31 insertions(+), 15 deletions(-)

b98e6227 Rohit Sharma 2026-06-09 fix(chat): add missing Button import for interrupted affordance
 src/screens/chat/chat-screen.tsx | 40 ++++++++++++++++++++--------------------
 1 file changed, 20 insertions(+), 20 deletions(-)

484b33a1 Rohit Sharma 2026-06-08 feat(ui): Matrix-themed tabs for slash command picker + inline menu
 src/components/slash-command-menu.test.tsx |  52 ++++++-
 src/components/slash-command-menu.tsx      | 213 ++++++++++++++++++++++++++---
 2 files changed, 246 insertions(+), 19 deletions(-)

87baecd2 Rohit Sharma 2026-06-08 fix(ui): use dark Shiki theme when Matrix theme is active
 src/components/prompt-kit/code-block/index.tsx | 14 +++++++++++++-
 1 file changed, 13 insertions(+), 1 deletion(-)

edff7d0a Rohit Sharma 2026-06-08 fix(update): allow update when only package.json version is dirty
 src/server/update-system.test.ts | 122 ++++++++++++++++++++++++++++++++++++++-
 src/server/update-system.ts      |  50 ++++++++++++----
 2 files changed, 161 insertions(+), 11 deletions(-)

73e13f0e Rohit Sharma 2026-06-08 chore: bump version to 2.3.28 + changelog
 .omc/releases/v2.3.28.md | 79 ++++++++++++++++++++++++++++++++++++++++++++++++
 package.json             |  2 +-
 2 files changed, 80 insertions(+), 1 deletion(-)

338f7652 Rohit Sharma 2026-06-08 Merge feat/track1-chat-state-reliability — Track 1+2 chat state architecture
3ef535a8 Rohit Sharma 2026-06-08 fix(chat): move handleResendInterrupted after 'send' to fix TDZ error
 src/screens/chat/chat-screen.tsx | 49 +++++++++++++++++++++-------------------
 1 file changed, 26 insertions(+), 23 deletions(-)

dd6e7cf7 Rohit Sharma 2026-06-08 docs: mark Track 2 (storage consolidation) as shipped
 .omc/plans/unify-chat-state-architecture.md | 1 +
 1 file changed, 1 insertion(+)

febc2705 Rohit Sharma 2026-06-08 test(chat): parity truth table for isChatRuntimeBusy (Track 2 / Phase 2.2)
 src/screens/chat/chat-screen-utils.test.ts | 70 ++++++++++++++++++++++++++++++
 1 file changed, 70 insertions(+)

448b5c05 Rohit Sharma 2026-06-08 feat(chat): runPersistence adapter + queue→sessionStorage migration (Track 2 / Phase 2.3)
 src/stores/chat-store.ts           | 196 ++++++---------------------
 src/stores/run-persistence.test.ts | 210 +++++++++++++++++++++++++++++
 src/stores/run-persistence.ts      | 270 +++++++++++++++++++++++++++++++++++++
 3 files changed, 521 insertions(+), 155 deletions(-)

a7ec39b6 Rohit Sharma 2026-06-08 feat(chat): selectIsComposerBusy cutover (Track 2 / Phase 2.2)
 src/screens/chat/chat-screen.tsx |  14 ++++-
 src/stores/chat-store.test.ts    | 130 +++++++++++++++++++++++++++++++++++++++
 src/stores/chat-store.ts         |  28 +++++++++
 3 files changed, 171 insertions(+), 1 deletion(-)

a30403a8 Rohit Sharma 2026-06-08 feat(chat): runPhase state machine (Track 2 / Phase 2.1)
 .omc/plans/unify-chat-state-architecture.md |  50 ++++++++-
 src/stores/chat-store.test.ts               |  86 +++++++++++++++-
 src/stores/chat-store.ts                    |  52 ++++++++++
 src/stores/run-phase.test.ts                | 151 ++++++++++++++++++++++++++++
 src/stores/run-phase.ts                     | 147 +++++++++++++++++++++++++++
 5 files changed, 481 insertions(+), 5 deletions(-)

e55c9d25 Rohit Sharma 2026-06-08 docs: mark Phase 1.2 as done (was in-progress in status table)
 .omc/plans/unify-chat-state-architecture.md | 18 ++++++++++++++++++
 1 file changed, 18 insertions(+)

a013d350 Rohit Sharma 2026-06-08 docs: mark Track 1 (reliability) as shipped on feat/track1-chat-state-reliability
 .omc/plans/unify-chat-state-architecture.md | 297 ++++++++++++++++++++++++++++
 1 file changed, 297 insertions(+)

cea955b1 Rohit Sharma 2026-06-08 fix(chat): liveness-authoritative recovery with interrupted affordance (Track 1.2)
 src/screens/chat/chat-screen-utils.test.ts         |  80 ++++++++
 src/screens/chat/chat-screen-utils.ts              |  52 ++++++
 src/screens/chat/chat-screen.tsx                   |  49 +++++
 .../chat/hooks/use-active-run-check.test.ts        | 206 ++++++++++++++++++++-
 src/screens/chat/hooks/use-active-run-check.ts     |  96 +++++++++-
 src/stores/chat-store.test.ts                      |  35 ++++
 src/stores/chat-store.ts                           |  30 +++
 7 files changed, 539 insertions(+), 9 deletions(-)

192abff3 Rohit Sharma 2026-06-08 fix(chat): send X-Hermes-Session-Id for portable persistence (STEP 0)
 src/lib/send-stream-session-headers.ts     |   5 ++
 src/routes/api/send-stream.ts              |  22 +++++-
 src/server/chat-backends.ts                |   6 ++
 src/server/hermes-api.ts                   |  27 +++++--
 src/server/hermes-chat-session-key.test.ts | 113 +++++++++++++++++++++++++++++
 src/server/openai-compat-api.ts            |  15 +++-
 src/server/responses-api.ts                |   5 ++
 7 files changed, 184 insertions(+), 9 deletions(-)

6b3bf9ea Rohit Sharma 2026-06-08 fix(chat): drain-watchdog escape hatch for SSE-desync stall (Track 1.1)
 src/screens/chat/chat-screen.tsx                  |  30 ++++
 src/screens/chat/hooks/use-drain-watchdog.test.ts | 199 ++++++++++++++++++++++
 src/screens/chat/hooks/use-drain-watchdog.ts      | 164 ++++++++++++++++++
 3 files changed, 393 insertions(+)

8f57e97d Rohit Sharma 2026-06-08 docs: STEP 0 complete — portable persistence endpoint not needed
 .omc/plans/hermes-dep-post-messages-endpoint.md | 155 ++++++++++++++++++++++++
 1 file changed, 155 insertions(+)

0ccd2547 Rohit Sharma 2026-06-08 fix: wrap agent-card Tooltip in TooltipProvider
 src/components/agent-view/agent-card.tsx | 9 ++++++---
 1 file changed, 6 insertions(+), 3 deletions(-)

7d4e32fb Rohit Sharma 2026-06-08 Dock the shadcn composer on mobile
 .../components/chat-composer-shadcn-mobile.test.ts | 27 ++++++++++++++++++++++
 .../chat/components/chat-composer-shadcn.tsx       | 27 ++++++++++++++++------
 2 files changed, 47 insertions(+), 7 deletions(-)

2bf5a410 Rohit Sharma 2026-06-08 Type chat stream message metadata
 src/screens/chat/types.ts |  48 +++++++++++-
 src/stores/chat-store.ts  | 183 +++++++++++++++++++++++-----------------------
 2 files changed, 135 insertions(+), 96 deletions(-)

22e9f5e0 Rohit Sharma 2026-06-08 Record completed shadcn adoption state
 .omc/plans/open-questions.md  |  8 +++++
 .omc/plans/shadcn-adoption.md | 84 +++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 92 insertions(+)

23801e80 Rohit Sharma 2026-06-08 Stop stale chat activity indicators
 .../chat/components/v2/chat-tab-views-v2.test.tsx  |  5 +-
 .../chat/components/v2/chat-tab-views-v2.tsx       |  5 +-
 src/stores/chat-activity-store.test.ts             | 64 ++++++++++++++++++++++
 src/stores/chat-activity-store.ts                  | 26 ++++-----
 4 files changed, 82 insertions(+), 18 deletions(-)

e66e6bcf Rohit Sharma 2026-06-08 Remove the dead chat composer boundary
 src/screens/chat/chat-screen.tsx                   |    2 +-
 .../chat/components/chat-composer-attachments.ts   |  103 +
 .../chat-composer-context-controls.test.ts         |   17 +-
 .../chat/components/chat-composer-services.ts      |  167 +
 .../chat/components/chat-composer-shadcn.tsx       |   18 +-
 src/screens/chat/components/chat-composer-types.ts |   96 +
 src/screens/chat/components/chat-composer.tsx      | 3401 --------------------
 .../chat/components/v2/chat-meta-bar-v2.tsx        |    9 +-
 .../chat/components/v2/session-selectors-v2.tsx    |   28 +-
 src/stores/chat-store.ts                           |    2 +-
 10 files changed, 397 insertions(+), 3446 deletions(-)

95c3485d Interstellar-code 2026-06-08 Merge pull request #195 from Interstellar-code/feat/shadcn-command-slash-phase2-4-5
7481a6c5 Interstellar-code 2026-06-08 Merge pull request #194 from Interstellar-code/chore/delete-base-ui-alert-dialog
43e48f4b Interstellar-code 2026-06-08 Merge pull request #193 from Interstellar-code/feat/shadcn-dialog-phase2-2
a857842c Interstellar-code 2026-06-08 Merge pull request #192 from Interstellar-code/feat/shadcn-tooltip-phase2-1
b5ab1973 Interstellar-code 2026-06-08 Merge pull request #196 from Interstellar-code/feat/commands-backend-sidebar
67094c77 Rohit Sharma 2026-06-08 Mirror MCP drawer interactions for command management
 src/screens/commands/commands-screen.tsx | 768 +++++++++++++++++++------------
 1 file changed, 466 insertions(+), 302 deletions(-)

2b0709dd Rohit Sharma 2026-06-08 Align command management with the MCP workspace
 src/screens/commands/commands-screen.tsx | 669 +++++++++++++++++++------------
 1 file changed, 413 insertions(+), 256 deletions(-)

9f4bea4e Rohit Sharma 2026-06-08 Prevent companion services from triggering duplicate-start failures
 scripts/check-ports.mjs           | 61 +++++++++++++++++++++++++++++++++++----
 src/server/kanban-backend.test.ts | 26 +++++++++++++++++
 2 files changed, 82 insertions(+), 5 deletions(-)

b6f8e6f0 Rohit Sharma 2026-06-07 Prevent stale chat activity from self-locking the queue
 src/screens/chat/chat-screen-utils.test.ts         | 39 ++++++++++
 src/screens/chat/chat-screen-utils.ts              | 47 +++++++++--
 src/screens/chat/chat-screen.tsx                   | 90 ++++++++++------------
 .../chat/hooks/use-active-run-check.test.ts        | 65 ++++++++++++++++
 src/screens/chat/hooks/use-active-run-check.ts     | 74 +++++++++++-------
 src/server/run-store.test.ts                       | 61 +++++++++++++++
 src/server/run-store.ts                            | 32 +++++++-
 7 files changed, 324 insertions(+), 84 deletions(-)

e4728840 Rohit Sharma 2026-06-07 Make command macros usable from composer without tracking local state
 .gitignore                                         |   1 +
 .serena/.gitignore                                 |   2 -
 .serena/project.yml                                | 133 ---------------------
 src/screens/chat/chat-screen.tsx                   |   5 +-
 .../chat/components/chat-composer-shadcn.tsx       |  17 ++-
 src/server/commands-store.test.ts                  |  14 +++
 src/server/commands-store.ts                       |  10 ++
 7 files changed, 38 insertions(+), 144 deletions(-)

77227612 Rohit Sharma 2026-06-07 Add visible slash command discovery to the chat composer
 src/components/slash-command-menu.tsx | 123 +++++++++++++++++++++++++++++++---
 1 file changed, 112 insertions(+), 11 deletions(-)

a9fa2c4c Rohit Sharma 2026-06-07 Persist custom chat commands in SwitchUI-owned SQLite storage
 src/components/command-palette.tsx                 |  35 +-
 src/components/mobile-hamburger-menu.tsx           |   7 +
 src/components/mobile-tab-bar.tsx                  |   7 +
 src/components/slash-command-menu.tsx              |  67 +++-
 src/lib/commands-api.test.ts                       |  46 +++
 src/lib/commands-api.ts                            | 154 ++++++++
 src/routeTree.gen.ts                               |  73 ++++
 src/routes/api/commands.$id.ts                     |  59 +++
 src/routes/api/commands.ts                         |  50 +++
 src/routes/commands.tsx                            |  11 +
 src/screens/chat/chat-screen.tsx                   |  37 +-
 .../chat/components/sidebar/v2/primary-nav-v2.tsx  |   3 +
 src/screens/commands/commands-screen.tsx           | 398 +++++++++++++++++++++
 src/server/commands-store.test.ts                  | 100 ++++++
 src/server/commands-store.ts                       | 353 ++++++++++++++++++
 src/server/switchui-db.ts                          |  46 +++
 16 files changed, 1422 insertions(+), 24 deletions(-)

ed3d620a Rohit Sharma 2026-06-07 Align command surfaces on cmdk before slash-menu cutover
 src/components/command-palette.tsx              |   4 +-
 src/components/slash-command-menu.tsx           | 107 ++++---
 src/components/ui/command.tsx                   | 357 +++++++++++++++---------
 src/screens/chat/components/command-session.tsx |  24 +-
 4 files changed, 318 insertions(+), 174 deletions(-)

6d51ce51 Rohit Sharma 2026-06-07 chore(ui): delete dead src/components/ui/alert-dialog.tsx
 src/components/ui/alert-dialog.tsx | 110 -------------------------------------
 1 file changed, 110 deletions(-)

a28cbf8a Rohit Sharma 2026-06-07 feat(ui): migrate 19 base-ui Dialog consumers to shadcn (Phase 2 #2)
 src/components/agent-chat/AgentChatModal.tsx       |  6 ++--
 src/components/agent-view/guardrails-modal.tsx     |  6 ++--
 src/components/agent-view/kill-confirm-dialog.tsx  |  8 ++---
 src/components/agent-view/steer-modal.tsx          |  8 ++---
 .../file-explorer/file-explorer-sidebar.tsx        | 12 ++++---
 .../file-explorer/file-preview-dialog.tsx          | 12 ++++---
 src/components/settings-dialog/settings-dialog.tsx | 38 ++++++++++------------
 src/components/usage-meter/context-alert-modal.tsx |  6 ++--
 src/components/usage-meter/usage-details-modal.tsx |  2 +-
 src/components/usage-meter/usage-meter.tsx         |  6 ++--
 src/screens/chat/components/message-item.tsx       | 12 ++++---
 src/screens/chat/components/providers-dialog.tsx   | 38 ++++++++++------------
 src/screens/files/files-screen.tsx                 | 24 ++++++++------
 .../mcp/components/install-confirmation-dialog.tsx |  8 ++---
 src/screens/mcp/components/mcp-server-dialog.tsx   |  8 ++---
 .../mcp/components/sources-manager-dialog.tsx      |  8 ++---
 src/screens/profiles/profiles-screen.tsx           |  6 ++--
 .../settings/components/provider-wizard.tsx        |  8 ++---
 src/screens/tasks/task-dialog.tsx                  |  8 ++---
 19 files changed, 115 insertions(+), 109 deletions(-)

85adf210 Rohit Sharma 2026-06-07 feat(ui): migrate 9 base-ui Tooltip consumers to shadcn (Phase 2 #1)
 src/components/agent-avatar.tsx                    |  8 +--
 src/components/agent-view/agent-card.tsx           |  8 +--
 src/components/chat-panel-toggle.tsx               | 37 +++++------
 src/components/chat-panel.tsx                      | 74 ++++++++++------------
 src/components/export-menu.tsx                     | 42 ++++++------
 src/components/orchestrator-avatar.tsx             | 48 +++++++-------
 src/components/prompt-kit/message.tsx              | 10 +--
 src/components/prompt-kit/prompt-input.tsx         | 16 +++--
 .../chat/components/message-actions-bar.tsx        | 16 ++---
 9 files changed, 125 insertions(+), 134 deletions(-)

d16643f9 Interstellar-code 2026-06-07 feat(chat): shadcn composer live cutover at /chat (#187) (#190)
 .claude/scheduled_tasks.lock                       |    1 +
 .serena/.gitignore                                 |    2 +
 .serena/project.yml                                |  133 +++
 CHANGELOG.md                                       |   30 +
 package.json                                       |    6 +-
 pnpm-lock.yaml                                     |  528 ++++++++-
 src/components/shadcn/ui/command.tsx               |  184 ++++
 src/components/shadcn/ui/dialog.tsx                |  156 +++
 src/components/shadcn/ui/input.tsx                 |   21 +
 src/components/shadcn/ui/popover.tsx               |   87 ++
 src/components/shadcn/ui/textarea.tsx              |   18 +
 src/components/shadcn/ui/tooltip.tsx               |   57 +
 src/screens/chat/chat-screen-utils.test.ts         |   67 +-
 src/screens/chat/chat-screen-utils.ts              |   82 ++
 src/screens/chat/chat-screen.tsx                   |  234 +++-
 .../chat/components/chat-composer-shadcn.tsx       | 1126 ++++++++++++++++++++
 src/screens/chat/components/chat-composer.tsx      |   50 +-
 .../chat/components/chat-message-list.test.tsx     |   30 +
 src/screens/chat/components/chat-message-list.tsx  |  122 ++-
 .../chat/components/message-actions-bar.tsx        |   17 +
 src/screens/chat/components/message-item.tsx       |  152 ++-
 .../chat/components/v2/chat-meta-bar-v2.tsx        |   73 +-
 .../chat/components/v2/session-selectors-v2.tsx    |  729 +++++++++++++
 src/stores/chat-store.test.ts                      |   63 +-
 src/stores/chat-store.ts                           |  203 +++-
 website/package-lock.json                          |   14 -
 26 files changed, 4036 insertions(+), 149 deletions(-)

9662beca Interstellar-code 2026-06-06 feat(ui): shadcn/ui Phase 0 — isolated coexistence + token bridge (#187) (#189)
 components.json                             |   21 +
 package.json                                |    2 +
 pnpm-lock.yaml                              | 1944 ++++++++++++++++++++++-----
 src/components/shadcn/shadcn-smoke.test.tsx |   24 +
 src/components/shadcn/shadcn-smoke.tsx      |   17 +
 src/components/shadcn/ui/button.tsx         |   65 +
 src/shims/lucide-react.tsx                  |   27 -
 src/styles.css                              |   77 ++
 vite.config.ts                              |    1 -
 9 files changed, 1805 insertions(+), 373 deletions(-)

```

## CHANGELOG

- Changelog file: `CHANGELOG.md`

### Diff (last 7d)

```
commit 5c5e6c86623c6c66d948779118e19dd91b3eb2c4
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Fri Jun 12 16:20:41 2026 +0200

    chore: bump version to 2.3.46 + changelog

diff --git a/CHANGELOG.md b/CHANGELOG.md
index f7371591..175c3c36 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,15 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.46] — 2026-06-12
+
+Board Templates: guided wizard for template creation, plus per-task runtime/turn controls.
+
+### Added
+
+- **5-step template creation wizard.** The Board Templates page now creates and edits templates through a guided wizard — Basics (name, auto-slug, description, color) → Variables → Tasks → Dependencies + Recurrence → Review — replacing the raw-YAML drawer (kept as an "Advanced" escape hatch). Tasks expose status (`todo`/`ready`), priority, assignee, body with `{{variable}}` insertion, and an Advanced section for `max_runtime_seconds`, `goal_max_turns`, and `goal_mode`. The Dependencies step adds a parent→child link editor with live self-link/duplicate/cycle guards; the Review step runs a pre-commit checklist and shows a YAML preview before save. Backend validation errors (413/422/409) are surfaced cleanly. (#231 follow-up)
+- **Per-task `max_runtime_seconds` and `goal_max_turns`.** Optional positive-integer fields on template tasks, round-tripped through create/edit/instantiate. The save-as-template keep-status copy now reflects ready-only preservation. (#233)
+
 ## [2.3.45] — 2026-06-12
 
 Kanban Board Templates: manage reusable board definitions and instantiate them into live boards.

commit aa6c13de7437f70c5f739f91f230b818bf4170d8
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Fri Jun 12 13:59:01 2026 +0200

    chore: bump version to 2.3.45 + changelog

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 85600574..f7371591 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,14 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.45] — 2026-06-12
+
+Kanban Board Templates: manage reusable board definitions and instantiate them into live boards.
+
+### Added
+
+- **Board Templates management page.** New Templates sub-page under Tasks (`/board-templates`) for the Hermes Agent Kanban templates backend (hermes-agent #135 P2). Lists installed templates (name, slug, variables, recurrence); create/edit via a raw-YAML editor with 64 KB guard and inline validation-error surfacing; delete with confirm. **Instantiate** modal collects per-variable values (`{{key}}` substitution), optional target board and auto-dispatch, then shows created/skipped counts with a link to the new board. Recurrence is shown read-only with an enable/disable toggle (no cron authoring). A **Save as template** button in the `/tasks` board header snapshots a live board. Page hides/degrades cleanly when the backend predates templates (404) or the Kanban capability is absent; backend error details (413 oversized, 422 validation, 409 refused) are surfaced, not raw. Built to the live-verified gateway contract. (#231)
+
 ## [2.3.44] — 2026-06-12
 
 Chat hot-path performance overhaul, the recurring "Too many re-renders" crash contained and fixed, and the new Hermes Plugin settings section with backend config-sync.

commit 5053ce5d62646bcb56c06a8fd8c8cd27fcca7de4
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Fri Jun 12 09:58:35 2026 +0200

    chore: bump version to 2.3.44 + changelog
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index ee410511..85600574 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,36 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.44] — 2026-06-12
+
+Chat hot-path performance overhaul, the recurring "Too many re-renders" crash contained and fixed, and the new Hermes Plugin settings section with backend config-sync.
+
+### Added
+
+- **Hermes Plugin settings section + backend config-sync.** New `/settings` section surfacing the bundled `hermes-switch-ui` backend plugin: status pill with heartbeat age, connection info (ports, profile, enabled plugins), reported settings, and a version-compatibility banner with an explicit "unknown until registered" state. The workspace server registers with the backend on startup and heartbeats every 30s (register-gated, `globalThis` singleton, 60s backoff), and mirrors an allowlist of saved UI settings — secrets never leave the workspace. Degrades cleanly: "plugin not enabled" (confirmed 404) and "backend unreachable" (timeout/5xx) are distinct states with their own poll cadences. Stale incompatible compat verdicts self-heal via a 10-minute re-register window. (#228, #229, #230)
+- **Self-Improve narrative UX redesign.** Single global profile scope, merged Experiments feed, hero diff, lifecycle stepper, score context, and scenario checklist. (#210, #211)
+- **Composer paste keeps formatting.** Pasted HTML converts to Markdown instead of flattening to plain text; rendered tables get a copy button.
+- **Crash diagnostics that survive reload.** The error boundary now captures the React component stack, shows "Crashed in: …" in the error card, persists the last 3 crashes to `localStorage['hermes:ui-crash-log']`, and adds a Copy-details button.
+
+### Fixed
+
+- **The recurring "Too many re-renders" chat crash is contained and root-caused.** The new crash log pinpointed `AnimatePresence` inside `AgentViewPanel` (duplicate agent-id keys from merged CLI+mission sources break motion's child diff). Active nodes are now deduped by id, and the panel is isolated in an inline error boundary — a panel crash degrades to a small retry card instead of taking down the whole chat route. (#225, #226)
+- **Streaming no longer re-renders the entire message list every animation frame.** Live streaming text was embedded in the same array as historical messages, defeating list memoization ~60×/sec; it now reaches only the streaming bubble via a dedicated prop, and the duplicate rAF typewriter loop was removed. (#212)
+- **Session-list cache desync.** Rename, auto-title, and session-create only invalidated one of the two session caches, leaving the V2 sidebar stale; all mutation sites now invalidate both via one helper. (#218)
+- **Session-switch mid-stream race.** Realtime buffers are cleared deterministically on switch (the disabled cleanup effect and 5s timer are gone), fixing ghost messages and unbounded buffer growth. (#220)
+- **Gateway failures no longer masquerade as an empty chat.** All gateway/dashboard HTTP helpers carry 10s timeouts, and `/api/history` returns 503 instead of HTTP 200 with `messages: []` when the fetch fails — cached history stays visible. (#217)
+- **Composer busy state could go stale.** Now a reactive store subscription instead of a non-subscribing `getState()` read; dead legacy computation removed. (#219)
+- **MessageItem stale renders.** The memo comparator now covers `attachedToolMessages` and `isLastAssistant`. (#222)
+- **Plugin registration sent version `unknown`.** `require()` is unavailable in the Vite SSR runtime; the version now comes from the `__APP_VERSION__` build-time define.
+
+### Performance
+
+- **Long threads render windowed.** Threads over 80 entries render the last 60 plus a "Show N earlier messages" expander (search auto-expands; the pinned group never collapses). (#213)
+- **Poller/timer consolidation.** The 3s live-progress poll skips while SSE is connected; the approvals poll backs off 2s→20s when idle; all tool-card timers derive from at most 3 shared tickers (was ~2 per card); `session-status` caches `getConfig` for 30s. (#214)
+- **chat-store hot path.** Messages append in order with a sort only on detected out-of-order arrival (WeakMap-cached event times); streaming state persists per-session debounced instead of per-token; the internal-message filter is unified. (#221)
+- **In-stream live-tool poll widened 800ms→1500ms**; gateway `since`/`offset` pagination tracked in #215/#216.
+- **Idle network traffic cut ~5×.** `/api/sessions` poll 5s→30s (~400KB per tick) and gateway activity poll 3s→10s. (#225)
+
 ## [2.3.43] — 2026-06-11
 
 Dynamic website version badge and sidebar last-activity ordering.

commit fb5668bd0c5c8fbc7c3d6bef31ffc08fe3cd558a
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Thu Jun 11 08:46:14 2026 +0200

    Release v2.3.43 — dynamic version badge + sidebar last-activity ordering
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 3d9d1162..ee410511 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,18 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.43] — 2026-06-11
+
+Dynamic website version badge and sidebar last-activity ordering.
+
+### Added
+
+- **Marketing-site version badge is now fetched at runtime.** It was baked at build time via the `PUBLIC_SITE_VERSION` vite define, so it froze at the last deployed version until a manual rebuild+rsync. It now mirrors the GitHub-stars badge: the build-baked value renders initially (no flash, works without JS), then the nav pill, hero badge, and footer are patched from `GET /repos/Interstellar-code/hermes-switchui/releases/latest` (`tag_name`), sessionStorage-cached for 10 minutes to respect the unauthenticated rate limit. The badge now tracks the latest GitHub release with no site redeploy. (The hero terminal boot line stays build-baked — it animates before any API round-trip resolves.)
+
+### Fixed
+
+- **Resumed chats now jump to "Today" in the V2 sidebar on send.** The sidebar already buckets by `last_active`, but nothing refetched the feed after a send, so a resumed older session stayed in its old date group for the 30s stale window until an incidental refetch. The feed is now invalidated in the stream-end handler so it reorders the moment the assistant response completes, plus a 60s background refetch so sessions resumed from external clients (cron/cli/a2a) reorder too.
+
 ## [2.3.42] — 2026-06-11
 
 Matrix3D agent-activity reliability and 3D-canvas/console-error fixes.

commit 4c8611c6afa743f179cedfe65aafd3d3aff269da
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Thu Jun 11 00:48:48 2026 +0200

    Release v2.3.42 — Matrix3D activity sync + WebGL/kanban console fixes
    
    Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 2725a555..3d9d1162 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,16 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.42] — 2026-06-11
+
+Matrix3D agent-activity reliability and 3D-canvas/console-error fixes.
+
+### Fixed
+
+- **Matrix3D crew characters now reflect real per-agent activity.** The tier-2 characters (MORPHEUS/NEO/TRINITY) were stuck out of sync because all three legacy "working" signals were dead: the gateway never supported `?profile=` session filtering, the `delegate_task` payload carries no agent identity (so the `"you are <name>"` heuristic never matched), and name-fuzzy matching scored zero against UUID session keys. Crew activity is now derived from per-profile `state.db` ground truth (recent `messages.timestamp` within a 180s window, `ended_at`-guarded, ms-normalized) plus a deterministic, stable avatar assignment of active delegated child sessions (`src/lib/crew-delegation.ts`). Working agents without an open UI stream now route to a desk with their own task text instead of replaying the main agent's bubble. This is an interim DB-backed fix; the push-based replacement is tracked in #202 / hermes-agent#132.
+- **3D office no longer loses its WebGL context.** `canvasResetKey` fed the `<Canvas>` React key from frequently-changing reactive values (`agents.length`, `gatewayStatus`, `officeCenterSignal`), so every agent-count change, gateway reconnect, or recenter destroyed and remounted the Three.js renderer — exhausting the browser's ~16 WebGL-context cap and throwing `THREE.WebGLRenderer: Context Lost`. The key is now just `remoteOfficeEnabled`; recenter keeps working through its existing imperative `useEffect`. (#203)
+- **Kanban boards no longer 503 on archived queries.** `GET /api/hermes-kanban/boards?include_archived=true` returned a 503 on every call (~5s) even though the upstream dashboard answered 200 in ~31ms. The `kanbanFetch` 5s `AbortSignal` was shorter than the worst-case double HTML-scrape auth retry (2×`PROBE_TIMEOUT_MS` = 6s), so the abort fired mid-auth and a synthetic 503 was returned. Raised to `KANBAN_FETCH_TIMEOUT_MS = 12_000`; fast calls are unaffected. (#205)
+
 ## [2.3.41] — 2026-06-10
 
 Expose the new Plugins docs on the marketing/Starlight site.

commit 9a8a478f139ea76b6642ae6df228393104278b25
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Wed Jun 10 17:42:51 2026 +0200

    Release v2.3.41 — expose Plugins docs on the Starlight site
    
    The marketing/docs site (website/) builds its Starlight pages from the
    repo docs/ via a glob loader plus a manual sidebar; neither included the
    new plugins/ tree, so the Plugins section was absent from the deployed
    docs. Add plugins/** to the content glob and a Plugins sidebar group
    (after MCP). The Matrix Coder diagram renders via the existing
    docs-asset -> docs-assets iframe rewrite.
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index f4e2c9c1..2725a555 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,14 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.41] — 2026-06-10
+
+Expose the new Plugins docs on the marketing/Starlight site.
+
+### Fixed
+
+- **Plugins docs now appear on the deployed docs site.** The Astro Starlight site (`website/`) sources pages from the repo `docs/` via a glob loader and a manual sidebar — neither included the new `plugins/` tree, so the section was missing from `hermes-switchui.zi0n.space/docs`. Added `plugins/**` to the content glob (`website/src/content.config.ts`) and a Plugins group (after MCP) to the Starlight sidebar (`website/astro.config.mjs`). The Matrix Coder intent-detection diagram renders via the existing `/api/docs-asset` → `/docs-assets` iframe rewrite.
+
 ## [2.3.40] — 2026-06-10
 
 Docs plugins section, plus a website version-display fix.

commit 745dab0d5ced17f1e11f899f5b9fa64897298f34
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Wed Jun 10 13:33:46 2026 +0200

    Release v2.3.40 — docs plugins section + website version fix
    
    Add a Docs > Plugins section documenting the four bundled Hermes Agent
    plugins (A2A Fleet, Workflow Engine, Lazy Load MCP, Matrix Coder),
    including a Matrix Coder intent-detection diagram and explainer.
    
    Fix website version display: astro.config.mjs had duplicate vite keys,
    so the PUBLIC_SITE_VERSION define never applied and labels froze at a
    literal. Merge the blocks so the site tracks package.json.
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 30291c6e..f4e2c9c1 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,19 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.40] — 2026-06-10
+
+Docs plugins section, plus a website version-display fix.
+
+### Fixed
+
+- **Website version now updates with every release.** `website/astro.config.mjs` had two `vite:` keys in the same config object; the second silently overwrote the first, so the `PUBLIC_SITE_VERSION` `define` never applied and every site label fell back to a frozen literal (`2.3.38`). The blocks are merged, so the nav badge, hero badge, install terminal, and footer now reflect the real package version.
+
+### Added
+
+- **Docs › Plugins section.** A dedicated Plugins group in the docs sidebar (after MCP) documenting the four custom Hermes Agent plugins bundled with Switch UI: A2A Fleet, Workflow Engine, Lazy Load MCP, and Matrix Coder.
+- **Matrix Coder intent-detection docs + diagram.** The Matrix Coder page now explains how the `pre_llm_call` hook decides whether a specialist persona activates (explicit trigger ▸ implicit inference ▸ no-op), with an architecture diagram of the full routing path.
+
 ## [2.3.39] — 2026-06-10
 
 Cron run-history reliability release.

commit caeebf431fde617aa72be7f13d6ce0b389e2ac2c
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Wed Jun 10 11:13:10 2026 +0200

    Release v2.3.39
    
    Cron run-history reliability: JSON-body mutations, delete routing,
    run/chat sync, graceful /runs fallback, run-ID linking.
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index e488ab19..30291c6e 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,21 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.39] — 2026-06-10
+
+Cron run-history reliability release.
+
+### Fixed
+
+- **Cron job mutations send a valid JSON body.** Bodyless POSTs (e.g. "Run now") now send `{}` so SwitchUI's `application/json` CSRF check no longer rejects them with a Content-Type error.
+- **Cron deletes reach the jobs backend.** Delete requests are routed to the gateway jobs endpoint instead of failing silently.
+- **Cron run history stays in sync with linked chats.** The detail drawer and the dashboard-backed history now read from the same `/api/cron/jobs/:id/runs` source instead of disagreeing.
+
+### Changed
+
+- **Cron history falls back gracefully when `/runs` is unavailable.** When the gateway only advertises `/api/cron/jobs` (no `/runs` endpoint), the jobs page surfaces the latest run from job detail instead of showing nothing.
+- **Cron run sessions are named from their jobs and linked by run ID.** Run history and session search resolve cron chats by discovered `chatSessionKey` first, then fall back to `cron_<jobId>_<timestamp>` IDs, so runs link to the right conversation.
+
 ## [2.3.38] — 2026-06-10
 
 Version alignment release for the website/docs deployment.

commit cb470866db9c5d26fe1b3c77acedb0bdd0f2ce9b
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Wed Jun 10 02:30:31 2026 +0200

    Align release metadata around the deployed website
    
    Make the deployed website version derive from the root package version and publish this consistency fix as the next patch release.
    
    Constraint: Existing v2.3.37 tag is already published, so the alignment work must be a new patch instead of retagging history.
    
    Rejected: Move v2.3.37 tag | published tags should remain immutable.
    
    Confidence: high
    
    Scope-risk: narrow
    
    Directive: Future website builds should inherit the root package version through astro.config.mjs, not a hard-coded fallback.
    
    Tested: pnpm build; standalone website npm run build; live Virtualmin deploy verified nav v2.3.38 and no stale v2.3.29/v2.3.27 strings.
    
    Not-tested: GitHub self-hosted deploy workflow remains runner-queued, so deployment was performed directly with rsync.

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 4e5ff666..e488ab19 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,15 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.38] — 2026-06-10
+
+Version alignment release for the website/docs deployment.
+
+### Fixed
+
+- **Website version display now follows the root package version for direct Astro builds.** `website/astro.config.mjs` reads the root `package.json` and injects `PUBLIC_SITE_VERSION`, so standalone Virtualmin deployments no longer fall back to stale hard-coded labels.
+- **GitHub release/version drift is resolved.** This patch becomes the canonical latest release after the website/docs Matrix styling deployment, keeping package metadata, the live website badge, git tag, and GitHub Releases aligned.
+
 ## [2.3.37] — 2026-06-10
 
 Astro/Starlight docs rendering is cleaner for authoring examples and starts with a quieter sidebar.

commit 88ec1d64ae0bec8088d5e6a21c57aef99a881000
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Wed Jun 10 00:40:19 2026 +0200

    Keep website docs navigation within its base
    
    Constraint: Embedded website docs run under SITE_BASE=/website while Starlight also emits base-aware hrefs.\nRejected: Prefix every Starlight href blindly | It creates /website/docs/website/<slug> links and breaks navigation.\nConfidence: high\nScope-risk: narrow\nDirective: Strip the existing Astro base before adding the website docs prefix.\nTested: SITE_BASE=/website npm run build; Playwright loaded /website/docs/main/chat/ with HTTP 200 and no /website/docs/website links; root pnpm build.\nNot-tested: Manual click-through of every generated sidebar item.

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 87a5b6d2..4e5ff666 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,17 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.37] — 2026-06-10
+
+Astro/Starlight docs rendering is cleaner for authoring examples and starts with a quieter sidebar.
+
+### Fixed
+
+- **Markdown image examples in the website docs authoring guide no longer look like broken images.** The authoring guide now keeps the `![alt](...)` examples inside valid markdown code fences, so Starlight renders them as examples instead of attempting to interpret them as content.
+- **The Mermaid authoring sample is now a proper fenced-code example again.** The instructional Mermaid block is displayed as markdown source, while the separate rendered example continues to become an SVG diagram.
+- **Website docs sidebar groups default to collapsed.** Starlight sidebar groups are now generated with `collapsed: true`, so `/website/docs/...` loads with a compact left navigation instead of every group expanded.
+- **Website docs sidebar links no longer double-prefix the site base.** Starlight already includes the Astro `SITE_BASE` in generated hrefs, so the docs prefixer now strips that base before adding `/docs`; links now resolve to `/website/docs/<slug>/` instead of `/website/docs/website/<slug>/`.
+
 ## [2.3.36] — 2026-06-09
 
 Website docs now stay inside the embedded `/website/docs/...` Starlight preview and render diagrams with more usable horizontal space.

commit 6732cb015dc01fd849661465d6f66ff32c677975
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Wed Jun 10 00:17:10 2026 +0200

    Keep embedded website docs self-contained and readable
    
    Constraint: App docs stay at /docs while the embedded website preview must keep its own /website/docs Starlight rendering.\nRejected: Route website docs links back into Switch UI /docs | That bypasses Starlight and recreates the user-reported context jump.\nConfidence: high\nScope-risk: moderate\nDirective: Keep website docs URLs and static assets base-aware for both / and /website deployments.\nTested: SITE_BASE=/website pnpm build in website; root pnpm build; Playwright smoke for /website/docs/getting-started/authoring-docs/ confirmed wide iframe, narrow TOC, Mermaid SVG, and zero console errors.\nNot-tested: Full manual visual pass across every generated docs page.

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 213c182c..87a5b6d2 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,19 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.36] — 2026-06-09
+
+Website docs now stay inside the embedded `/website/docs/...` Starlight preview and render diagrams with more usable horizontal space.
+
+### Added
+
+- **Mermaid diagrams render in the Astro/Starlight docs build.** The website build ships a local Mermaid runtime under the site base, rewrites Mermaid fences into client-rendered diagram containers, and includes a live rendered example in the docs authoring guide.
+
+### Fixed
+
+- **Website Docs navigation no longer jumps to the Switch UI app docs.** Website docs links, sidebar entries, docs asset URLs, and the docs index redirect are base-aware, so the embedded preview keeps navigation under `/website/docs/...`.
+- **Large embedded HTML diagrams have more room in Starlight.** The generated docs page now narrows the right table-of-contents rail to match the left sidebar and expands the main content area, so iframe diagrams render at a much wider viewport.
+
 ## [2.3.35] — 2026-06-09
 
 Website/docs split is now clean: app docs stay at `/docs`, the Astro site builds from the root `docs/` tree, and the embedded `/website` preview works again inside Switch UI.

commit 64fea3533310bf98b1f75395b588a48313e184f1
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 23:39:47 2026 +0200

    Keep docs and website previews usable without duplicating content
    
    Constraint: Switch UI must keep in-app /docs and /website usable while the canonical docs source remains the repo-root docs/ tree
    Rejected: remove /website from Switch UI entirely | convenient embedded preview was explicitly required
    Confidence: high
    Scope-risk: moderate
    Directive: build embedded website assets with SITE_BASE=/website or module script paths will regress to HTML fallbacks
    Tested: SITE_BASE=/website pnpm --dir website build; pnpm vitest run src/router-route-resolution.test.ts src/routes/api/-docs-asset.test.ts src/server/docs-render.test.ts src/server/docs-content.test.ts; live check of /website/_astro/page.*.js content-type
    Not-tested: full repo typecheck remains noisy from unrelated pre-existing errors

diff --git a/CHANGELOG.md b/CHANGELOG.md
index a1e2b250..213c182c 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,20 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.35] — 2026-06-09
+
+Website/docs split is now clean: app docs stay at `/docs`, the Astro site builds from the root `docs/` tree, and the embedded `/website` preview works again inside Switch UI.
+
+### Added
+
+- **Website docs now use the repo-root `docs/` folder as their single source of truth.** Starlight loads the canonical markdown from `docs/`, builds website docs under `/docs/...`, and syncs diagrams/images/screenshots into static `/docs-assets/...` so the website no longer depends on app-only `/api/docs*` endpoints.
+
+### Fixed
+
+- **Embedded `/website` preview inside Switch UI was broken by wrong asset base paths.** The Astro build was emitting module URLs that did not line up with the app-served `/website/...` route, so the browser fetched HTML instead of JavaScript and failed strict MIME checks. `build:website` now builds with `SITE_BASE=/website`, and the embedded preview serves JS from `/website/_astro/...` correctly again.
+- **Website docs duplicated both `/docs/...` and root-level doc routes.** Postbuild cleanup now removes the duplicate root doc outputs after Starlight generation, rewrites sitemap entries, and rebuilds Pagefind from the cleaned `dist` so the public website exposes only `/docs/...`.
+- **Some canonical docs pages could not be loaded by Starlight.** Missing frontmatter was added to the remaining markdown files that lacked required `title`/`description` metadata, and unsupported fenced `env` blocks were normalized so the shared root docs tree builds cleanly in the website pipeline.
+
 ## [2.3.34] — 2026-06-09
 
 Regression fix: Task sessions disappeared from the sidebar after the 2.3.33 CLI/A2A change.

commit c84fd7197fc1632f41cd2bb6fca69d42decbcf41
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 22:41:04 2026 +0200

    chore: bump version to 2.3.34 + changelog
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index d9e1dfa1..a1e2b250 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,15 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.34] — 2026-06-09
+
+Regression fix: Task sessions disappeared from the sidebar after the 2.3.33 CLI/A2A change.
+
+### Fixed
+
+- **Task chip went empty after 2.3.33.** The CLI/A2A classifier branches were evaluated before the `isTaskTriggered` heuristic, so kanban-task sessions that run via the CLI (source `cli`) were reclassified out of the Task chip into CLI. `task` is a heuristic overlay that can ride on any source, so it is now checked before `cli`/`a2a` (still after telegram/cron/api). Task sessions are back; only non-task CLI/A2A land in the new chips.
+- Hardening: extracted the classifier into an exported pure `classifySessionSource()` and deleted the test's drifted copy (which had silently kept the old order and asserted the bug). The test now exercises the real classifier, so this regression can't pass green again.
+
 ## [2.3.33] — 2026-06-09
 
 CLI and A2A sessions are first-class in the sidebar, more session types are deletable, and console noise is gone.

commit 402c91d778716d2c84d9550d0188fedaa0140b4d
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 22:31:32 2026 +0200

    chore: bump version to 2.3.33 + changelog
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 6f6e8f79..d9e1dfa1 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,24 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.33] — 2026-06-09
+
+CLI and A2A sessions are first-class in the sidebar, more session types are deletable, and console noise is gone.
+
+### Added
+
+- **CLI and A2A sessions are now first-class sources.** Sessions started from the Hermes CLI (`cli`, 116) and A2A fleet runs (`a2a_fleet`, 55) were classified into the generic "chat" bucket — reachable but indistinguishable and unfilterable. They now have their own classifier branches and sidebar chips (CLI teal, A2A violet) with rail colors, matching how Telegram/API are handled.
+
+### Fixed
+
+- **Delete was unavailable for Telegram, CLI, and A2A sessions.** The row context menu gated Delete/Rename on a stale allowlist (`chat`/`cron`/`api`/`task`) that omitted `tg`, `cli`, and `a2a`, so those sessions offered only Archive. All are backed by ordinary gateway sessions and share the same `DELETE /api/sessions/<id>` path; the allowlist now includes them.
+- Removed a dead `s.key.startsWith('api-')` classifier fallback (no current session id uses that prefix).
+
+### Changed
+
+- Removed an unconditional `tap-debug` `console.info` that logged `[tap-debug:chat-main] toggle via overlay…` on every chat mount.
+- CI: the Docker publish workflow now frees ~25GB of unused preinstalled toolchains before buildx, preventing the intermittent `ResourceExhausted: no space left on device` failures at the image-export stage.
+
 ## [2.3.32] — 2026-06-09
 
 Telegram sessions are clickable, the updater stops false-nagging, and a dashboard console warning is gone.

commit bf99123edfbc13a9d71cd626841094680e592c06
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 22:00:29 2026 +0200

    chore: bump version to 2.3.32 + changelog
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index fed3595b..6f6e8f79 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,16 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.32] — 2026-06-09
+
+Telegram sessions are clickable, the updater stops false-nagging, and a dashboard console warning is gone.
+
+### Fixed
+
+- **In-app updater falsely offered updates (and could destroy local commits).** The updater advertised an update whenever local git HEAD differed from the remote HEAD — direction-blind — and showed the "local changes, commit/stash" block whenever the checkout was dirty, even with no update pending. On a checkout ahead of or diverged from origin this nagged constantly, and the offered update runs `git reset --hard origin/<branch>`, which would have destroyed unpushed local commits. An update is now offered only when local is strictly **behind** remote (local HEAD is an ancestor of the remote tip), and the dirty-block only appears when an update actually exists. Decision logic extracted into pure unit-tested helpers (`isUpdateAvailable`, `resolveUpdatePresentation`). Applies to both the Switch UI and Hermes Agent update paths.
+- **Telegram sessions were not clickable in the V2 sidebar.** `isChatItem` omitted `src === 'tg'`, so Telegram rows fell through to the non-clickable branch instead of the `<Link to="/chat/$sessionKey">`. They share the same chat key/route as every other source; adding `'tg'` makes them open normally.
+- **recharts `width(-1)/height(-1)` console warning on the dashboard.** recharts 3.x defaults `ResponsiveContainer` `initialDimension` to `{-1,-1}` for SSR; set `initialDimension={{width:1,height:1}}` on the initial-mount chart.
+
 ## [2.3.31] — 2026-06-09
 
 Embedded docs flow diagrams render again instead of downloading.

commit 210bc7918ea2ea9dba351e8776e6489aebc11581
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 21:21:21 2026 +0200

    chore: bump version to 2.3.31 + changelog
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 41867c20..fed3595b 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,16 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.31] — 2026-06-09
+
+Embedded docs flow diagrams render again instead of downloading.
+
+### Fixed
+
+- **Flow diagrams on `/docs` pages downloaded instead of rendering.** The security hardening in `6480a703` (#111) added a blanket `Content-Disposition: attachment` for `.html`/`.svg` served by `/api/docs-asset`, which also caught the first-party flow diagrams the docs embed via `<iframe src="/api/docs-asset?path=diagrams/*.html">`. The diagrams are static, in-repo, and script-free, so they are now served inline: `docs-asset.ts` exempts the `docs/diagrams/` subtree from force-download (tight CSP — no script source, inline + Google Fonts styling only — plus `X-Frame-Options: SAMEORIGIN`), and `docs-render.ts` rewrites the docs-asset iframes to carry `sandbox=""` + `referrerpolicy="no-referrer"`. Arbitrary `.html`/`.svg` anywhere else is still forced to download.
+
+Security posture unchanged for every path except the trusted `docs/diagrams/` subtree, which now renders inside a sandboxed iframe.
+
 ## [2.3.30] — 2026-06-09
 
 Gateway startup reliability: find the renamed `hermes` binary and honor a custom gateway port.

commit 2f43ff30c72aba34934edaae90a27e266420ae6b
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 20:00:00 2026 +0200

    chore: bump version to 2.3.30 + changelog
    
    Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 5f8e2590..41867c20 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,17 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.30] — 2026-06-09
+
+Gateway startup reliability: find the renamed `hermes` binary and honor a custom gateway port.
+
+### Fixed
+
+- **"hermes-agent not found" on fresh Interstellar installs.** `resolveClaudeBinary()` only looked for a `claude` binary under `~/.claude/bin` and `~/.local/bin`, but the Interstellar fork installer ships the gateway CLI as `hermes` (to `~/.hermes/bin` or `~/.local/bin`). A correctly installed gateway was reported missing and `startClaudeAgent()` returned the installer error. Resolution now checks the `hermes` locations first, keeps the legacy `claude` paths as a fallback, and finally does a `PATH` lookup (`hermes` then `claude`).
+- **Gateway connection failure on non-default ports.** The health probe and uvicorn fallback launch hardcoded port `8642`, so a gateway on any other port could not be detected. New `resolveGatewayPort()` / `resolveGatewayUrl()` derive the target in priority order: `HERMES_API_URL` / `CLAUDE_API_URL` → `API_SERVER_PORT` in `~/.hermes/.env` → default `8642`. `isClaudeAgentHealthy()` now probes the resolved base URL, so the health check matches where REST traffic already goes.
+
+Runtime-only change — no migration. Installs running the local agent on `8642` with no env override resolve to exactly the previous values and are unaffected.
+
 ## [2.3.29] — 2026-06-09
 
 Sidebar session delete reliability, Telegram session visibility, and chat source-tab counts.

commit 789a8ec2f64e2e921d43639a41cb62501be6a471
Author: Rohit Sharma <interstellar.consulting@gmail.com>
Date:   Tue Jun 9 15:45:01 2026 +0200

    chore: bump version to 2.3.29 + changelog
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 6f959de7..5f8e2590 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,20 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.29] — 2026-06-09
+
+Sidebar session delete reliability, Telegram session visibility, and chat source-tab counts.
+
+### Fixed
+
+- **Sidebar session delete now refreshes the list.** Deleting a session removed it on the backend but left the card visible, because the V2 sidebar renders from a separate TanStack Query cache (`['sessions-feed','chat','v3-task-split']`) than the delete mutation invalidated (`['chat','sessions']`). The feed key is now exported as `SESSIONS_FEED_KEY` and invalidated on mutate/error/success, with tombstone filtering for instant optimistic removal. The delete dialog no longer unmounts mid-request, and gateway-owned sessions (e.g. cron) the dashboard 404s now fall through to the gateway DELETE (404 treated as success).
+- **Telegram sessions now appear in the sidebar.** The feed classified sessions by key-prefix only, so timestamp-keyed Telegram rows fell into the `chat` bucket and the `tg` filter chip stayed empty. The feed now classifies by the authoritative gateway `source` field (`telegram → tg`); `source` is preserved through `normalizeSessions` and typed on `SessionMeta`; the TELEGRAM chip shows whenever it has items.
+
+### Changed
+
+- **Chat meta bar slimmed.** Removed the redundant total-token field (the context-window ring already shows it) and the api-call count.
+- **Source tabs show counts.** The chat / tool / skills tabs now display message, tool-invocation, and skill-invocation counts. Skill count uses a shared `countSkillEntries` helper so the badge and the skills tab agree.
+
 ## [2.3.27] — 2026-06-07
 
 Shadcn composer cutover at /chat + reply / queue / tool-display features.

commit d16643f90a5f4f339ae3e6ec9c09904206776fb5
Author: Interstellar-code <33978413+Interstellar-code@users.noreply.github.com>
Date:   Sun Jun 7 20:50:43 2026 +0200

    feat(chat): shadcn composer live cutover at /chat (#187) (#190)
    
    * chore(shadcn): scaffold composer primitives (Phase 1 setup)
    
    Add Radix deps (popover/tooltip/dialog) + cmdk, and generate shadcn
    popover/tooltip/dialog/command/input/textarea into src/components/shadcn/ui/.
    Isolated; no base-ui or chat-screen changes yet.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): add mock data fixtures for sandbox composer
    
    Static mock models (provider-grouped), session, context usage, slash/mention
    command lists, and reply target for the isolated /composer-preview sandbox.
    No stores or network — fixtures only.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): auto-growing textarea + send on shadcn
    
    Feature 1: auto-resizing Textarea composer with Enter-to-send /
    Shift+Enter-newline, send Button (shadcn primitives only). Mounts at the
    isolated /composer-preview dev route with a theme switcher proving the
    token bridge. Maps to operator1 chat-input PromptInputTextarea + send.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): slash + @ autocomplete popover
    
    Feature 2: caret-anchored autocomplete on shadcn Popover + Command. Walks
    back from the cursor to detect / or @ triggers (must start input or follow
    whitespace), filters mock command/mention lists, and supports keyboard nav
    (up/down/enter/tab/esc) intercepted before Enter-to-send. Maps to operator1
    autocomplete-menu detectTrigger/handleKeyDown/selectItem logic.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): image paste + file-picker attachments
    
    Feature 3: clipboard paste of images and a Paperclip file-picker button.
    Images are held as local base64 data-URL draft state and rendered as
    removable thumbnail chips above the input. Maps to operator1 chat-input
    handlePaste/handleFileSelect/addAttachments/removeAttachment.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): reply-to quoting chip
    
    Feature 4: a dismissible reply chip above the input shows the mock target;
    on send the outgoing message is prefixed with a > [Re: #seq] quote block.
    Maps to operator1 chat-input replyTo state + handleSubmit replyPrefix.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): message queue with start/stop/clear
    
    Feature 5: queue items list with add (ListPlus), start/stop running flag,
    clear, and per-item remove. Queue persists to localStorage. Maps to
    operator1 chat-input messageQueue/enqueueMessage/startQueue/stopQueue/
    clearQueue (local state instead of the chat store).
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): live context counter
    
    Feature 6: color-coded context usage readout (e.g. 38.0k / 1.1M) in the
    footer; muted under 60%, warns at 60%+, destructive at 85%+. Maps to
    operator1 chat-input ctxTokenUsed/ctxTotal/ctxRatio/fmtCtx.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): inline model + session badges row
    
    Feature 7: badge row above the input shows agent identity, role, session
    kind/channel, project, and a provider-grouped model selector popover with
    reasoning/vision markers; a compact model badge sits in the footer.
    shadcn Tooltip wraps toolbar affordances. Maps to operator1 session-badges
    SessionBadges/groupModelsByProvider + model selector dropdown.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer-shadcn): tool-display toggle
    
    Feature 8: footer button cycling tool display expanded -> collapsed ->
    hidden with distinct icon + label + muted state per mode. Maps to
    operator1 chat-input setToolDisplayMode cycle + tool-call-card modes.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer): add shadcn-composer feature flag (default OFF)
    
    localStorage-backed `switchui:shadcn-composer` flag + `useShadcnComposer()`
    hook. Defaults to false so the live composer stays the default with zero
    regression. Same-tab + cross-tab sync via custom + storage events.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer): real drop-in shadcn composer behind flag
    
    Promote the Phase 1 sandbox to a real ChatComposer drop-in sharing the exact
    ChatComposerProps/Handle/Helpers/Attachment contract (imported from the live
    composer). Owns no send/streaming logic — delegates to onSubmit/onAbort.
    
    Wires real switchui data sources: usePinnedModels, /api/models query, and
    useSessionModelStore for model selection; useVoiceInput/useVoiceRecorder for
    voice parity; real ContextBar and SlashCommandMenu. Auto-grow textarea,
    Enter-to-send/Shift+Enter newline, Stop while loading, paste/drag/file-pick
    attachments producing the live ChatComposerAttachment shape, and the
    ChatComposerHandle (setValue/insertText) via composerRef.
    
    Primitives only from @/components/shadcn/ui/* + lucide + cn; no @/components/ui/*
    and no hardcoded colors. Parity gaps (profiles/workspace menus, fast-mode,
    thinking-menu UI, web-search toggle, provider-switcher, mobile docking, image
    compression) are stubbed gracefully and flagged as TODO(parity).
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer): flag-gate composer swap at /chat mount site
    
    Swap the single ChatComposer element for a flag-gated conditional passing
    identical props to ChatComposerShadcn vs ChatComposer. Flag OFF (default) keeps
    the live composer behaviorally identical. Add a dev toggle on /composer-preview.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * chore(shadcn): drop unused ModelCatalogEntry import in shadcn composer
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * refactor(composer): export toolbar helpers for shadcn parity
    
    Add export keywords (additive only, no logic change) to the profile,
    workspace, thinking-level, and model-switch helpers/types so the shadcn
    composer can reuse them instead of duplicating behavior.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer): bring shadcn composer to toolbar parity
    
    Wire the six remaining live-composer toolbar controls into
    ChatComposerShadcn, reusing the same queries/mutations/stores/endpoints
    (helpers imported from chat-composer.tsx, which now exports them):
    
    - Profile menu: /api/profiles/list query + /api/profiles/activate
      mutation with the live cache-invalidation set + gateway-restart flag.
    - Workspace menu: /api/workspace GET query + POST select mutation.
    - Thinking-level menu: honors thinkingLevel prop + onThinkingLevelChange,
      with a Shift-click quick-cycle via nextThinkingLevel.
    - Fast-mode toggle: flows into onSubmit (effectiveFastMode gated by
      thinkingLevel === 'off'); /fast slash-command parity retained.
    - Web-search toggle: honors webSearchEnabled + onToggleWebSearch.
    - Live model switch: per-session persistence plus gateway switchModel()
      with the zero-fork block guard and an inline ModelSwitchNotice surface.
    
    Primitives stay within @/components/shadcn/ui/* + lucide; mutation
    feedback routes through the inline notice instead of @/components/ui
    toast to honor the no-@/components/ui import constraint.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(chat): make shadcn composer the default at /chat (drop flag)
    
    chat-screen renders ChatComposerShadcn directly; removed the feature-flag
    conditional + live ChatComposer render (file kept on disk for revert).
    Composer is at toolbar parity (profile/workspace/thinking/fast/web/model).
    Also drop dead closeAllMenus.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * fix(composer): restore bottom gap so composer isn't glued to screen edge
    
    Shadcn composer wrapper dropped the live composer's outer padding, docking
    it flush to the viewport bottom. Restore px-3 pt-2 pb-6 sm:px-5 md:pb-8 to
    match the original spacing.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * chore(composer): remove dead flag + sandbox preview after cutover
    
    ChatComposerShadcn is live at /chat, so the feature flag (feature-flags.ts),
    the /composer-preview dev route, and the throwaway composer-shadcn/ sandbox
    are all dead. Remove them; routeTree regenerated.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer): port image compression pipeline to shadcn composer
    
    Export compressImageToDataUrl, isCanvasSupported, MAX_ATTACHMENT_FILE_SIZE,
    IMAGE_QUALITY, MAX_IMAGE_DIMENSION, formatFileSize from chat-composer.tsx
    (additive export-only, no logic change). Wire them into the shadcn composer's
    buildAttachment: reject files >50 MB via the existing modelNotice inline banner,
    compress images via canvas when available, fall back to raw readFileAsDataUrl.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(chat): reply-to quote chip — click Reply on a message to quote it in composer
    
    Adds a Reply button to MessageActionsBar, threads onReplyMessage through
    MessageItem and ChatMessageList. The composer (next commit) will receive
    replyTo state and prepend a markdown blockquote on submit.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(composer): reply chip, system-message toggle, new-chat button
    
    Wires the three chat interaction features into the shadcn composer and
    chat-screen:
    
    Feature 1 (composer side): adds replyTo prop + dismissible chip above
    the textarea; on submit, prepends "> [Re: #N] preview" blockquote then
    calls onClearReply. Chat-screen lifts replyTo to state, clears on
    session change, and passes onReplyMessage into ChatMessageList.
    
    Feature 2: lifts hideSystemMessages to useState(true) in chat-screen;
    adds Eye/EyeOff toolbar button in the composer (ghost icon-sm, tooltip)
    wired to onToggleSystemMessages. Replaces the hardcoded boolean with
    the state variable on ChatMessageList.
    
    Feature 3: activates the previously _-prefixed onNewSession prop; adds
    a SquarePen toolbar button (ghost icon-sm, tooltip "New chat") that calls
    navigate({ to: '/', replace: true }) — reusing the existing new-chat
    navigation pattern in chat-screen.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * fix(composer): truncate reply quote to a clean single line
    
    Reply prepend dumped the full multi-line replied message into the bubble
    (wall of text; > only quoted line 1). Collapse whitespace + cap at 140 chars
    with ellipsis so it renders as one clean blockquote line.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * fix(composer): strip markdown from reply preview text
    
    Reply quote showed raw table pipes / headers from the replied message.
    Strip markdown structure so the quote snippet is clean prose.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * refactor(composer): relocate model/profile/workspace/thinking selectors to meta bar
    
    Move the 4 selector dropdowns out of the chat composer toolbar into the
    top LIVE·CTX·TOOLS·PROFILE meta row. The composer toolbar is now icons +
    context ring + send only; model-switching, profile/workspace activation,
    and thinking-level selection move to a new self-contained
    SessionSelectorsV2 component rendered by the meta bar.
    
    - new: v2/session-selectors-v2.tsx owns all 4 dropdowns + their queries,
      mutations, stores, the live switchModel flow with the zero-fork guard,
      and the ModelSwitchNotice surface.
    - chat-composer-shadcn.tsx: strip the 4 dropdown blocks + dead state /
      queries / mutations / imports. Keep thinkingLevel (read-only) for the
      fast-mode gate; drop onThinkingLevelChange + hideModelSelector props.
    - chat-meta-bar-v2.tsx: render <SessionSelectorsV2>, thread
      selectorSessionKey / thinkingLevel / onThinkingLevelChange / hideSelectors.
    - chat-screen.tsx: pass thinking props + selectorSessionKey to the meta
      bar; stop passing onThinkingLevelChange to the composer.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(chat): declutter meta bar + highlight relocated selectors
    
    - Remove read-only status from the top meta bar (tok/s, model echo, ctx%,
      token count, tools) — leaves LIVE · profile · selectors · session, and drops
      the confusing double model indicator (live echo vs the selector).
    - Accent the 4 relocated selector chips (accent border + subtle accent fill,
      text-[11px]) so they read as interactive controls, not blend into meta text.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(chat): redesign reply-reference as styled quote block, not raw markdown
    
    Strip the `> [Re: #N] snippet` marker from the rendered user bubble and
    replace it with a compact left-accent reply-reference block (bg-muted,
    border-l-2 border-primary, lucide CornerUpLeft icon) above the message
    body. Marker is kept in the outgoing text for LLM context and reload
    persistence. Composer reply chip restyled to match.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(chat): queue composer sends while streaming (cherry-pick b6132f07)
    
    Per-session persisted FIFO queue: stage sends during an active stream,
    drain FIFO as each response completes. Resolved composer conflicts from the
    selector-relocation refactor (dropped dead selector imports, kept queue).
    
    Native Hermes /queue is client-coordinated (returns {type:send} for the
    client to dispatch); this FIFO is functionally equivalent over REST+SSE.
    See memory project_native_queue_rest_gap.
    
    Tests: 17 pass (chat-store, chat-screen-utils, chat-message-list). Build green.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * fix(composer): make Add-to-queue button primary, not washed-out secondary
    
    variant secondary rendered as muted gray-green on matrix dark, looked
    disabled. Queueing is the primary action while streaming, so use the
    bright primary variant matching the send button.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * feat(chat): tool-display 3-state toggle on live composer
    
    Wires the operator1 toolDisplayMode cycle into the live ChatComposerShadcn
    and message rendering. The previous sandbox commit (bd1dfc7e) was on the
    sandbox composer that was deleted at cutover (09030be0), so the feature
    was re-applied to the live composer path.
    
    - message-item.tsx: rename expandAllToolSections?: boolean ->
      toolDisplayMode?: ToolDisplayMode (expanded | collapsed | hidden). Hidden
      skips the tool section render entirely; expanded forces expandAll; collapsed
      uses the existing per-section state.
    - chat-screen.tsx: toolDisplayMode state + localStorage persistence under
      switchui:tool-display-mode; cycleToolDisplayMode useCallback handler
      (expanded -> collapsed -> hidden -> expanded). Threaded through to
      ChatMessageList and ChatComposerShadcn.
    - chat-message-list.tsx: accepts toolDisplayMode, plumbs it to MessageItem,
      renders an inline per-message label when hidden.
    - chat-composer-shadcn.tsx: new footer Button that cycles the mode
      (ListTree / ListCollapse / Wrench icons per state) with tooltip and
      aria-pressed. Only renders when onCycleToolDisplayMode is wired.
    
    No behavior change when toggle is at default 'collapsed'.
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    * chore(release): v2.3.27 — shadcn composer cutover at /chat + reply/queue/tool-display
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    
    ---------
    
    Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>

diff --git a/CHANGELOG.md b/CHANGELOG.md
index 352b6763..6f959de7 100644
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,36 @@
 All notable changes to Switch UI are documented here.
 The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
 
+## [2.3.27] — 2026-06-07
+
+Shadcn composer cutover at /chat + reply / queue / tool-display features.
+
+### Added
+
+- **shadcn/ui is now the default chat composer at `/chat`** (#187, #189). The base-ui `ChatComposer` has been replaced by a new `ChatComposerShadcn` that reuses the same `ChatComposerProps` / `Handle` / `Helpers` / `Attachment` contract and delegates all send/streaming logic to `chat-screen`. Coexistence guardrail holds: shadcn lives only under `src/components/shadcn/ui/`, base-ui stays under `src/components/ui/`, and all shadcn primitives inherit the 13-theme palette via the `--theme-*` token bridge in `src/styles.css`. Phase 0 (`feat(ui): shadcn/ui Phase 0 — isolated coexistence + token bridge`) and Phase 1 plan executed end-to-end (see `.omc/plans/shadcn-adoption.md`).
+- **Tool-display 3-state toggle.** A new footer button on the composer cycles tool-section visibility `expanded → collapsed → hidden` (with a distinct icon + label + muted styling per mode). State is persisted to `localStorage` under `switchui:tool-display-mode` and per-message rendering skips the entire tool-section block in `hidden` mode. Maps to the operator1 `setToolDisplayMode` cycle.
+- **Reply-to quote.** A new `Reply` button on `MessageActionsBar` quotes the target message into the composer; outgoing messages are prepended with a styled `> [Re: #N]` blockquote (left-accent `border-l-2 border-primary`, `CornerUpLeft` icon) — the raw marker is kept in the outgoing text for LLM context and reload persistence.
+- **Reply chip + system-message toggle + new-chat button.** Dismissible reply chip above the textarea; `Eye`/`EyeOff` toolbar button hides system messages; `SquarePen` toolbar button issues a `navigate({ to: '/', replace: true })` new-chat.
+- **Queue composer sends while streaming.** Per-session persisted FIFO queue: stage sends during an active stream, drain FIFO as each response completes. The native Hermes `/queue` is client-coordinated and returns `{type:send}` over REST+SSE, so this client-side FIFO is functionally equivalent.
+- **Toolbar parity** on `ChatComposerShadcn`: profile, workspace, thinking-level (with Shift-click quick-cycle), fast-mode, web-search, and live model switch (per-session persistence + gateway `switchModel` with the zero-fork guard). Reuses the live composer's exported helpers/types — no behavior duplication.
+- **Cherry-picked sandbox composer features** (now live in the cutover composer): auto-growing textarea with Enter-to-send / Shift+Enter-newline, caret-anchored slash (`/`) + `@` autocomplete popover (shadcn `Popover` + `Command`), image paste + file-picker attachments (with thumbnail chips), reply-to chip, message queue with start/stop/clear (persisted to `localStorage`), color-coded live context counter, and an inline agent + session badges row with a provider-grouped model selector popover.
+- **shadcn composer primitives** under `src/components/shadcn/ui/`: `button`, `popover`, `tooltip`, `dialog`, `command`, `input`, `textarea` (all generated via `shadcn@4.10.0`). Radix deps (`@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `@radix-ui/react-dialog`) and `cmdk` installed as direct dependencies.
+
+### Changed
+
+- **Selectors relocated from composer toolbar to meta bar.** Model / profile / workspace / thinking dropdowns moved out of `ChatComposerShadcn` into a new self-contained `SessionSelectorsV2` component rendered by the meta bar. Composer toolbar is now icons + context ring + send only. The meta bar now highlights the 4 relocated selector chips with an accent border + subtle accent fill so they read as interactive controls, and drops the read-only status (tok/s, model echo, ctx%, token count, tools) to remove the confusing double model indicator. The composer still owns thinking-level (read-only) for the fast-mode gate.
+- **Reply reference redesigned** as a styled quote block (bg-muted, `border-l-2 border-primary`, `CornerUpLeft` icon) above the message body instead of being inlined as raw `> [Re: #N]` markdown.
+- **Composer image compression pipeline ported** to `ChatComposerShadcn` (helpers exported from the live composer; 50 MB size cap, canvas compression with graceful fallback).
+- **Sandbox composer artifacts removed** at cutover: the `switchui:shadcn-composer` feature flag, the `/composer-preview` dev route, and the `composer-shadcn/` sandbox directory are deleted (route tree regenerated). The previous `ChatComposer` is kept on disk for revert only.
+
+### Fixed
+
+- **Runtime `React is not defined` at `/chat`** — the tool-display toggle wiring used `React.useCallback` against an unimported `React` global; switched to the already-imported named `useCallback`, and added the missing `ToolDisplayMode` type import.
+- **Add-to-queue button rendered as washed-out `secondary` on Matrix dark** — the button uses `primary` variant to match the send button, since queueing is the primary action while streaming.
+- **Composer docked flush to viewport bottom** — restored outer padding `px-3 pt-2 pb-6 sm:px-5 md:pb-8` so the composer has the same bottom gap as the original.
+- **Reply preview showed raw markdown** — table pipes / headers stripped so the quote snippet reads as clean prose.
+- **Reply quote dumped the full multi-line message** — collapsed whitespace and capped at 140 chars with ellipsis so it renders as one clean blockquote line.
+
 ## [2.3.26] — 2026-06-05
 
 Website served in-app.
```

## DOCS INVENTORY

### Markdown/docs files touched in window

- .omc/plans/hermes-dep-post-messages-endpoint.md
- .omc/plans/open-questions.md
- .omc/plans/shadcn-adoption.md
- .omc/plans/unify-chat-state-architecture.md
- .omc/releases/v2.3.28.md
- .omc/releases/v2.3.29.md
- .omc/releases/v2.3.44.md
- CHANGELOG.md
- docs/deployment/unraid.md
- docs/diagrams/docs-authoring-pipeline.html
- docs/diagrams/matrix-coder-intent-detection.html
- docs/docs-manifest.yaml
- docs/getting-started/authoring-docs.md
- docs/getting-started/connecting-provider.md
- docs/how-to/connect-hermes-to-telegram-and-configure-topics.md
- docs/how-to/use-the-manifest-provider-to-reduce-llm-costs.md
- docs/plans/self-improve-ux-redesign-210.md
- docs/plugins/a2a-fleet.md
- docs/plugins/lazy-load-mcp.md
- docs/plugins/matrix-coder.md
- docs/plugins/overview.md
- docs/plugins/workflow-engine.md
- docs/self-improving-agent-proposal.md
- docs/settings/workflows-backend-toggle.md
- docs/troubleshooting/agent-connect.md
- docs/troubleshooting/telegram.md

### Full current docs tree (all .md files)

- .claude/worktrees/agent-a2e0df1107521c40d/AGENTS.md
- .hermes-audit/00-context.md
- .hermes/A2A.md
- .omc/RELEASE_RULE.md
- .omc/plans/conductor-cleanout.md
- .omc/plans/hermes-dep-post-messages-endpoint.md
- .omc/plans/hermes-plugin-section-228.md
- .omc/plans/legacy-tasks-cleanup.md
- .omc/plans/matrix3d-sync-fix.md
- .omc/plans/open-questions.md
- .omc/plans/operations-cleanout.md
- .omc/plans/phase2-batch-1-3.md
- .omc/plans/sessions-sidebar-phase1-audit.md
- .omc/plans/sessions-sidebar-phase3a-callers.md
- .omc/plans/sessions-sidebar.md
- .omc/plans/shadcn-adoption.md
- .omc/plans/swarm-removal.md
- .omc/plans/unify-chat-state-architecture.md
- .omc/plans/workflow-plugin-refactor.md
- .omc/plans/workflows-audit-map.md
- .omc/plans/workflows-audit-review.md
- .omc/plans/workflows-audit-verify.md
- .omc/releases/v2.3.28.md
- .omc/releases/v2.3.29.md
- .omc/releases/v2.3.30.md
- .omc/releases/v2.3.31.md
- .omc/releases/v2.3.32.md
- .omc/releases/v2.3.33.md
- .omc/releases/v2.3.34.md
- .omc/releases/v2.3.44.md
- .omc/releases/v2.3.45.md
- .omc/releases/v2.3.46.md
- .omc/specs/board-templates/SPEC.md
- .omc/specs/board-templates/WIZARD.md
- .omc/specs/workflow-plugin-cutover/README.md
- .omc/specs/workflow-plugin-cutover/phase-0-gateway-cancel.md
- .omc/specs/workflow-plugin-cutover/phase-1-plugin-client-audit.md
- .omc/specs/workflow-plugin-cutover/phase-2-default-plugin.md
- .omc/specs/workflow-plugin-cutover/phase-3-delete-native.md
- .omc/v1-audit.md
- .omx/notepad.md
- .omx/plans/commands-backend-sidebar-delta.md
- .omx/state/sessions/omx-1777718517156-lrdx1l/AGENTS.md
- .serena/memories/memory_maintenance.md
- .serena/memories/verification-preferences.md
- AGENTS.md
- CHANGELOG.md
- CLAUDE.md
- CONTRIBUTING.md
- FEATURES-INVENTORY.md
- FUTURE-FEATURES.md
- README.md
- SECURITY.md
- assets/personas/curated/design-system-curator.md
- assets/personas/curated/design-ux-architect.md
- assets/personas/curated/devops-automator.md
- assets/personas/curated/devops-incident-response-commander.md
- assets/personas/curated/engineering-backend-architect.md
- assets/personas/curated/engineering-code-reviewer.md
- assets/personas/curated/engineering-security-engineer.md
- assets/personas/curated/engineering-software-architect.md
- assets/personas/curated/product-senior-project-manager.md
- assets/personas/curated/product-sprint-prioritizer.md
- assets/personas/curated/research-data-scientist.md
- assets/personas/curated/research-researcher.md
- assets/personas/curated/testing-qa-engineer.md
- assets/personas/curated/testing-test-strategist.md
- assets/personas/curated/writing-doc-curator.md
- assets/personas/curated/writing-technical-writer.md
- docs/Design Assets/Hermes-Switchui/uploads/persona-driven-agent-system.md
- docs/_rebrand-flags.md
- docs/_screenshot-index.md
- docs/_shared-terms.md
- docs/demo-checklist.md
- docs/deployment/unraid.md
- docs/faq.md
- docs/getting-started/authoring-docs.md
- docs/getting-started/connecting-provider.md
- docs/getting-started/first-chat.md
- docs/getting-started/install.md
- docs/getting-started/theme.md
- docs/help/docs.md
- docs/how-to/connect-hermes-to-telegram-and-configure-topics.md
- docs/how-to/give-your-agent-long-term-memory-with-hindsight.md
- docs/how-to/use-the-manifest-provider-to-reduce-llm-costs.md
- docs/knowledge/memory.md
- docs/main/boards.md
- docs/main/chat.md
- docs/main/chat/composer.md
- docs/main/chat/context-window.md
- docs/main/chat/files.md
- docs/main/chat/sessions.md
- docs/main/chat/shortcuts.md
- docs/main/chat/slash-commands.md
- docs/main/conductor.md
- docs/main/dashboard.md
- docs/main/files.md
- docs/main/jobs.md
- docs/main/matrix3d.md
- docs/main/operations.md
- docs/main/tasks.md
- docs/main/terminal.md
- docs/main/workflows.md
- docs/main/workflows/editing.md
- docs/main/workflows/output.md
- docs/main/workflows/overview.md
- docs/main/workflows/running.md
- docs/plans/archon-engine-db-schema.md
- docs/plans/archon-engine-research.md
- docs/plans/archon-hermes-integration.md
- docs/plans/archon-plan-codex-review.md
- docs/plans/archon-workflows-research.md
- docs/plans/boards-page-plan.md
- docs/plans/central-agent-project-model.md
- docs/plans/conductor-cleanout.md
- docs/plans/conductor-ui-implementation.md
- docs/plans/docs-page-port.md
- docs/plans/matrix3d-page.md
- docs/plans/matrix3d-phase3-orchestration.md
- docs/plans/operations-cleanout.md
- docs/plans/operations-ui-implementation.md
- docs/plans/persona-driven-agent-system.md
- docs/plans/self-improve-ux-redesign-210.md
- docs/plans/specs/archon-A.0-stubs.md
- docs/plans/specs/archon-A.1-a-executor.md
- docs/plans/specs/archon-A.1-b-schemas-validation.md
- docs/plans/specs/archon-A.1-c-wiring.md
- docs/plans/specs/archon-A.1.1-engine-store.md
- docs/plans/specs/archon-A.3-kanban-dispatcher.md
- docs/plans/specs/archon-A.7-subgraphs.md
- docs/plans/specs/archon-A.8-phase-wrapper.md
- docs/plans/switch-coding-capability-analysis.md
- docs/plans/unified-kanban-task-system.md
- docs/plans/workflow-db-single-source-of-truth.md
- docs/plans/workflow-hermes-plugin.md
- docs/plans/workflow-kanban-contract.md
- docs/plans/workspace-rebrand-audit.md
- docs/plugins/a2a-fleet.md
- docs/plugins/lazy-load-mcp.md
- docs/plugins/matrix-coder.md
- docs/plugins/overview.md
- docs/plugins/workflow-engine.md
- docs/self-improving-agent-proposal.md
- docs/settings/mcp.md
- docs/settings/mcp/connecting.md
- docs/settings/mcp/installing.md
- docs/settings/preferences.md
- docs/settings/profiles.md
- docs/settings/providers/api-keys.md
- docs/settings/providers/built-in.md
- docs/settings/providers/custom-endpoint.md
- docs/settings/providers/switching-models.md
- docs/settings/sidebar.md
- docs/settings/skills.md
- docs/settings/skills/building-skill.md
- docs/settings/skills/installing-skill.md
- docs/settings/skills/what-are-skills.md
- docs/settings/themes.md
- docs/settings/workflows-backend-toggle.md
- docs/specs/tables-hermes-plugin-draft.md
- docs/specs/tables-switchui-spec.md
- docs/tips/composer-tricks.md
- docs/tips/search.md
- docs/tips/shortcuts.md
- docs/troubleshooting/agent-connect.md
- docs/troubleshooting/crash-recovery.md
- docs/troubleshooting/models.md
- docs/troubleshooting/sessions.md
- docs/troubleshooting/telegram.md
- docs/welcome.md
- graphify-out/GRAPH_REPORT.md
- skills/workspace-dispatch/SKILL.md
- src/server/__fixtures__/personas/engineering/code-reviewer.md
- src/server/__fixtures__/personas/engineering/software-architect.md
- website/CHANGELOG.md
- website/README.md

## FILE CHURN (top 40, last 7d)

```
 127 
  24 package.json
  19 CHANGELOG.md
  18 src/screens/chat/chat-screen.tsx
   9 src/stores/chat-store.ts
   7 website/astro.config.mjs
   7 src/screens/self-improve/self-improve-screen.tsx
   7 src/screens/chat/sessions-feed.ts
   7 src/routeTree.gen.ts
   6 src/screens/chat/components/v2/chat-meta-bar-v2.tsx
   5 src/stores/chat-store.test.ts
   5 src/server/hermes-api.ts
   5 src/screens/self-improve/self-improve-screen.css
   5 src/screens/chat/components/message-item.tsx
   5 src/screens/chat/components/chat-composer-shadcn.tsx
   5 src/routes/api/claude-jobs.$jobId.ts
   5 src/components/slash-command-menu.tsx
   4 website/src/site-version.ts
   4 src/server/self-improve-client.ts
   4 src/server/self-improve-client.test.ts
   4 src/screens/chat/components/v2/chat-meta-bar-v2.test.tsx
   4 src/screens/chat/chat-screen-utils.ts
   4 src/screens/chat/chat-screen-utils.test.ts
   4 src/routes/api/-claude-jobs.$jobId.test.ts
   4 src/lib/self-improve-api.ts
   4 src/lib/jobs-api.ts
   4 .omc/plans/unify-chat-state-architecture.md
   3 website/src/lib/starlight-docs-prefix.ts
   3 website/src/components/TopNav.astro
   3 website/package-lock.json
   3 src/server/hermes-plugin-sync.ts
   3 src/screens/commands/commands-screen.tsx
   3 src/screens/chat/sessions-feed.test.ts
   3 src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx
   3 src/screens/chat/components/chat-message-list.tsx
   3 src/screens/board-templates/board-templates-screen.tsx
   3 src/lib/self-improve-types.ts
   3 src/lib/hermes-kanban-types.ts
   3 pnpm-lock.yaml
   2 website/src/styles/starlight-docs.css

```

