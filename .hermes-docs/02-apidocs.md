# SwitchUI — API / Reference Doc Drift (7-day window)

- Generated: 2026-06-13 (task t_860c84eb)
- Scope: API endpoints, request params, response types, and request/response contract changes shipped in the last 7 days (commits listed in `.hermes-docs/00-context.md`) but NOT reflected in user-facing docs under `/docs`.
- Method: read-only. Enumerated `src/routes/api/**/*.ts`, diffed against `git log --since="7 days ago"` for touched routes, then read each new/changed handler's params + body + response shape and compared against the corresponding `docs/` page.
- Repo: `/Volumes/Ext-nvme/Development/hermes-switchui`

---

## Summary

4 distinct API/reference drift gaps, ranked by user-facing surface (largest first).

| # | Gap | New routes/types | Docs page that should cover it | Commit |
|---|---|---|---|---|
| 1 | Board Templates API surface — undocumented | 6 new routes, 7 new types | `docs/main/boards.md` (mentions 0 of them) | `01e0ed22`, `b5d6f4da`, `bf41c98b` |
| 2 | Self-Improve API surface — undocumented, no docs page exists | 16 new routes | (no `docs/main/self-improve.md`) | `2c17cea0`–`23e4c0e9` |
| 3 | `GET /api/session-status` response shape expanded — not reflected | response added 6 new fields | `docs/main/chat/sessions.md` (silent) | `162aa3f4`, `8f1b671f` |
| 4 | `X-Hermes-Session-Id` request header contract — not reflected | new header on `POST /api/send-stream` | `docs/main/chat/sessions.md`, troubleshooting | `192abff3` |

Details, evidence, and suggested edits below.

---

## Gap 1 — Board Templates API surface (HIGH)

**What shipped:** A full Board Templates feature — management page, 5-step wizard, save-as-template + instantiate endpoints, runtime/turn fields — added to the kanban BFF proxy layer under `src/routes/api/hermes-kanban/`.

**What's documented:** `docs/main/boards.md` (66 lines) covers only board CRUD (`GET/POST/PATCH/DELETE /api/hermes-kanban/boards`). It mentions templates **zero times**. The feature spec lives only in `.omc/specs/board-templates/SPEC.md` + `WIZARD.md` (internal, not user-facing).

### New routes (6)

| Method | Path | Body / Param | Status | Commit |
|---|---|---|---|---|
| `GET` | `/api/hermes-kanban/templates` | — | 200 / 503 | `01e0ed22` |
| `POST` | `/api/hermes-kanban/templates` | `{ yaml: string, slug?: string }` (yaml required → 422 if missing) | 201 / 400 / 404 / 409 / 413 / 422 / 503 | `01e0ed22` |
| `GET` | `/api/hermes-kanban/templates/$slug` | `slug` path param | 200 / 400 / 404 / 422 / 503 | `01e0ed22` |
| `PUT` | `/api/hermes-kanban/templates/$slug` | `{ yaml: string }` (yaml required → 422) | 200 / 400 / 404 / 422 / 503 | `01e0ed22` |
| `POST` | `/api/hermes-kanban/templates/$slug/instantiate` | `InstantiateInput` (see types) | 200 / 400 / 404 / 422 / 503 | `01e0ed22` |
| `POST` | `/api/hermes-kanban/boards/$slug/save-as-template` | `SaveAsTemplateInput` (see types) | 200 / 400 / 404 / 422 / 503 | `01e0ed22` |

### New types (from `src/lib/hermes-kanban-types.ts`)

```ts
TemplateVariable     { key, required?, description?, default?, prompt? }
TemplateTask         { key, title, assignee?, status?, body?, priority?,
                       max_runtime_seconds?, goal_max_turns?, goal_mode?,
                       scheduled_at?: string | number }   // +<n><unit> | epoch | {{var}}
TemplateRecurrence   { enabled, cron?, timezone? }
KanbanTemplateSummary { slug, name, description, color, variables[], has_recurrence, path }
KanbanTemplate       { schema, slug, name, description?, tasks[], variables?, recurrence?,
                       color?, links?: Array<[string,string]> }   // parent→child edges
InstantiateResult    { ok, board_slug, instance_id, task_ids[], created, skipped }
InstantiateInput     { variables?: Record<string,string>, board_slug?, auto_dispatch?, tenant? }
SaveAsTemplateInput  { template_slug, name?, reset_status? }
```

Notable `TemplateTask` fields added by `bf41c98b` (follow-up #233): `max_runtime_seconds`, `goal_max_turns`, `goal_mode`, and `scheduled_at` (accepts `+2h` relative offset, epoch int, or `{{variable}}`).

### Suggested edit to `docs/main/boards.md`

Add a new top-level section after "## Where data comes from":

```markdown
## Board templates (v2.3.44+)

A board template is a reusable YAML definition of tasks, variables, recurrence, and
dependency edges. Templates are stored in the Hermes dashboard Kanban plugin and
managed through SwitchUI's BFF proxy:

- `GET /api/hermes-kanban/templates` — list summaries (slug, name, variables, has_recurrence)
- `POST /api/hermes-kanban/templates` — save a template from raw YAML (`{ yaml, slug? }`)
- `GET /api/hermes-kanban/templates/{slug}` — full definition (tasks, variables, recurrence, links)
- `PUT /api/hermes-kanban/templates/{slug}` — update YAML
- `POST /api/hermes-kanban/templates/{slug}/instantiate` — spawn a board from the
  template. Body: `{ variables?, board_slug?, auto_dispatch?, tenant? }`.
  Returns `{ ok, board_slug, instance_id, task_ids[], created, skipped }`.
- `POST /api/hermes-kanban/boards/{slug}/save-as-template` — snapshot an existing
  board into a template (`{ template_slug, name?, reset_status? }`).

Per-task fields (TemplateTask): `max_runtime_seconds`, `goal_max_turns` + `goal_mode`
(goal-loop cap), and `scheduled_at` (accepts `+2h`, a unix epoch, or a `{{variable}}`
resolved at instantiate). Templates also carry dependency edges via `links:
Array<[parentKey, childKey]>`.
```

**Evidence:** `src/routes/api/hermes-kanban/templates.ts`, `templates.$slug.ts`, `templates.$slug.instantiate.ts`, `boards.$slug.save-as-template.ts`; `src/lib/hermes-kanban-types.ts:329–417`; `docs/main/boards.md` (grep `template` → 0 matches).

---

## Gap 2 — Self-Improve API surface (HIGH)

**What shipped:** The P0–P3 self-improving-agent scorecard — baselines, metrics, proposal queue, experiment lifecycle (approve/reject/apply/verify/revert/history), scenarios, profile pause/resume. All behind a capability gate. Code lives under `src/screens/self-improve/` and `src/routes/api/self-improve/`.

**What's documented:** There is **no** `docs/main/self-improve.md` feature page. The only docs references are `docs/plans/self-improve-ux-redesign-210.md` (internal plan) and `docs/self-improving-agent-proposal.md` (design proposal). Neither documents the API surface. The `/self-improve` route was added to `primary-nav-v2.tsx` but isn't represented in the docs tree.

### New routes (16)

| Method | Path | Body / Param | Status |
|---|---|---|---|
| `GET` | `/api/self-improve/health` | — | 200 |
| `GET` | `/api/self-improve/baselines` | `?profile=` query | 200 / 503 |
| `GET` | `/api/self-improve/metrics` | query (range/profile) | 200 / 503 |
| `POST` | `/api/self-improve/metrics` | JSON body | 200 / 400 / 503 |
| `GET` | `/api/self-improve/metrics/latest` | `?profile=` | 200 / 503 |
| `GET` | `/api/self-improve/experiments` | query filter | 200 / 503 |
| `POST` | `/api/self-improve/experiments` | JSON | 201 / 503 |
| `GET` | `/api/self-improve/experiments/$id` | `id` path param | 200 / 404 / 503 |
| `POST` | `/api/self-improve/experiments/$id/approve` | — | 200 / 503 |
| `POST` | `/api/self-improve/experiments/$id/reject` | — | 200 / 503 |
| `POST` | `/api/self-improve/experiments/$id/apply` | — | 200 / 503 |
| `POST` | `/api/self-improve/experiments/$id/verify` | — | 200 / 503 |
| `POST` | `/api/self-improve/experiments/$id/revert` | — | 200 / 503 |
| `GET` | `/api/self-improve/experiments/$id/history` | `id` path param | 200 / 503 |
| `POST` | `/api/self-improve/propose` | `{ profile }` (profile required → 400) | **202** (queued) / **200** (skipped) / 400 / 503 |
| `GET`/`POST` | `/api/self-improve/scenarios` | GET: query; POST: `{ profile, name, input?, checks?, holdout? }` | 200 / 400 / 503 |
| `DELETE` | `/api/self-improve/scenarios/$id` | `id` path param | 200 / 503 |
| `POST` | `/api/self-improve/profiles/$profile/pause` | `profile` path param | 200 / 503 |
| `POST` | `/api/self-improve/profiles/$profile/resume` | `profile` path param | 200 / 503 |

Notable contract nuance in `/propose`: it distinguishes **200 = skipped** (no proposal generated) from **202 = new experiment queued** — mirrors the plugin contract. A docs page must call this out; a client treating both as "201 created" would misbehave.

### Suggested edit

Create a new file `docs/main/self-improve.md` with: (a) feature-gate note (capability flag from `/api/self-improve/health`), (b) the lifecycle (propose → approve/reject → apply → verify → revert) mapped to the 16 routes, (c) the `200 vs 202` distinction on `/propose`, (d) the scenarios + profile pause/resume endpoints. Wire it into `docs/welcome.md`'s feature list and the sidebar nav. This is a net-new page, not a patch.

**Evidence:** `src/routes/api/self-improve/*.ts` (16 non-test handlers); `find docs -iname "*self-improve*"` returns only the plan + proposal files, no feature page.

---

## Gap 3 — `GET /api/session-status` response shape expanded (MEDIUM)

**What shipped:** Per-session cost + token/api detail surfaced in the chat UI (commit `162aa3f4`) and poller consolidation (commit `8f1b671f`, #214). The `/api/session-status` response `payload` object gained six new fields.

**What's documented:** `docs/main/chat/sessions.md` does not document the `/api/session-status` response shape at all (grep for `session-status`, `per-session cost`, `cost ledger` → 0 matches). Any client or integration relying on the documented shape will miss the new fields.

### New fields in the `payload` object (response)

```
cost              (number)   actual_cost_usd ?? estimated_cost_usd ?? 0
estimatedCost     (number)   estimated_cost_usd ?? 0
cacheReadTokens   (number)   cache_read_tokens ?? 0
cacheWriteTokens  (number)   cache_write_tokens ?? 0
reasoningTokens   (number)   reasoning_tokens ?? 0
apiCallCount      (number)   api_call_count ?? 0
```

Pre-existing fields (`status`, `sessionKey`, `sessionLabel`, `model`, `modelProvider`, `inputTokens`, `outputTokens`, `totalTokens`, `source`, `endReason`, `contextPercent`, `maxTokens`, `usedTokens`, `sessions[]`) are unchanged.

The route also gained a 404→graceful-empty behavior: if the gateway returns 404 for the session key, the endpoint returns `{ ok: true, payload: { status: 'idle', sessions: [] } }` (HTTP 200) so clients stop retrying. That contract is also undocumented.

### Suggested edit to `docs/main/chat/sessions.md`

Add a "### Session status endpoint" subsection documenting `GET /api/session-status?sessionKey=...`, the full `payload` schema including the six new fields, and the 404→idle-empty fallback behavior.

**Evidence:** `src/routes/api/session-status.ts:112–153` (new fields), `:158–172` (404 fallback); `git log --since="7 days ago" --oneline -- src/routes/api/session-status.ts` → `162aa3f4`, `8f1b671f`.

---

## Gap 4 — `X-Hermes-Session-Id` request header (LOW–MEDIUM)

**What shipped:** STEP 0 of Track 1 reliability — `POST /api/send-stream` now sends a `X-Hermes-Session-Id` header so the gateway can bind a `/v1/chat/completions` run to a persistent session key. This makes chat persistence portable across browser refreshes and BFF restarts.

**What's documented:** No docs page mentions the header. `grep -rn "X-Hermes-Session-Id\|portable persistence" docs/` → 0 matches. The internal plan (`.omc/plans/hermes-dep-post-messages-endpoint.md`) was touched but it's not user-facing.

### Contract

- Header name: `X-Hermes-Session-Id` (note: `X-Claude-Session-Id` is legacy/deprecated — see `src/server/openai-compat-api.ts:285`).
- Constant: `HERMES_SESSION_ID_HEADER = 'X-Hermes-Session-Id'` in `src/lib/send-stream-session-headers.ts`.
- Sent by: `POST /api/send-stream` (and the OpenAI-compat + Responses API adapters).
- Purpose: binds a streaming run to a Hermes session key so history/state survives BFF restart and tab refresh.

### Suggested edit to `docs/main/chat/sessions.md`

Add a note under the session-persistence / reliability section: "Each `POST /api/send-stream` request carries an `X-Hermes-Session-Id` header that binds the run to a persistent session key. This is what lets the chat recover its place after a BFF restart or tab refresh."

**Evidence:** `src/lib/send-stream-session-headers.ts:2–6`; `src/server/responses-api.ts:115`; `src/server/openai-compat-api.ts:285` (legacy-header note); commit `192abff3`.

---

## What was NOT drifted (checked, clean)

These adjacent surfaces were inspected and found consistent — no action needed:

- **MCP routes** (`/api/mcp/*`) — `docs/diagrams/mcp-server-lifecycle.html` matches the handler verbs; no MCP route changed this week.
- **Workflow routes** (`/api/workflow-*`) — `docs/diagrams/workflow-run-sequence.html` + `workflow-output-flow.html` still match; no workflow route changed this week.
- **Hermes-plugin routes** (`GET /api/hermes-plugin`, `POST /api/hermes-plugin/settings`) — these are new but they back the Settings → Hermes Plugin UI section, which is itself a docs gap tracked separately under the settings/preferences surface (not an API-reference gap per se). The handlers' allowlist/CSRF contract is documented in source JSDoc; a future `docs/settings/preferences.md` update should cover the UI, not the API.
- **Memory routes** (`/api/memory/*`, `/api/knowledge/*`) — `docs/diagrams/memory-tabs-architecture.html` matches; no route changed this week.

---

## Priority recommendation

1. **Gap 2 (Self-Improve) first** — it's a net-new feature page with 16 undocumented routes and a `200/202` contract nuance that will trip integrators. No page exists at all.
2. **Gap 1 (Board Templates)** — 6 routes + 7 types, feature is live, the existing boards.md is the natural home. Quick patch.
3. **Gap 3 (session-status)** — documented response shape is now stale; affects any external consumer of the BFF.
4. **Gap 4 (session-id header)** — small but it's a wire-contract change worth one paragraph.
