# SwitchUI — Config / Env / Setup Docs Drift Report

- Task: `t_53bd4afb` (parent `t_66897043` docs-freshness inventory)
- Generated: 2026-06-13
- Method: read-only comparison of documented env vars, config samples, and setup steps against current code (`.env.example`, `docker-compose.yml`, `Dockerfile`, `vite.config.ts`, `install.sh`, `package.json`, `src/server/*`) and docs (`docs/getting-started/install.md`, `connecting-provider.md`, `deployment/unraid.md`, `README.md`). No writes to repo state.
- Source of truth for "real default" = the value the code actually falls back to, not what any single doc claims.

---

## Headline drifts (high-impact, will mislead a new user)

### 1. `.env.example` claims `PORT` default is **3002** — code says **3000**

- `.env.example:56-57`:
  ```
  # Server port (default: 3002)
  # PORT=3002
  ```
- Every other source of truth says **3000**:
  - `src/server/hermes-plugin-sync.ts:185` → `const port = Number(process.env.PORT) || 3000`
  - `Dockerfile:57` → `ENV ... PORT=3000`
  - `docker-compose.yml:67` → `'127.0.0.1:3000:3000'`
  - `docs/getting-started/install.md` (Prerequisites, dev section, verify section) — "3000 (UI)" throughout
  - `README.md` — `http://localhost:3000` everywhere, and line 205 explicitly: `pnpm dev # http://localhost:3000 (override with PORT=4000 pnpm dev)`
  - `docs/deployment/unraid.md` — port `3000` everywhere
- **Real default: 3000.** The `.env.example` comment is the only place that says 3002. A user who trusts the comment and sets `PORT=3002` would then have to reconcile it against docs/Docker that assume 3000 — confusing but not broken (PORT is honored). Either fix the comment to say 3000, or drop the commented-out line entirely (it's misleading as-is).
- Severity: medium. No functional break, but it's the single most-consulted config file and it contradicts itself with the rest of the product.

### 2. `HERMES_DASHBOARD_URL` is documented everywhere — **missing from `.env.example`**

- The dashboard (port 9119) is the **second critical backend**. Per `install.md` and `README.md`, "the dashboard is not optional for the full experience — without it, chat works but sessions/skills/memory/kanban/MCP show errors."
- `HERMES_DASHBOARD_URL` is documented in:
  - `docs/getting-started/install.md:179` — "Gateway/dashboard URLs resolve from environment variables (`HERMES_API_URL`, `HERMES_DASHBOARD_URL`)"
  - `README.md:200, 226, 232, 360` — explicit `echo 'HERMES_DASHBOARD_URL=...' >> .env` instructions
  - Code: `src/server/gateway-capabilities.ts:114-116` → `process.env.HERMES_DASHBOARD_URL || process.env.CLAUDE_DASHBOARD_URL || 'http://127.0.0.1:9119'`
- It is **not** in `.env.example`. `HERMES_API_URL` *is* (line 38). This is an asymmetry: the two backends are treated as co-equal in every doc, but only the gateway URL made it into the env template.
- Severity: high. The dashboard is required for full functionality; a user copying `.env.example` to `.env` (the documented Docker/dev flow) gets no prompt to set its URL, and the loopback default only works when the dashboard runs on the same host as the UI.

### 3. `HERMES_DASHBOARD_TOKEN` is in `.env.example` but its sibling auth var `HERMES_API_TOKEN` lacks the reciprocal relationship clarity

- `.env.example:112` documents `HERMES_DASHBOARD_TOKEN` (preferred over legacy HTML-scrape token flow).
- `.env.example:40-50` documents `HERMES_API_TOKEN` and correctly states it must match the agent's `API_SERVER_KEY`.
- These two are consistent with each other and with `README.md:496-497`. No drift here — listed for completeness. (Token-pairing semantics are well-documented.)

---

## Undocumented env vars (consumed by code, absent from `.env.example`)

These are read by server code but have no entry in `.env.example`. Some are legacy aliases (acceptable to leave undocumented if intentionally deprecated); others are real knobs a user might want.

| Env var | Where consumed | Default | Notes |
|---|---|---|---|
| `HERMES_DASHBOARD_URL` | `gateway-capabilities.ts:115` | `http://127.0.0.1:9119` | **See drift #2 above.** Documented in README/install, missing from `.env.example`. Should be added. |
| `CLAUDE_DASHBOARD_URL` | `gateway-capabilities.ts:116` | — | Legacy alias for `HERMES_DASHBOARD_URL`. Acceptable to leave undocumented (back-compat). |
| `HERMES_WEBUI_DEFAULT_WORKSPACE` | `src/routes/api/workspace.ts:322` | unset | Preselects a workspace folder on first run. Useful for shared deployments. Undocumented in `.env.example` AND in user-facing docs. Worth adding if the feature is intended to be supported. |
| `HERMES_SKILLS_DIR` | `src/routes/api/skills.ts:19` | `<HERMES_HOME>/skills` | Overrides the skills directory. Undocumented. Niche; probably fine to leave out unless someone asks. |
| `HERMES_WORKSPACE_METRICS_DISK_PATH` | `src/routes/api/system-metrics.ts:66` | `os.homedir()` | Which mount to report disk usage for. Undocumented. Niche. |
| `MCP_HUB_CACHE_TTL_MS` | `src/server/mcp-hub/cache.ts:45` | 30 min (1800000) | Distinct from `MCP_TOOLS_CACHE_TTL_MS` (1 min, which IS documented at `.env.example:127`). Two different MCP caches, two different TTLs, two different env names — easy to confuse. The documented one (`MCP_TOOLS_CACHE_TTL_MS`) is the tool-list cache; the undocumented one (`MCP_HUB_CACHE_TTL_MS`) is the MCP-hub tier-1 cache. Worth at least a comment clarifying the distinction. |
| `CLAUDE_GATEWAY_URL` | `src/server/gateway.ts:117` | `ws://127.0.0.1:18789` | Internal WebSocket gateway for agent IPC. Legacy naming. Not something users typically touch. |
| `CLAUDE_GATEWAY_TOKEN` | `src/server/gateway.ts:118` | unset | Auth token for the WS gateway above. |
| `CLAUDE_GATEWAY_PASSWORD` | `src/server/gateway.ts:119` | unset | Password for the WS gateway above. |
| `HERMES_HOME` | many (paths.ts, gateway.ts, models.ts, skills.ts, mcp-hub/cache.ts, etc.) | `~/.hermes` | Override the Hermes data root. Set by Docker (`/opt/data`). Not in `.env.example` but IS in `Dockerfile:59` and `unraid.md:22`. Reasonable to omit from `.env.example` since non-Docker users rarely change it; but it's the most-used override after PORT/API_URL and a user hand-configuring would benefit from seeing it. |

**Recommendation:** at minimum add `HERMES_DASHBOARD_URL` (drift #2). Optionally add `HERMES_HOME` and `HERMES_WEBUI_DEFAULT_WORKSPACE`. Leave the `CLAUDE_GATEWAY_*` and legacy aliases undocumented unless someone surfaces a use case.

---

## Setup-step drift

### 4. `install.md` correctly documents the two-backend model, but `.env.example` undercuts it

- `install.md:8-15` is explicit and accurate: gateway on 8642 (chat), dashboard on 9119 (everything else), UI on 3000. The table is correct and matches code.
- `install.md:177-179` ("Config lives in `.env`") says both `HERMES_API_URL` and `HERMES_DASHBOARD_URL` resolve from env. This is true in code but **asymmetric in `.env.example`** — only `HERMES_API_URL` appears. A reader following install.md who then opens `.env.example` as their reference will not find the dashboard var. (Same root cause as drift #2.)
- No factual error in install.md itself; the drift is that `.env.example` doesn't back up what install.md tells users to configure.

### 5. `API_SERVER_ENABLED` placement is consistent and correct

- `install.md:181-187`, `.env.example:33-37`, `install.sh:214`, `Dockerfile:61`, `docker-compose.yml:38` all agree: `API_SERVER_ENABLED=true` lives in the **agent's** `~/.hermes/.env`, not the UI's `.env`, and is required for the gateway's HTTP API. No drift.

### 6. Docker compose env passthrough is broader than `.env.example`

- `docker-compose.yml:44-50` passes through `GROQ_API_KEY` and `MISTRAL_API_KEY` in addition to the four in `.env.example` (Anthropic/OpenAI/OpenRouter/Google). These two extra provider keys are not in `.env.example`'s LLM-provider section.
- Not strictly drift (compose uses `${VAR:-}` so absence is harmless), but a user following `.env.example` as the canonical provider list won't know Groq/Mistral are supported. Low severity; consider adding commented entries for completeness.

### 7. `HERMES_LOG_LEVEL` appears in unraid.md but nowhere else

- `docs/deployment/unraid.md:63` documents `HERMES_LOG_LEVEL=DEBUG` for troubleshooting.
- Not in `.env.example`, not consumed in `src/` (it's an agent-side var, consumed by hermes-agent not SwitchUI). This is fine — it's documenting an agent env var in a deployment doc — but the distinction ("this controls the agent, not the UI") isn't called out. A reader might add it to the UI's `.env` expecting it to do something. Minor.

---

## Consistency checks that PASSED (no drift)

For completeness, these were verified consistent across `.env.example`, code, and docs:

- `HERMES_API_URL` default `http://127.0.0.1:8642` — matches `claude-agent.ts:7` (`DEFAULT_GATEWAY_PORT = 8642`), `vite.config.ts:88`, `Dockerfile:60`, `docker-compose.yml:37`. ✓
- `HOST` default `127.0.0.1` and the fail-closed guard (requires `HERMES_PASSWORD` for non-loopback) — consistent across `.env.example:63-76`, `README.md:486`, `Dockerfile:58`. ✓
- `COOKIE_SECURE` semantics (1 to force, 0 to disable, auto in production) — `.env.example:78-88` matches code behavior. ✓
- `TRUST_PROXY` — `.env.example:90-97` matches `src/server/rate-limit.ts:89`. ✓
- `STREAM_ACCEPTED_TIMEOUT_MS` / `STREAM_HANDOFF_TIMEOUT_MS` defaults (120000 / 300000) — `.env.example:104-106` matches `src/routes/api/models.ts:148-149`. ✓
- `HERMES_TERMINAL_DETACH_TTL_MS` default 300000 — `.env.example:134-135` consistent with intent. ✓
- `MCP_TOOLS_CACHE_TTL_MS` default 60000 — `.env.example:127` matches the tool-list cache. ✓ (Distinct from the undocumented `MCP_HUB_CACHE_TTL_MS` — see table above.)
- `TERMINAL_ALLOWED_BINARIES`, `ALLOWED_GATEWAY_HOSTS`, `RATE_LIMIT_CLEANUP_MS` — all present and accurate. ✓
- `VITE_REACT_GRAB` and `VITE_USERBACK_TOKEN` — `.env.example:176-185` matches `install.md:189-191` and code stripping behavior. ✓
- Legacy aliases (`CLAUDE_PASSWORD` → `HERMES_PASSWORD`, `CLAUDE_ALLOW_INSECURE_REMOTE` → `HERMES_ALLOW_INSECURE_REMOTE`, `CLAUDE_HOME` → `HERMES_HOME`) — consistently honored as back-compat, documented as such in `.env.example:75, 118`. ✓

---

## Summary table

| # | Drift | Severity | Fix |
|---|---|---|---|
| 1 | `.env.example` says `PORT` default 3002; real default is 3000 | Medium | Change comment to 3000 or remove the line |
| 2 | `HERMES_DASHBOARD_URL` missing from `.env.example` despite being the 2nd critical backend | High | Add entry to `.env.example` |
| 3 | `MCP_HUB_CACHE_TTL_MS` undocumented; easily confused with documented `MCP_TOOLS_CACHE_TTL_MS` | Low | Add a disambiguating comment |
| 4 | `docker-compose.yml` passes `GROQ_API_KEY`/`MISTRAL_API_KEY` not in `.env.example` | Low | Add commented entries |
| 5 | `HERMES_LOG_LEVEL` in unraid.md without "agent-side" caveat | Low | Add a note |
| 6 | `HERMES_WEBUI_DEFAULT_WORKSPACE`, `HERMES_SKILLS_DIR`, `HERMES_WORKSPACE_METRICS_DISK_PATH` undocumented | Low | Add if features are meant to be supported |

**Net:** 1 high-severity drift (`HERMES_DASHBOARD_URL`), 1 medium (`PORT` comment), 4 low. The high-severity item is the one most likely to bite a new Docker/remote-deploy user — they copy `.env.example`, don't see the dashboard var, and lose sessions/skills/memory/kanban/MCP silently. The PORT comment is cosmetic but is the first line a new user reads in the config file.
