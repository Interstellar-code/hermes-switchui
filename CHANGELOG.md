# Changelog

All notable changes to Switch UI are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

**Zero-fork release.** Clone, don't fork. Hermes Workspace now runs on vanilla `pip install hermes-agent` with no patches, no drift, no custom gateway required.

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
