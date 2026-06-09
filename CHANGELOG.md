# Changelog

All notable changes to Switch UI are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.3.35] — 2026-06-09

Website/docs split is now clean: app docs stay at `/docs`, the Astro site builds from the root `docs/` tree, and the embedded `/website` preview works again inside Switch UI.

### Added

- **Website docs now use the repo-root `docs/` folder as their single source of truth.** Starlight loads the canonical markdown from `docs/`, builds website docs under `/docs/...`, and syncs diagrams/images/screenshots into static `/docs-assets/...` so the website no longer depends on app-only `/api/docs*` endpoints.

### Fixed

- **Embedded `/website` preview inside Switch UI was broken by wrong asset base paths.** The Astro build was emitting module URLs that did not line up with the app-served `/website/...` route, so the browser fetched HTML instead of JavaScript and failed strict MIME checks. `build:website` now builds with `SITE_BASE=/website`, and the embedded preview serves JS from `/website/_astro/...` correctly again.
- **Website docs duplicated both `/docs/...` and root-level doc routes.** Postbuild cleanup now removes the duplicate root doc outputs after Starlight generation, rewrites sitemap entries, and rebuilds Pagefind from the cleaned `dist` so the public website exposes only `/docs/...`.
- **Some canonical docs pages could not be loaded by Starlight.** Missing frontmatter was added to the remaining markdown files that lacked required `title`/`description` metadata, and unsupported fenced `env` blocks were normalized so the shared root docs tree builds cleanly in the website pipeline.

## [2.3.34] — 2026-06-09

Regression fix: Task sessions disappeared from the sidebar after the 2.3.33 CLI/A2A change.

### Fixed

- **Task chip went empty after 2.3.33.** The CLI/A2A classifier branches were evaluated before the `isTaskTriggered` heuristic, so kanban-task sessions that run via the CLI (source `cli`) were reclassified out of the Task chip into CLI. `task` is a heuristic overlay that can ride on any source, so it is now checked before `cli`/`a2a` (still after telegram/cron/api). Task sessions are back; only non-task CLI/A2A land in the new chips.
- Hardening: extracted the classifier into an exported pure `classifySessionSource()` and deleted the test's drifted copy (which had silently kept the old order and asserted the bug). The test now exercises the real classifier, so this regression can't pass green again.

## [2.3.33] — 2026-06-09

CLI and A2A sessions are first-class in the sidebar, more session types are deletable, and console noise is gone.

### Added

- **CLI and A2A sessions are now first-class sources.** Sessions started from the Hermes CLI (`cli`, 116) and A2A fleet runs (`a2a_fleet`, 55) were classified into the generic "chat" bucket — reachable but indistinguishable and unfilterable. They now have their own classifier branches and sidebar chips (CLI teal, A2A violet) with rail colors, matching how Telegram/API are handled.

### Fixed

- **Delete was unavailable for Telegram, CLI, and A2A sessions.** The row context menu gated Delete/Rename on a stale allowlist (`chat`/`cron`/`api`/`task`) that omitted `tg`, `cli`, and `a2a`, so those sessions offered only Archive. All are backed by ordinary gateway sessions and share the same `DELETE /api/sessions/<id>` path; the allowlist now includes them.
- Removed a dead `s.key.startsWith('api-')` classifier fallback (no current session id uses that prefix).

### Changed

- Removed an unconditional `tap-debug` `console.info` that logged `[tap-debug:chat-main] toggle via overlay…` on every chat mount.
- CI: the Docker publish workflow now frees ~25GB of unused preinstalled toolchains before buildx, preventing the intermittent `ResourceExhausted: no space left on device` failures at the image-export stage.

## [2.3.32] — 2026-06-09

Telegram sessions are clickable, the updater stops false-nagging, and a dashboard console warning is gone.

### Fixed

- **In-app updater falsely offered updates (and could destroy local commits).** The updater advertised an update whenever local git HEAD differed from the remote HEAD — direction-blind — and showed the "local changes, commit/stash" block whenever the checkout was dirty, even with no update pending. On a checkout ahead of or diverged from origin this nagged constantly, and the offered update runs `git reset --hard origin/<branch>`, which would have destroyed unpushed local commits. An update is now offered only when local is strictly **behind** remote (local HEAD is an ancestor of the remote tip), and the dirty-block only appears when an update actually exists. Decision logic extracted into pure unit-tested helpers (`isUpdateAvailable`, `resolveUpdatePresentation`). Applies to both the Switch UI and Hermes Agent update paths.
- **Telegram sessions were not clickable in the V2 sidebar.** `isChatItem` omitted `src === 'tg'`, so Telegram rows fell through to the non-clickable branch instead of the `<Link to="/chat/$sessionKey">`. They share the same chat key/route as every other source; adding `'tg'` makes them open normally.
- **recharts `width(-1)/height(-1)` console warning on the dashboard.** recharts 3.x defaults `ResponsiveContainer` `initialDimension` to `{-1,-1}` for SSR; set `initialDimension={{width:1,height:1}}` on the initial-mount chart.

## [2.3.31] — 2026-06-09

Embedded docs flow diagrams render again instead of downloading.

### Fixed

- **Flow diagrams on `/docs` pages downloaded instead of rendering.** The security hardening in `6480a703` (#111) added a blanket `Content-Disposition: attachment` for `.html`/`.svg` served by `/api/docs-asset`, which also caught the first-party flow diagrams the docs embed via `<iframe src="/api/docs-asset?path=diagrams/*.html">`. The diagrams are static, in-repo, and script-free, so they are now served inline: `docs-asset.ts` exempts the `docs/diagrams/` subtree from force-download (tight CSP — no script source, inline + Google Fonts styling only — plus `X-Frame-Options: SAMEORIGIN`), and `docs-render.ts` rewrites the docs-asset iframes to carry `sandbox=""` + `referrerpolicy="no-referrer"`. Arbitrary `.html`/`.svg` anywhere else is still forced to download.

Security posture unchanged for every path except the trusted `docs/diagrams/` subtree, which now renders inside a sandboxed iframe.

## [2.3.30] — 2026-06-09

Gateway startup reliability: find the renamed `hermes` binary and honor a custom gateway port.

### Fixed

- **"hermes-agent not found" on fresh Interstellar installs.** `resolveClaudeBinary()` only looked for a `claude` binary under `~/.claude/bin` and `~/.local/bin`, but the Interstellar fork installer ships the gateway CLI as `hermes` (to `~/.hermes/bin` or `~/.local/bin`). A correctly installed gateway was reported missing and `startClaudeAgent()` returned the installer error. Resolution now checks the `hermes` locations first, keeps the legacy `claude` paths as a fallback, and finally does a `PATH` lookup (`hermes` then `claude`).
- **Gateway connection failure on non-default ports.** The health probe and uvicorn fallback launch hardcoded port `8642`, so a gateway on any other port could not be detected. New `resolveGatewayPort()` / `resolveGatewayUrl()` derive the target in priority order: `HERMES_API_URL` / `CLAUDE_API_URL` → `API_SERVER_PORT` in `~/.hermes/.env` → default `8642`. `isClaudeAgentHealthy()` now probes the resolved base URL, so the health check matches where REST traffic already goes.

Runtime-only change — no migration. Installs running the local agent on `8642` with no env override resolve to exactly the previous values and are unaffected.

## [2.3.29] — 2026-06-09

Sidebar session delete reliability, Telegram session visibility, and chat source-tab counts.

### Fixed

- **Sidebar session delete now refreshes the list.** Deleting a session removed it on the backend but left the card visible, because the V2 sidebar renders from a separate TanStack Query cache (`['sessions-feed','chat','v3-task-split']`) than the delete mutation invalidated (`['chat','sessions']`). The feed key is now exported as `SESSIONS_FEED_KEY` and invalidated on mutate/error/success, with tombstone filtering for instant optimistic removal. The delete dialog no longer unmounts mid-request, and gateway-owned sessions (e.g. cron) the dashboard 404s now fall through to the gateway DELETE (404 treated as success).
- **Telegram sessions now appear in the sidebar.** The feed classified sessions by key-prefix only, so timestamp-keyed Telegram rows fell into the `chat` bucket and the `tg` filter chip stayed empty. The feed now classifies by the authoritative gateway `source` field (`telegram → tg`); `source` is preserved through `normalizeSessions` and typed on `SessionMeta`; the TELEGRAM chip shows whenever it has items.

### Changed

- **Chat meta bar slimmed.** Removed the redundant total-token field (the context-window ring already shows it) and the api-call count.
- **Source tabs show counts.** The chat / tool / skills tabs now display message, tool-invocation, and skill-invocation counts. Skill count uses a shared `countSkillEntries` helper so the badge and the skills tab agree.

## [2.3.27] — 2026-06-07

Shadcn composer cutover at /chat + reply / queue / tool-display features.

### Added

- **shadcn/ui is now the default chat composer at `/chat`** (#187, #189). The base-ui `ChatComposer` has been replaced by a new `ChatComposerShadcn` that reuses the same `ChatComposerProps` / `Handle` / `Helpers` / `Attachment` contract and delegates all send/streaming logic to `chat-screen`. Coexistence guardrail holds: shadcn lives only under `src/components/shadcn/ui/`, base-ui stays under `src/components/ui/`, and all shadcn primitives inherit the 13-theme palette via the `--theme-*` token bridge in `src/styles.css`. Phase 0 (`feat(ui): shadcn/ui Phase 0 — isolated coexistence + token bridge`) and Phase 1 plan executed end-to-end (see `.omc/plans/shadcn-adoption.md`).
- **Tool-display 3-state toggle.** A new footer button on the composer cycles tool-section visibility `expanded → collapsed → hidden` (with a distinct icon + label + muted styling per mode). State is persisted to `localStorage` under `switchui:tool-display-mode` and per-message rendering skips the entire tool-section block in `hidden` mode. Maps to the operator1 `setToolDisplayMode` cycle.
- **Reply-to quote.** A new `Reply` button on `MessageActionsBar` quotes the target message into the composer; outgoing messages are prepended with a styled `> [Re: #N]` blockquote (left-accent `border-l-2 border-primary`, `CornerUpLeft` icon) — the raw marker is kept in the outgoing text for LLM context and reload persistence.
- **Reply chip + system-message toggle + new-chat button.** Dismissible reply chip above the textarea; `Eye`/`EyeOff` toolbar button hides system messages; `SquarePen` toolbar button issues a `navigate({ to: '/', replace: true })` new-chat.
- **Queue composer sends while streaming.** Per-session persisted FIFO queue: stage sends during an active stream, drain FIFO as each response completes. The native Hermes `/queue` is client-coordinated and returns `{type:send}` over REST+SSE, so this client-side FIFO is functionally equivalent.
- **Toolbar parity** on `ChatComposerShadcn`: profile, workspace, thinking-level (with Shift-click quick-cycle), fast-mode, web-search, and live model switch (per-session persistence + gateway `switchModel` with the zero-fork guard). Reuses the live composer's exported helpers/types — no behavior duplication.
- **Cherry-picked sandbox composer features** (now live in the cutover composer): auto-growing textarea with Enter-to-send / Shift+Enter-newline, caret-anchored slash (`/`) + `@` autocomplete popover (shadcn `Popover` + `Command`), image paste + file-picker attachments (with thumbnail chips), reply-to chip, message queue with start/stop/clear (persisted to `localStorage`), color-coded live context counter, and an inline agent + session badges row with a provider-grouped model selector popover.
- **shadcn composer primitives** under `src/components/shadcn/ui/`: `button`, `popover`, `tooltip`, `dialog`, `command`, `input`, `textarea` (all generated via `shadcn@4.10.0`). Radix deps (`@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `@radix-ui/react-dialog`) and `cmdk` installed as direct dependencies.

### Changed

- **Selectors relocated from composer toolbar to meta bar.** Model / profile / workspace / thinking dropdowns moved out of `ChatComposerShadcn` into a new self-contained `SessionSelectorsV2` component rendered by the meta bar. Composer toolbar is now icons + context ring + send only. The meta bar now highlights the 4 relocated selector chips with an accent border + subtle accent fill so they read as interactive controls, and drops the read-only status (tok/s, model echo, ctx%, token count, tools) to remove the confusing double model indicator. The composer still owns thinking-level (read-only) for the fast-mode gate.
- **Reply reference redesigned** as a styled quote block (bg-muted, `border-l-2 border-primary`, `CornerUpLeft` icon) above the message body instead of being inlined as raw `> [Re: #N]` markdown.
- **Composer image compression pipeline ported** to `ChatComposerShadcn` (helpers exported from the live composer; 50 MB size cap, canvas compression with graceful fallback).
- **Sandbox composer artifacts removed** at cutover: the `switchui:shadcn-composer` feature flag, the `/composer-preview` dev route, and the `composer-shadcn/` sandbox directory are deleted (route tree regenerated). The previous `ChatComposer` is kept on disk for revert only.

### Fixed

- **Runtime `React is not defined` at `/chat`** — the tool-display toggle wiring used `React.useCallback` against an unimported `React` global; switched to the already-imported named `useCallback`, and added the missing `ToolDisplayMode` type import.
- **Add-to-queue button rendered as washed-out `secondary` on Matrix dark** — the button uses `primary` variant to match the send button, since queueing is the primary action while streaming.
- **Composer docked flush to viewport bottom** — restored outer padding `px-3 pt-2 pb-6 sm:px-5 md:pb-8` so the composer has the same bottom gap as the original.
- **Reply preview showed raw markdown** — table pipes / headers stripped so the quote snippet reads as clean prose.
- **Reply quote dumped the full multi-line message** — collapsed whitespace and capped at 140 chars with ellipsis so it renders as one clean blockquote line.

## [2.3.26] — 2026-06-05

Website served in-app.

### Added

- **`/website` serves the Astro marketing site.** The bundled `website/` Astro site is now reachable at `http://localhost:3000/website/` from the app (dev and production node). New splat route `src/routes/website.$.ts` serves `website/dist/` (content-typed, path-traversal-guarded, public/no-auth) with `website.index.ts` for the bare path.
- Astro `base` is env-driven (`SITE_BASE`): the app build (`build:website`) builds with `base: /website`; the VPS deploy keeps `base: /` (root). `pnpm build` now builds the website before `vite build`.

### Notes

- Docker: `.dockerignore` excludes `website/`, so `/website` won't serve inside the Docker image yet — a separate follow-up.

## [2.3.25] — 2026-06-05

Security + tooling.

### Security

- **Cleared 4 moderate `hono` advisories** (GHSA-3hrh-pfw6-9m5x, GHSA-f577-qrjj-4474, GHSA-2gcr-mfcq-wcc3). `hono` was a transitive peer of `@hono/zod-openapi` resolving to the vulnerable 4.12.18; pinned `hono` as a direct dependency at `^4.12.23`. `pnpm audit` is now clean.

### Changed

- Bumped `@tanstack/eslint-config` 0.3.4 → 0.4.0 (lint tooling current; no behavior change). Repo-wide lint debt tracked in #186.

## [2.3.24] — 2026-06-05

Fresh-install fixes: MCP page + File Manager.

### Fixed

- **MCP servers page empty on fresh installs (#185).** The `mcpFallback` capability gate required the agent's `config.yaml` to already contain an `mcp_servers` key — which a fresh install doesn't have — so `/mcp` returned an unavailable payload even when the dashboard was running. Chicken-and-egg: you couldn't add a server because the key was missing, and the key was missing because no server was ever added. `probeMcpConfigKey()` now gates on config *reachability* (not key presence); the write path already creates `mcp_servers` on first add, and the `isLocalhostDeployment()` safety gate is kept.
- **File Manager blank on fresh installs.** When no real workspace is selected (or the throwaway auto-created `~/workspace` default), `/files` now shows a first-run "Choose your workspace folder" picker instead of an empty view. It reuses the existing `POST /api/workspace` mechanism (shared with the chat composer), surfaces known workspaces as quick-picks, and loads the chosen folder immediately.

## [2.3.23] — 2026-06-05

Visual bug-report widget.

### Added

- **Userback feedback widget.** Any user can file a bug report with a screenshot/annotation from inside Switch UI. On by default; override your token or disable via `VITE_USERBACK_TOKEN` (`=off` to disable). CSP `script-src`/`style-src`/`font-src` widened to allow `static.userback.io`.

## [2.3.22] — 2026-06-05

Dashboard banner bugfix + dynamic detection.

### Fixed

- **False "Limited mode" banner.** The dashboard-unavailable banner read `capabilities.dashboard` (a nested `{ available }` object) as if it were a boolean, so the check was always false and the banner showed permanently whenever the gateway was up — even with the dashboard connected. It now reads `capabilities.dashboard?.available`.
- **Dynamic recovery.** The banner polls every 15s (was 60s) with refetch-on-focus, and the server probe TTL now treats gateway-up/dashboard-down as a partial state (15s re-probe instead of 120s), so the banner clears within ~15s of starting the dashboard. The per-session dismissal is auto-cleared when the dashboard recovers.

### Changed

- **react-grab** dev overlay is gated to the dev server only (stripped from production builds) and can be opted out in dev with `VITE_REACT_GRAB=0`.

## [2.3.21] — 2026-06-05

Config single-source + dashboard awareness.

### Fixed

- **`.env` is now the single source of truth for gateway/dashboard URLs.** Removed the `~/.hermes/workspace-overrides.json` layer — an upstream-Workspace remnant that silently outranked `.env` with no reachability check, so a stale override (e.g. carried over from another machine) sent every gateway+dashboard call to the wrong host on an otherwise-correct local install. URL resolution is now `HERMES_API_URL`/`CLAUDE_API_URL` → default only.
- **Auto-clean stale overrides.** On startup, any existing `workspace-overrides.json` is renamed to `.bak` with a one-line notice.

### Added

- **Dashboard-availability warning (installer).** `install.sh` now probes the gateway (:8642) and dashboard (:9119) at the end of install and prints a loud warning when the dashboard isn't running — sessions/skills/memory/kanban/jobs depend on it. The two-backend model is spelled out in the banner.
- **Dashboard-availability warning (UI).** A persistent "Limited mode — Hermes dashboard not connected" banner appears when the gateway is reachable but the dashboard (port 9119) is not, with the `hermes dashboard --no-open --skip-build` start command.

### Changed

- Settings → Connection now persists URL changes to the project `.env` (instant in-process update, survives restart) instead of the removed JSON file.
- README: new "Two backends: gateway + dashboard" section + dashboard-as-service guidance.

## [2.3.20] — 2026-06-05

Install-flow hardening.

### Fixed

- **Safe installer re-runs.** `install.sh` no longer aborts on re-run when the working tree is dirty (users edit `.env` in place) — it skips the pull with a note, and catches a diverged fast-forward instead of dying under `set -euo pipefail`.
- **Port preflight.** New `scripts/check-ports.mjs` runs as `prestart:all` and fails fast with an actionable message (naming `GATEWAY_PORT` / `PORT`) when 8642 or 3000 is already bound, instead of `concurrently` silently swallowing the gateway bind failure.
- **Actionable connection-check.** The onboarding connection step now distinguishes "gateway not running" vs "HTTP API disabled (`API_SERVER_ENABLED`)" vs reachable-but-unusable, each with its own fix hint.
- **Provider gate.** The onboarding model step blocks completion when no provider/model is configured, so users can't click through into a dead chat. Externally-managed backends still pass.
- **Restart hint.** After enabling `API_SERVER_ENABLED=true`, `install.sh` warns to `hermes gateway restart` if a gateway is already running.

### Changed

- The "install for full features" hint in `gateway-capabilities.ts` now points at the Interstellar-code fork installer.

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
