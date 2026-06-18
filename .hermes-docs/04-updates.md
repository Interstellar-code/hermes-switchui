# SwitchUI Docs — Prioritized Update Checklist

- Generated: 2026-06-13 (task `t_d225bb24`)
- Synthesizes three drift reports: `01-readme.md` (8 README gaps), `02-apidocs.md` (4 API/reference gaps), `03-config.md` (6 config/env drifts). Total: **18 distinct edits**.
- Scope: propose only. No repo state was modified writing this file. Each item has a ready-to-paste edit and a source pointer (file:line or report section).
- Priority tiers:
  - **P0** — wrong fact a new user hits on first load, or silent functional breakage for Docker/remote users. Do these first.
  - **P1** — one-paragraph corrections with high value/effort ratio. Missing feature mentions.
  - **P2** — net-new doc pages or larger additive sections. Higher effort but additive (no existing wrong text to fix).
  - **P3** — cosmetic, disambiguation, niche. Ship opportunistically.

Effort estimates: S = single line, M = a paragraph or table row, L = a new section, XL = a new page.

---

## P0 — Correct first-load wrongs (do these 4 now)

### 1. `.env.example`: add `HERMES_DASHBOARD_URL`  [config #2]
Effort: S · Severity: High · Why first: Docker/remote users who copy the template silently lose sessions, skills, memory, kanban, and MCP — the dashboard (port 9119) is the second critical backend but is absent from the template.

**Paste into `.env.example`** (place it right after the `HERMES_API_URL` block around line 38):

```
# Dashboard URL (2nd backend — required for sessions/skills/memory/kanban/MCP).
# Defaults to loopback; override for Docker or remote deployments.
# HERMES_DASHBOARD_URL=http://127.0.0.1:9119
```

Source: `03-config.md` §"Headline drifts" #2; consumed at `src/server/gateway-capabilities.ts:114-116`.

---

### 2. README: fix the themes list (count, default, membership)  [readme #1]
Effort: M · Severity: High · Why first: a user setting "Matrix as default" per the README will be confused; the picker shows 10, not 5.

**Replace the `README L36` table cell and the `L437–438` "Themes" subsection with:**

```
Ten themes (five dark + five matching light variants): Nous (default), Matrix, Hermes, Bronze, Slate.
Each dark theme has a `-light` twin selectable directly from the theme picker; SwitchUI auto-switches
between dark/light variants when the OS toggles mode. Applied via `data-theme` on `<html>`.
Stored in `localStorage` under `claude-theme`.
```

Source: `01-readme.md` Gap 1; verified against `src/lib/theme.ts` (`DEFAULT_THEME = 'claude-nous'`, `THEMES` = 10 entries).

---

### 3. README: fix the meta bar description (drop ctx %/tool count, add cost)  [readme #2]
Effort: M · Severity: High · Why first: the README currently *promises* features (`ctx %`, `tool count`) that don't exist, and *omits* the headline per-session cost feature that does.

**Replace the `README L39` table cell with:**

```
Meta bar: streaming `tok/s`, per-session **cost** (USD, with in/out/cache/reasoning tooltip),
model/profile/workspace/thinking selectors, and session id. Cost is hidden when the gateway reports $0
(subscription providers).
```

Then grep the README for any remaining `ctx %` or `tool count` mentions and delete/correct them.

Source: `01-readme.md` Gap 2; verified against `src/screens/chat/components/v2/chat-meta-bar-v2.tsx`.

---

### 4. `.env.example`: fix the `PORT` comment (says 3002, real default is 3000)  [config #1]
Effort: S · Severity: Medium (promoted to P0 because it's the first line a new user reads and it contradicts every other source).

**Replace `.env.example:56-57`:**

```
# Server port (default: 3000)
# PORT=3000
```

Source: `03-config.md` §"Headline drifts" #1; real default verified across `Dockerfile:57`, `docker-compose.yml:67`, `src/server/hermes-plugin-sync.ts:185`, `README.md`, `docs/getting-started/install.md`, `docs/deployment/unraid.md`.

---

## P1 — One-paragraph corrections (high value, low effort)

### 5. README: fix the sidebar sources list (4 listed, actually 8)  [readme #3]
Effort: M · Severity: Med.

**Replace `README L37` and `L473–474` source lists with:**

```
chat, task, cron, api, tools, cli, a2a, telegram
```

**Add a sentence under the sidebar subsection:**

```
Telegram, CLI, and A2A sessions are deletable and clickable like native chats.
```

Source: `01-readme.md` Gap 3; verified at `src/screens/chat/components/sidebar/v2/sidebar-source-chips-v2.tsx` (`SOURCE_DEFS` = 8 entries).

---

### 6. README: add a "What's new" row for Board Templates, Self-Improve, Commands  [readme #4]
Effort: M · Severity: Med. Three top-level nav routes are reachable but invisible to a README reader.

**Add rows to the comparison table (around `L34–43`) and/or a "What's new" bullet list under "Switch UI specifics":**

```
- **Board Templates** — reusable YAML task definitions with variables, recurrence, and dependency edges. Save-as-template + instantiate wizard at `/board-templates`.
- **Self-Improve** — capability-gated scorecard with a P0–P3 experiment lifecycle (propose/approve/apply/verify/revert), baselines, and scenarios. At `/self-improve`.
- **Custom Commands** — SwitchUI-owned SQLite command store, composer slash menu, and macros. At `/commands`.
- **Hermes plugin settings** — bidirectional config sync between the settings UI and the gateway plugin endpoint.
```

Source: `01-readme.md` Gap 4; nav entries at `primary-nav-v2.tsx:579,583`.

---

### 7. `docs/main/chat/sessions.md`: document the `session-status` response + new cost fields  [apidocs #3]
Effort: L · Severity: Med (any external consumer of the BFF relies on the documented shape).

**Add a "### Session status endpoint" subsection:**

````markdown
### Session status endpoint

`GET /api/session-status?sessionKey=...` returns a `payload` object. Recent additions (v2.3.44+):

| Field | Type | Source |
|---|---|---|
| `cost` | number | `actual_cost_usd ?? estimated_cost_usd ?? 0` |
| `estimatedCost` | number | `estimated_cost_usd ?? 0` |
| `cacheReadTokens` | number | `cache_read_tokens ?? 0` |
| `cacheWriteTokens` | number | `cache_write_tokens ?? 0` |
| `reasoningTokens` | number | `reasoning_tokens ?? 0` |
| `apiCallCount` | number | `api_call_count ?? 0` |

Pre-existing fields (`status`, `sessionKey`, `model`, `modelProvider`, `inputTokens`, `outputTokens`,
`totalTokens`, `source`, `endReason`, `contextPercent`, `maxTokens`, `usedTokens`, `sessions[]`) are unchanged.

**404 fallback:** if the gateway returns 404 for the session key, the endpoint returns
`{ ok: true, payload: { status: 'idle', sessions: [] } }` (HTTP 200) so clients stop retrying.
````

Source: `02-apidocs.md` Gap 3; new fields at `src/routes/api/session-status.ts:112-153`, fallback at `:158-172`.

---

### 8. `docs/main/chat/sessions.md`: document the `X-Hermes-Session-Id` header  [apidocs #4]
Effort: S · Severity: Low-Med (wire-contract change).

**Add under the session-persistence / reliability section:**

```
Each `POST /api/send-stream` request carries an `X-Hermes-Session-Id` header that binds the run to a
persistent session key. This is what lets the chat recover its place after a BFF restart or tab refresh.
(`X-Claude-Session-Id` is the deprecated legacy name.)
```

Source: `02-apidocs.md` Gap 4; constant at `src/lib/send-stream-session-headers.ts:2-6`.

---

### 9. README: resolve the NousResearch vs Interstellar-code org inconsistency  [readme #6]
Effort: S · Severity: Med. A reader following the L13 link lands on a repo that may not match what `install.sh` actually clones.

**Pick one of:**
- (a) If the agent backend is genuinely at NousResearch and the installer uses a fork, clarify `README L13`:

  ```
  backend installer pulls the Interstellar-code fork of
  [Hermes Agent](https://github.com/NousResearch/hermes-agent)
  ```

- (b) If Interstellar-code is canonical for the backend, change L13's link to `https://github.com/Interstellar-code/hermes-agent` to agree with `install.sh:21`.

Source: `01-readme.md` Gap 6; `install.sh:21` hard-codes `Interstellar-code/hermes-agent`.

---

### 10. README: narrow the stale screenshots caveat  [readme #5]
Effort: S · Severity: Med. The blanket "screenshots don't yet show the Matrix UI" claim is now a month stale relative to the May-11 terminal shots.

**Replace `README L48–50`:**

```
Most screenshots under `docs/screenshots/` predate the Matrix redesign. The terminal shots
(`terminal-redesign-*.png`, 2026-05-11) and splash reflect the current Matrix aesthetic.
```

Source: `01-readme.md` Gap 5; `docs/screenshots/terminal-redesign-rain-upgraded.png` dated 2026-05-11.

---

## P2 — Larger additive content (net-new sections/pages)

### 11. `docs/main/boards.md`: add a Board Templates section  [apidocs #1]
Effort: L · Severity: High for integrators (6 routes, 7 types, zero docs mentions). The feature is live.

**Append after "## Where data comes from":**

````markdown
## Board templates (v2.3.44+)

A board template is a reusable YAML definition of tasks, variables, recurrence, and dependency edges.
Templates are stored in the Hermes dashboard Kanban plugin and managed through SwitchUI's BFF proxy:

- `GET /api/hermes-kanban/templates` — list summaries (slug, name, variables, has_recurrence)
- `POST /api/hermes-kanban/templates` — save a template from raw YAML (`{ yaml, slug? }`)
- `GET /api/hermes-kanban/templates/{slug}` — full definition (tasks, variables, recurrence, links)
- `PUT /api/hermes-kanban/templates/{slug}` — update YAML
- `POST /api/hermes-kanban/templates/{slug}/instantiate` — spawn a board from the template.
  Body: `{ variables?, board_slug?, auto_dispatch?, tenant? }`.
  Returns `{ ok, board_slug, instance_id, task_ids[], created, skipped }`.
- `POST /api/hermes-kanban/boards/{slug}/save-as-template` — snapshot an existing board into a template
  (`{ template_slug, name?, reset_status? }`).

Per-task fields (TemplateTask): `max_runtime_seconds`, `goal_max_turns` + `goal_mode` (goal-loop cap),
and `scheduled_at` (accepts `+2h`, a unix epoch, or a `{{variable}}` resolved at instantiate). Templates
also carry dependency edges via `links: Array<[parentKey, childKey]>`.
````

Source: `02-apidocs.md` Gap 1; routes under `src/routes/api/hermes-kanban/templates*.ts`, types at `src/lib/hermes-kanban-types.ts:329-417`.

---

### 12. Create `docs/main/self-improve.md` (net-new page)  [apidocs #2]
Effort: XL · Severity: High for integrators (16 routes, no page exists, and `/propose` has a `200`-vs-`202` nuance that will trip clients).

**Create a new file** `docs/main/self-improve.md` covering:
1. Feature-gate note (capability flag from `GET /api/self-improve/health`).
2. The lifecycle mapped to routes: `POST /propose` → `POST /experiments/{id}/approve|reject` → `/apply` → `/verify` → `/revert`; `GET /experiments/{id}/history` for the audit trail.
3. **The `200` vs `202` distinction on `/propose`:** `202` = new experiment queued; `200` = no proposal generated (skipped). Do not treat both as "created".
4. Scenarios (`GET/POST /scenarios`, `DELETE /scenarios/{id}`) and profile pause/resume (`/profiles/{profile}/pause|resume`).
5. Baselines + metrics (`GET /baselines`, `GET/POST /metrics`, `GET /metrics/latest`).

Then wire it into `docs/welcome.md`'s feature list and the sidebar nav.

**Full route table** is in `02-apidocs.md` Gap 2 — copy verbatim into the new page.

Source: `02-apidocs.md` Gap 2; 16 handlers under `src/routes/api/self-improve/*.ts`.

---

### 13. README: manifest provider — note the bidirectional settings sync  [readme #7]
Effort: S · Severity: Low.

**Add a one-liner under the manifest example (`README L455–470`):**

```
Settings → Hermes Plugin now syncs this config bidirectionally with the gateway; hand-editing
`config.yaml` is still supported but may be reconciled on next settings save.
```

Source: `01-readme.md` Gap 7; wiring at `src/server/hermes-plugin-sync.ts`.

---

## P3 — Cosmetic / disambiguation / niche

### 14. `.env.example`: disambiguate the two MCP cache TTLs  [config #3]
Effort: S · Severity: Low. `MCP_HUB_CACHE_TTL_MS` (30 min, hub tier-1) is undocumented and confusable with the documented `MCP_TOOLS_CACHE_TTL_MS` (1 min, tool-list).

**Add a comment near the existing `MCP_TOOLS_CACHE_TTL_MS` entry (`.env.example:127`):**

```
# Tool-list cache (this var, 1 min). Distinct from MCP_HUB_CACHE_TTL_MS (hub tier-1 cache, 30 min,
# undocumented here because it rarely needs tuning).
```

Source: `03-config.md` drift table #3; consumed at `src/server/mcp-hub/cache.ts:45`.

---

### 15. `.env.example`: add commented Groq/Mistral provider entries  [config #4]
Effort: S · Severity: Low. `docker-compose.yml` passes them through but they're absent from the provider section.

**Add to the LLM-provider section:**

```
# GROQ_API_KEY=
# MISTRAL_API_KEY=
```

Source: `03-config.md` drift #4; passthrough at `docker-compose.yml:44-50`.

---

### 16. `docs/deployment/unraid.md`: caveat `HERMES_LOG_LEVEL` is agent-side  [config #5]
Effort: S · Severity: Low.

**Add a note next to the `HERMES_LOG_LEVEL=DEBUG` line (`unraid.md:63`):**

```
(Controls the Hermes agent backend, not the UI.)
```

Source: `03-config.md` drift #5.

---

### 17. `.env.example`: optionally add `HERMES_HOME` and `HERMES_WEBUI_DEFAULT_WORKSPACE`  [config #6]
Effort: S · Severity: Low (only if these features are meant to be user-facing).

```
# Override the Hermes data root (defaults to ~/.hermes; Docker sets /opt/data).
# HERMES_HOME=

# Preselect a workspace folder on first run (useful for shared deployments).
# HERMES_WEBUI_DEFAULT_WORKSPACE=
```

Leave `HERMES_SKILLS_DIR` and `HERMES_WORKSPACE_METRICS_DISK_PATH` undocumented (niche).

Source: `03-config.md` "Undocumented env vars" table; consumed at `src/routes/api/workspace.ts:322` and throughout.

---

### 18. README: add a dashboard-required forward-reference once Gap 6 lands  [readme #8]
Effort: S · Severity: Low (no drift currently; only relevant after item #6 ships).

**When the Board Templates/Self-Improve/Commands rows are added, append:**

```
Board Templates, Self-Improve, and Jobs all require the dashboard running.
```

Source: `01-readme.md` Gap 8.

---

## Summary by tier

| Tier | Count | What it buys you |
|---|---|---|
| P0 | 4 (#1–4) | Stops new users hitting wrong facts on first load; stops Docker users silently losing dashboard features. ~10 minutes of edits. |
| P1 | 6 (#5–10) | Sidebar/sources correctness, new-feature discoverability, session-status contract. ~30–45 minutes. |
| P2 | 3 (#11–13) | Board Templates section, Self-Improve page, manifest sync note. ~2–3 hours (Self-Improve page is the bulk). |
| P3 | 5 (#14–18) | Cosmetic, disambiguation, niche. Ship opportunistically. |

## Cross-cutting notes

- **Items 2, 3, 5, 6** all live in `README.md` and can be done in a single editing pass (the README was last touched Jun 5, before the entire 7-day feature window — it needs a refresh regardless).
- **Items 7, 8** both touch `docs/main/chat/sessions.md` — do them together.
- **Items 1, 4, 14, 15, 17** all touch `.env.example` — do them in a single pass.
- **Item 12 (Self-Improve page)** is the only XL item and the only net-new page. Everything else is a patch to an existing file.

All claims were verified against live source at `/Volumes/Ext-nvme/Development/hermes-switchui` on 2026-06-13 by the three parent worker tasks. No repo state was modified in the production of this checklist.
