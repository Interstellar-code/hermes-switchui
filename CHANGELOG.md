# Changelog

All notable changes to Switch UI are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.3.19] — 2026-06-05

Install & onboarding polish.

### Changed

- **install.sh now installs the Interstellar-code fork of `hermes-agent`** instead of the NousResearch upstream installer. Friendlier per-OS prereq hints and a clearer final banner.
- **Background-service guidance.** The installer banner and README now document `hermes gateway install` (systemd on Linux / launchd on macOS) for always-on setups, plus `pnpm dev`-only afterward, with a WSL "no systemd by default" caveat.
- **Onboarding honesty.** After saving a provider/API key, the wizard and the `/api/claude-config` PATCH response now state that the gateway reads config at startup only — restart (`hermes gateway restart` / `pnpm start:all`) for changes to take effect.
- **README install section** rewritten: three paths (one-liner / manual / Docker), prerequisites, security note, and a new "Run as a background service" subsection. Stale NousResearch install URLs swapped to the Interstellar-code fork.

## [2.3.11] — 2026-05-23

Cleanup release. Closes 9 open issues from the in-repo code review.

### Fixed

- **#37 — files-screen rename/mkdir silent failures.** `handlePromptSubmit` now checks `res.ok` on the rename and mkdir POSTs and renders the error inline in the prompt dialog. The tree only reloads on success.
- **#43 — agent-version cache backward-clock skew.** Added a `now >= cached.ts` prerequisite so a backward NTP/sleep jump no longer pins the cached value indefinitely.

### Performance

- **#38 — nav boardsQuery skipped when collapsed.** `useBoards` accepts an `enabled` flag; PrimaryNavV2 passes `!collapsed` so the badge query stops firing when the badge isn't visible.
- **#39 — files-screen tree filter debounced.** Added a 150ms debounced copy of `treeQuery`; the recursive `visibleEntries` walk is now keyed on the debounced value while the input + visual hints stay snappy.
- **#40 — profiles-browser memoization.** `listProfiles()` now caches results for 5 seconds; every mutating function (`createProfile`/`deleteProfile`/`updateProfileConfig`/`renameProfile`/`setActiveProfile`) invalidates the cache so the UI sees changes immediately. The dev-mode `console.warn` in `setActiveProfile` is gated behind `NODE_ENV !== 'production'`.
- **#41 — /api/models parses config.yaml once per request.** Introduced `readConfigOnce()`; `readProvidersFromConfig`, `readClaudeDefaultModel`, `readModelAliasesFromConfig`, and `readStreamTimeouts` now accept the parsed config as a parameter instead of each reopening the file.
- **#46 — mcp hubQuery skipped outside Market tab.** `useMcpHub` accepts an `enabled` flag; McpScreen passes `statusFilter === 'market'` so the marketplace fetch only fires when the Market tab is showing.

### Refactor

- **#45 — utility consolidation.** Extracted formatters to `src/lib/format.ts` (`formatBytes`, `formatDate`, `formatRelative`) and POSIX path helpers to `src/lib/path-utils.ts` (`getExt`, `getParentPath`). files-screen and profile-card now import from the shared modules.

### Polish

- **#44 — vite.config dev-server boot.** Sanitized the workspace-daemon stale-port cleanup before shell interpolation, moved `workspaceDaemonStarted = true` to after a successful spawn (try/catch keeps state correct on failure), and replaced the fixed 15 × 1s health-check polling loop with a bounded backoff schedule so a ready agent returns sooner.

## [2.3.10] — 2026-05-22

Patch release. Profile picker no longer duplicates the gateway's active named profile with a synthetic `default` card.

### Fixed

- **Synthetic `default` profile suppressed when a named profile is active** — `src/server/profiles-browser.ts` always injected a synthetic `default` card built from `~/.hermes/config.yaml`, even when a named profile (e.g. `hermes-switch`) was selected. Both cards then represented the same gateway runtime, which was confusing and caused tier/status mismatches (`default` always showed T3 because the root config has no `agent_ui:` block). The synthetic card now appears only when `~/.hermes/active_profile` is empty or set to `default` — i.e. when there genuinely is no named profile in use.

## [2.3.9] — 2026-05-22

Patch release. Profile picker now distinguishes the currently-selected ("in use") profile from the agent_ui.status presentational label, and the sidebar version chip auto-refreshes on `pnpm version` bumps without a manual dev-server restart.

### Added

- **`IN USE` badge on the currently-selected profile card** — the gateway's active profile (the one resolved from `~/.hermes/profiles/.active`) now shows an explicit `⚡ IN USE` badge plus a green-glow border. Distinct from each profile's `agent_ui.status: active | idle` label, which is purely presentational metadata set per-profile and was previously colliding semantically with the selection state. Built-in profiles (Neo, Trinity, Morpheus) still show ACTIVE from `agent_ui.status`, but the `default` profile — usually the gateway's actual selection — now correctly surfaces as `IN USE` even though its `agent_ui` block is unset.
- **Dev-server auto-restart on `package.json` change** — Vite plugin `restart-on-package-json` watches the project's `package.json` and calls `server.restart()` whenever the version (or any other field) changes. Without this, `__APP_VERSION__` (computed once at config load via `define`) stays stale after `pnpm version` bumps and the sidebar version chip lies.

## [2.3.8] — 2026-05-22

Patch release. Fixes upload landing at workspace root (issue #34).

### Fixed

- **Files upload honors selected folder (#34)** — the header UPLOAD button hardcoded `''` as the target path, so every upload landed at the workspace root regardless of which folder was selected in the tree. The button now derives the target from `selectedEntry`: a selected folder uploads there, a selected file uploads to its parent, nothing selected falls back to the workspace root. Tooltip updates to reflect the resolved target.

## [2.3.7] — 2026-05-22

Patch release. The workflows page Backend toggle is no longer cosmetic — `native` and `plugin` now actually return different content, and workflows created by hermes-agent via the plugin API appear in the UI without restart.

### Fixed

- **Backend toggle was cosmetic** — `GET /api/workflow-definitions` ignored the `X-Workflow-Backend` header that the workflows page sent, so every fetch went to the native engine regardless of the dropdown selection. The route now resolves the engine via `factory.getEngine(request)`, so `plugin` requests reach the hermes-agent dashboard plugin via the existing `/api/dashboard-proxy/...` splat and `native` requests stay on the local SwitchUiWorkflowStore.

### Notes

- Native dev store (`~/.hermes/dev/...switchui-workflows.db`) and plugin canonical store (`~/.hermes/switchui-workflows.db`) are still separate databases. After this fix the toggle exposes that split honestly — plugin mode shows the full plugin catalog including workflows authored by hermes-agent itself; native mode shows only the dev-process bundled defaults plus any locally-authored entries.
- A separate hermes-agent migration (uncommitted in `~/.hermes/hermes-agent/plugins/workflow-engine/defaults/`) seeded 22 workflows into the plugin catalog so it is now a proper superset of the SwitchUI bundled defaults. Custom workflows from the slot-a worktree (`gateway-health-check`, `pr-review-5agents`) are preserved there. Those YAMLs ship with hermes-agent, not SwitchUI, and are not part of this release.

## [2.3.6] — 2026-05-22

Patch release. MCP detail drawer fully wired, sidebar shows live agent + Switch UI versions, session naming retries on follow-up turns, stale-session deletes no longer error out. Repo also detached from the upstream fork (Settings → Leave fork network); homepage updated to `hermes-switchui.zi0n.space`. No breaking code changes.

### Added

- **Live version footer in primary nav** — replaces hard-coded `v2.3.0` label with `HERMES (<agent-version>)` + `Switchui (<package-version>)`. Agent version pulled from a new `/api/agent-version` route (proxies dashboard `/api/status`, 60s server-side cache). Package version injected at build via Vite `define: { __APP_VERSION__ }`.
- **`src/routes/api/agent-version.ts`** — server-only route exposing the hermes-agent gateway version.
- **`src/vite-env.d.ts`** — declares `__APP_VERSION__` global for TS.
- **MCP picker surfaces `model_aliases:`** — `/api/models` now merges `model_aliases:` entries from `~/.hermes/config.yaml` into the picker, so user-defined aliases (e.g. `manifest`, `premium`) appear as selectable model entries.

### Fixed

- **MCP detail drawer quick actions wired** — `Test connection`, `Discover tools`, `Disconnect` now actually call `/api/mcp/test`, `/api/mcp/discover`, and DELETE `/api/mcp/$name`. Previously all four buttons had no `onClick` (only `Copy endpoint` worked). `Restart` removed — depended on a runtime endpoint the gateway doesn't expose. Disabled MCP servers (`enabled: false`) now correctly render as `disabled` instead of incorrectly showing `connected`/`online`.
- **Sidebar context menu Delete actually fires** — outside-click handler was unmounting the entire menu (including the confirmation dialog) before the dialog's `onClick` could run, because `InlineDeleteDialog` is a sibling of `menuRef`, not inside it. Handler now short-circuits while a dialog is open.
- **Session delete no longer hard-errors on 404** — `useDeleteSession` treats a 404 from the hermes-agent dashboard as already-deleted so stale UI rows can be cleared without a toast.
- **Session title retries on follow-up turns** — `useAutoSessionTitle` signature now includes `messages.length`, so a first-turn LLM failure no longer locks the session at "untitled" forever. Each new turn re-attempts; once the title settles to a non-generic value, retries stop.
- **Silent title-PATCH failures are now visible** — `onError` surfaces a toast (`Session title update failed: …`) and the sidebar label shows `Untitled (title error)` instead of the misleading `New Session`.

## [2.3.5] — 2026-05-09

Single-system chat UI. Strips the v1 chat surface so the v2 unified sessions sidebar / matrix-themed chat surface is the only path. The `VITE_HERMES_SIDEBAR_V2` feature flag is gone — install / onboarding no longer require any env-var gymnastics to get the Switch UI.

### Removed

- **v1 chat UI components** (7 files, ~2451 lines): `src/screens/chat/components/chat-sidebar.tsx`, `chat-header.tsx`, `sidebar/sidebar-sessions.tsx`, `sidebar/session-item.tsx`, `sidebar/session-rename-dialog.tsx`, `sidebar/session-delete-dialog.tsx`, `sidebar/v2/sidebar-flag.ts`
- **`VITE_HERMES_SIDEBAR_V2`** env flag from `.env.example`
- **All 8 conditional branch sites** in `chat-screen.tsx` + `workspace-shell.tsx` collapsed to v2-only path; the `useSidebarV2Flag` hook removed entirely

### Changed

- `sidebar-card-context-menu-v2.tsx` absorbs rename + delete dialogs (previously imported from deleted v1 files) as inline components, wired to `useRenameSession` / `useDeleteSession` with proper loading + error UX (Save/Delete buttons disable during in-flight, error rendered inline, Esc/Cancel blocked while saving). Codex review caught a no-op rename on the first pass — fixed in this release.
- `AGENTS.md`: noted the v1 strip in the chat UI section

### Mobile

No code changes needed — pre-deletion audit (`.omc/v1-audit.md`) confirmed `mobile-tab-bar.tsx` and `mobile-hamburger-menu.tsx` had zero v1 chat-component imports. Mobile surfaces continue to work with the v2 sidebar/header path that was already shipped.

## [2.3.4] — 2026-05-08

First release as **Switch UI** — fork of `outsourc-e/hermes-workspace` with a Matrix-styled UI direction. Bundles the v2.3.0 upstream bugfixes plus the Switch UI typography pass, unified sessions sidebar, composer retheme, and HermesWorld removal.

### Added

- **Switch UI rebrand** — README rewritten to reflect fork identity; credits upstream and documents sync strategy (cherry-pick backend/infra only)
- **Matrix design system** — ported mockup tokens into `src/styles.css`; reusable utility classes `.m-mono`, `.m-label`, `.m-chip`, `.m-timestamp`, `.m-body`, `.m-glow-text`; aliased the previously-undefined `--font-mono` so JetBrains Mono actually loads
- **Unified sessions sidebar (v2)** — single feed across chat / cron / api / task sources, day-grouped (Pinned / Today / Yesterday / Earlier), source filter chips, state segments, free-text search, persisted collapse
- **Composer Matrix retheme** — workspace, model, profile, and thinking-level popovers all use green-glow border + neon shadow + mono uppercase items; outer wrapper made transparent (no more backdrop-blur over narrow-viewport icons)
- **Chat meta bar wiring** — live indicator + tok/s, model, ctx %, tool count, profile, session id; profile via `/api/profiles/list`, tok/s derived from `usedTokens` deltas, tool count from merged ToolTabView extraction, model fallback from `activeSession.model`
- **Files panel toggle** in chat header — replaces the sessions panel slot when active
- **Inline-path file links** in chat messages — clicking a path opens the files panel in place
- **Activity card** matches mockup: `[ACTIVITY · N TOOLS]` header, per-row file/size/duration tail, emoji icons next to tool names
- **TASK source chip** — filters chats triggered from kanban tasks
- **Settings modal** in primary nav
- **Sidebar polish** — Hermes avatar persists in collapsed nav; expand chevron in rail + collapsed nav body; primary-nav and sessions-shell wrapped in matching rounded-border cards

### Changed

- **Sessions cap 50 → 1000** on `GET /api/sessions` so the unified feed can render full session history
- **Sessions filter store migrated to v4** — drops today-only date default and chat-only source default; cleanly migrates v2/v3 state
- **Theme list** — Matrix is the default; full set: Matrix, Claude Nous, Claude Official, Claude Classic, Claude Slate
- **Manifest provider** — Switch UI uses a named `manifest` provider entry (not `custom`, which is reserved by the gateway)

### Removed

- **HermesWorld / Playground 3D game feature** — 50 files, ~13.8k lines (full `src/screens/playground/**`, `playground-ws-worker/` Cloudflare Worker package, route entries, env vars, docs, memory iteration notes). Doesn't fit Switch UI's productivity direction.

### Fixed (cherry-picks from upstream v2.3.0)

- `fix(chat)`: preserve workspace session identity during streams (#310)
- `fix(chat)`: correct local session accounting and titles (#350)
- `fix(jobs)`: render structured error bodies as readable text instead of `[object Object]` (#304)
- `fix(gateway)`: faster recovery from disconnected state + docker docs (#275)
- `fix(context)`: add `kimi-k2.6` 256k context window support (#357)
- `fix(updates)`: show "Hermes updated" modal only once per release (#386)
- `fix(docker)`: start Hermes Agent gateway in compose (#385)
- `fix(terminal)`: keep PTY alive across SSE disconnects + auto-reattach (#298)
- `fix(conductor)`: fall back when dashboard mission api is unavailable (#317)
- `fix(conductor)`: sanitize mission goals before spawn (#335)
- `fix`: bridge Codex OAuth tokens to portable-mode chat bearer auth (#332)
- `fix`: harden workspace swarm prompt submission (#307)
- `fix`: preserve tmux startup failures for swarm workers (#341)
- `fix`: allow workspace production server to start (#308)

### Build

- `package.json`: declare `pnpm.onlyBuiltDependencies` allowlist (`electron`, `electron-winstaller`, `esbuild`, `unrs-resolver`) so pnpm 10+ install no longer fails on `ERR_PNPM_IGNORED_BUILDS` in Docker CI

## [Unreleased pre-fork]

### Changed
- **`docker compose up` now pulls pre-built images by default** (#82) — `nousresearch/hermes-agent:latest` for the gateway and `ghcr.io/outsourc-e/hermes-workspace:latest` for the UI. Agent state persists in the `claude-data` named volume. Adds `docker-compose.dev.yml` overlay for building from source.

## [2.0.0] — 2026-04-20

**Zero-fork release.** Clone, don't fork. Hermes Switch UI now runs on vanilla `pip install hermes-agent` with no patches, no drift, no custom gateway required.

### Added
- **Zero-fork architecture** — dual gateway/dashboard routing; workspace talks directly to vanilla `hermes-agent` 0.10.0+ via standard endpoints (`/v1/models`, `/api/sessions`, `/api/skills`, `/api/config`, `/api/jobs`)
- **One-liner curl installer** — `curl -fsSL … | bash` provisions workspace + gateway + defaults
- **Claude-Nous theme** — dark + light editorial variants with cobalt/paper surface pass, thin 1px architectural borders, editorial type accents
- **Conductor** (`/conductor`) — mission-control surface ported from Clawsuite; spawn missions, assign workers, watch live output and costs
- **Operations** (`/operations`) — agent registry / sessions manager ported from Clawsuite; pause, steer, kill live agents with role and model insight
- **Synthesized tool pills** — inline tool-call rendering from dashboard stream markers when running against zero-fork gateway
- **Landing parity pass** — hero, features, screenshots, setup, OG image, mobile theme toggle
- **Task board status vs. assignee** decoupling
- **Local-model chat session persistence** — local sessions appear in history + session list
- **Memory is local-fs first** — honors `HERMES_HOME`, no gateway dependency
- **Splash + screenshots refresh** — Conductor, Dashboard, Tasks, Jobs captured in new editorial theme

### Changed
- **Model picker** — fetches from gateway (`~/.hermes/models.json` for user-configured models), matches OCPlatform behavior; shows only configured providers instead of all upstream
- **`enhanced-fork` mode label** no longer implies a fork is required; it indicates streaming route availability on vanilla gateway
- **Dashboard + enhanced-chat capabilities** marked optional; missing endpoints no longer trigger warnings
- **Feature-gate + install copy** — all fork-era references purged
- **Theme family allowlist** — `claude-nous` promoted to the enterprise allowlist
- **Session pill** — solid dark-mode background, matches model selector

### Fixed
- Duplicate responses and disappearing history on interrupt (#62)
- Portable-mode double user message, uncleaned timeouts, orphaned unregister callbacks
- Local model selection actually propagates to chat (no silent fallback)
- Strip provider prefix correctly for local routing
- Dashboard token injection on `/` (not `/index.html`)
- Onboarding no longer stacks behind workspace shell
- Root bootstrap guards against uncaught errors
- Preserve assistant text during tool-call streaming
- Installer output uses defined escape vars (removed undefined BOLD/RESET)

### Removed
- All references to the legacy "enhanced fork" as a requirement
- Stale fork-era gateway instructions and feature-gate copy

---

## [1.0.0] — 2026-04-10

Initial public release. Chat, files, memory, skills, terminal, dashboard, settings — the foundational workspace.
