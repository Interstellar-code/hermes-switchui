# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # dev server on :3000, auto-starts hermes-agent sidecar
pnpm build        # production build → .output/
pnpm start        # run production build
pnpm test         # vitest run (all tests)
pnpm lint         # eslint
pnpm check        # prettier --write + eslint --fix

# Single test file
pnpm vitest run src/server/auth-middleware.test.ts
pnpm vitest run --reporter=verbose src/stores/chat-store.test.ts
```

Copy `.env.example` → `.env` before first run. Minimum required: nothing for localhost; `HERMES_PASSWORD` required when binding to `0.0.0.0`.

## Project Identity: hermes-switchui

This is **hermes-switchui** — Interstellar Code's opinionated UI — Hermes Switch UI.

### Fork strategy

- `origin` = `Interstellar-code/hermes-switchui` — hermes-switchui home
- `upstream` = `outsourc-e/hermes-workspace` — canonical Hermes Workspace
- `local` / `hermes-switchui` branch = hermes-switchui baseline. **Never blindly rebase or merge from upstream.**
- Sync strategy: **cherry-pick** upstream fixes periodically; never `git merge upstream/main` or `git rebase upstream/main`.
- Upstream PRs: only small isolated backend/infra/bug fixes with no UI opinion.
- hermes-switchui features (never upstream): composer design, context ring, Matrix theme, custom provider UI, Switch-specific features.

## Architecture

### Framework: TanStack Start

This is a **TanStack Start** app (SSR meta-framework built on Vite + TanStack Router). Key implication: `src/routeTree.gen.ts` is **auto-generated** by the router Vite plugin — never edit it manually. Changes to files in `src/routes/` trigger regeneration.

### Route / API split

```
src/routes/           ← file-based routes (TanStack Router)
  __root.tsx          ← root layout, QueryClient, theme bootstrap, onboarding gate
  api/                ← server-only API handlers
    send.ts, chat-events.ts, sessions/, ...
  chat/$sessionKey.tsx
  dashboard.tsx, files.tsx, memory.tsx, ...

src/server/           ← server-side modules (never bundled to client)
  auth-middleware.ts  ← session token auth, persists to ~/.hermes/workspace-sessions.json
  hermes-api.ts       ← HTTP/SSE client for the hermes-agent gateway (port 8642)
  gateway-capabilities.ts ← probes gateway on startup; gates features
  openai-compat-api.ts    ← OpenAI-compatible streaming for non-Hermes backends
  terminal-sessions.ts    ← PTY session management
  pty-helper.py           ← Python PTY bridge (copied to dist/server/assets/ at build)
  rate-limit.ts           ← per-IP rate limiting + CSRF (Content-Type check)
```

API routes in `src/routes/api/` use `createFileRoute` with a `server: { handlers: { POST: ... } }` block. Server code in those files is never sent to the browser.

### Hermes gateway

The Python `hermes-agent` process runs on port **8642** and is the AI backend. The workspace:

- Proxies REST calls via `/api/hermes-proxy` → `HERMES_API_URL`
- Proxies WebSockets via `/ws-hermes`
- Probes capabilities at startup (`ensureGatewayProbed()`) to detect `sessions`, `tasks`, `jobs`, etc.
- Auto-starts the agent during `pnpm dev` if not already running

### Provider config (hermes-switchui specific)

The gateway uses a named `manifest` provider entry (not `custom`) — `custom` is a reserved type name and `_get_named_custom_provider` returns `None` for it.

Config shape written by the UI:
```yaml
model:
  default: auto
  provider: manifest
providers:
  manifest:
    type: openai
    base_url: http://your-endpoint/v1
    key_env: CUSTOM_API_KEY
```

API key stored in `~/.hermes/.env` as `CUSTOM_API_KEY`.

### Chat / streaming

SSE streaming flows through `src/routes/api/chat-events.ts` and `src/routes/api/sessions/`. All streaming updates are typed as `ChatStreamEvent` and consumed by the Zustand `chat-store`. The `chat-backends.ts` layer selects between enhanced Hermes sessions API and the OpenAI-compat fallback based on gateway capabilities.

### Client state

- **Zustand** (`src/stores/`) for all client-side state
- **TanStack Query** for server-fetched data (models, sessions list, files, memory)

### Themes

10 themes (5 base × dark/light): `claude-nous`, `claude-official`, `claude-classic`, `claude-slate`, `matrix`. Applied via `data-theme` attribute on `<html>`. Stored in `localStorage` under key `claude-theme`.

### Environment variables (key ones)

| Variable            | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `HERMES_API_URL`    | Gateway URL (default `http://127.0.0.1:8642`)                        |
| `HERMES_API_TOKEN`  | Gateway auth token (when gateway sets `API_SERVER_KEY`)              |
| `HERMES_PASSWORD`   | Workspace UI password (required for remote deployments)              |
| `CUSTOM_API_KEY`    | API key for custom OpenAI-compatible endpoint (stored in .env)       |
| `PORT`              | Workspace server port (default 3000)                                 |

## codebase-memory (MCP)

This project is indexed by the `codebase-memory` MCP server — a tree-sitter + hybrid-LSP knowledge graph (functions, classes, call chains, routes). Reach for it **before** grep/raw file reads for any structural or cross-module question.

Use the right tool for the job:

| Question | Tool |
| --- | --- |
| "How is the codebase laid out?" languages, routes, hotspots, clusters | `get_architecture` |
| "Where is `X` defined / what symbols match a pattern?" | `search_graph` (filter with `file_pattern: "src/.*"`) |
| "Who calls `X` / what does `X` call?" blast radius | `trace_path` (`direction: both`, depth 1-5) |
| "Show me the source of `X`" | `get_code_snippet` (needs `qualified_name` from `search_graph`) |
| Arbitrary graph query (counts, relationships) | `query_graph` (read-only openCypher subset) |
| Plain text/grep within indexed files | `search_code` (param is `pattern`) |
| "What does my current git diff impact?" | `detect_changes` |
| Persist/recall architecture decisions | `manage_adr` |

Rules:
- Always pass `file_pattern: "src/.*"` (or scope by path) on `search_graph`/`trace_path`. `electron/server-bundle.cjs` is a 34 MB committed build bundle that is indexed and otherwise pollutes results.
- Re-run `index_repository` after large changes — `auto_index` is off. Graph data lives centrally in `~/.cache/codebase-memory-mcp/` (one `.db` per project), **not** in the repo.
- Optional UI: `codebase-memory-mcp --ui=true --port=9749` serves a graph viz while the MCP server is running.

<!-- a2a-fleet:start -->
@.hermes/A2A.md
<!-- a2a-fleet:end -->
