# 04-issues.md — Open Issues & Pending Topics

_Generated: 2026-06-13 by kanban worker (t_401d250f)_
_Repo: Interstellar-code/hermes-switchui | Data source: gh issue list + in-repo scan_

---

## Section 1: Open GitHub Issues

**Total: 69 open issues.** The 50 most recent (by creation date) are listed below; the remaining 19 predate the June-01 audit batch (#95–#142) and are not enumerated here.

### P0 — Critical

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 155 | `[api] P0: /api/events SSE endpoint has no authentication check — leaks chat events` | Untouched since filing | 12d (created 2026-06-01, no activity) |

### P1 — Security (backend/frontend)

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 146 | `[backend-sec] P1: /api/media serves arbitrary filesystem paths` | Untouched | 12d |
| 147 | `[backend-sec] P1: dashboard-proxy missing CSRF guard on mutating methods` | Untouched | 12d |
| 149 | `[backend-sec] P1: terminal-stream accepts arbitrary cwd (no permitted-root containment)` | Untouched | 12d |
| 152 | `[frontend-sec] P1: Unsanitized href passthrough in Markdown component (javascript: XSS)` | Untouched | 12d |
| 153 | `[frontend-sec] P1: Mermaid securityLevel:loose + htmlLabels:true (HTML injection)` | Untouched | 12d |
| 158 | `[api] P1: 3 mutating POST handlers missing CSRF guard` | Untouched | 12d |
| 160 | `[api-sec] P1: oauth.poll-token and oauth.device-code — no auth, no rate limit` | Untouched | 12d |

### P1 — Bug/Perf (backend)

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 143 | `[backend] P1: tool-artifacts-store index grows unboundedly — no eviction, no GC` | Untouched | 12d |
| 162 | `[api] P1: workflow-runs engine calls have no error handling — raw 500` | Untouched | 12d |
| 171 | `[backend] P1: resolveKanbanBackend — 'claude' preference branch is dead code` | Untouched | 12d |
| 173 | `[backend] P1: kanban-backend local board — read-modify-write with no file locking` | Untouched | 12d |
| 174 | `[backend] P1: mapBoardStatus writes invalid 'review' status to Kanban DB` | Untouched | 12d |
| 175 | `[backend] P1: plugin-client _get/_send/_delete have no timeout` | Untouched | 12d |
| 176 | `[backend] P1: provider-usage OAuth token refresh has no fetch timeout` | Untouched | 12d |
| 215 | `[backend] P1 perf: /api/history fetches full transcript then slices in memory — no gateway pagination` | Untouched | 2d |

### P1 — Frontend Bug/Perf

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 157 | `[api] P1: POST /api/workflow-runs — missing try/catch around request.json()` | Untouched | 12d |
| 163 | `[frontend] P1: revealTimer setTimeout never cleared on unmount (settings)` | Untouched | 12d |
| 164 | `[frontend] P1: onRehydrateStorage direct state mutation bypasses Zustand subscribers` | Untouched | 12d |
| 166 | `[frontend] P1: saveMissionStoreBeforeUnload never registered — mission restore is dead` | Untouched | 12d |
| 168 | `[frontend] P1: terminal-panel-store persists stale PTY sessionIds across reloads` | Untouched | 12d |
| 169 | `[frontend] P1: task-store persists all mission tasks indefinitely (unbounded localStorage)` | Untouched | 12d |
| 188 | `[enhancement, P1] route web chat through GatewayRunner pipeline for Telegram/Slack parity` | Untouched | 7d |

### P2 — Security

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 150 | `[backend-sec] P2: verifyPassword early-returns on length mismatch (timing leak)` | Untouched | 12d |
| 154 | `[frontend-sec] P2: Regex-only script strip in files HTML preview (bypassable)` | Untouched | 12d |
| 156 | `[api-sec] P2: knowledge/sync repo+branch without path validation` | Untouched | 12d |
| 159 | `[api] P2: POST /api/workflow-runs CSRF check runs before auth check` | Untouched | 12d |
| 161 | `[api-sec] P2: terminal-stream cwd accepted from client without path validation` | Untouched | 12d |

### P2 — Bug/Cleanup (backend)

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 144 | `[backend] P2: touchLocalSession mutates updatedAt in memory — reordering lost on restart` | Untouched | 12d |
| 145 | `[backend] P2: tasks-store writeTaskFile is non-atomic — crash corrupts tasks.json` | Untouched | 12d |
| 148 | `[backend] P2: run-store uses non-atomic writeFile, accumulates run files with no GC` | Untouched | 12d |
| 151 | `[backend] P2: tasks-store CRUD exports are dead code (no callers since Kanban cutover)` | Untouched | 12d |
| 177 | `[backend] P2: kanban-backend openDb caches Database without error recovery` | Untouched | 12d |
| 178 | `[backend] P2: claudeTaskToCard hardcodes acceptanceCriteria=[] and reviewer=null` | Untouched | 12d |
| 179 | `[backend] P2: applyAgentUpdate uses git reset --hard without dirty-tree check` | Untouched | 12d |
| 180 | `[backend] P2: ensurePluginInstalled has no request timeout — /workflows hangs` | Untouched | 12d |
| 181 | `[backend] P2: personas-browser listPersonas throws on duplicate id` | Untouched | 12d |
| 182 | `[backend] P2: chat-event-bus ensureBusStarted is a documented no-op` | Untouched | 12d |

### P2 — Frontend Bug

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 165 | `[frontend] P2: stale closure in AgentViewPanel polling effect` | Untouched | 12d |
| 167 | `[frontend] P2: dispatch mutation onSuccess fires setTimeout with no unmount cleanup` | Untouched | 12d |
| 172 | `[frontend] P2: 8 persist stores missing version+migrate — schema changes corrupt state` | Untouched | 12d |

### Recent Issues (Jun 2–12, post-audit batch)

| # | Title | Status | Staleness |
|---|-------|--------|-----------|
| 183 | `Matrix3D: refactor A2A page to show all executor protocols (codex, agy)` | Untouched | 11d |
| 186 | `Lint debt: ~1822 ESLint errors repo-wide + cyclic import/order rule` | Untouched | 8d |
| 201 | `[bug] Gateway: startClaudeAgent() reports ok:true/\"starting\" without confirming health` | Untouched | 4d |
| 202 | `Matrix3D: push-based activity via WS /api/activity, retire sqlite subprocess poller` | Untouched | 3d |
| 204 | `THREE.Clock deprecated: upgrade @react-three/fiber to fix THREE.Timer warning` | Untouched | 3d |
| 206 | `[/improve] Self-improving agent UI — per-profile health + proposal/approval queue` | Partially addressed (#207–#211 shipped Jun 11) | 3d (issue body may be stale) |
| 208 | `[ux] chat response scrappy when leaving chat session during streaming` | Untouched | 2d |
| 215 | `[backend] P1 perf: /api/history fetches full transcript, no gateway pagination (listed above)` | Untouched | 2d |
| 222 | `[frontend] P2 refactor: split chat god components (chat-screen 3339 lines / 43 effects; message-item 22 props)` | Partially addressed by #223–#225 perf fixes Jun 12 | 2d |
| 227 | `[ux] Hermes Switch UI update blocked — "review required" false positive` | Untouched | 1d |

### Pre-June issues (not individually captured — below gh 50-cap)

19 open issues below #143 exist, oldest at #95 (2026-05-27) — "workflows: wizard Step 1 (Describe) chat is mocked — wire to". Others include #115 (evaluate wterm replacement), #121 (P0 streaming timer leak), #122 (P1 frontend/backend timeout mismatch), #123 (P1 cancel handler no abort). Full enumeration requires a second gh page.

---

## Section 2: Pending In-Repo Topics (TODO/FIXME/HACK/XXX)

### Active source-code markers in src/

| File | Line | Marker | Status | Staleness |
|------|------|--------|--------|-----------|
| `src/server/conductor-store.ts` | 90 | `TODO: token_usage not yet in workflow_runs schema` | Active — field not in schema yet | ~17d (file last touched 2026-05-27) |
| `src/hooks/use-model-suggestions.ts` | 168 | `TODO: fix the dependency array / memoization and re-enable` | Active — commented-out logic | ~2mo (file last touched 2026-04-10) |
| `src/screens/gateway/components/approvals-panel.tsx` | 1 | `TODO(orphan): ApprovalsPanel is built but not imported or rendered anywhere` | Dead code — orphan component | ~2mo (2026-04-19) |
| `src/screens/gateway/components/hub-utils.tsx` | 1 | `TODO(orphan): hub-utils.tsx exports many helpers extracted from` | Dead code — orphan module | ~2mo (2026-04-19) |
| `src/screens/chat/components/sidebar/v2/sidebar-card-v2.tsx` | 108 | `TODO: wire \`tool\` when a tool-run detail route is added` | Active — lazy feature gap | Undated (within last 14d per changelog) |
| `src/screens/mcp/mcp-screen.tsx` | 223 | `TODO: wire to API mutation` | Active — UI exists, mutation not hooked | ~3wk (file last touched 2026-05-23) |
| `src/features/retro-office/RetroOffice3D.tsx` | 2344 | `"There is no spoon. Only TODOs."` | Easter egg quote — NOT a pending task | N/A |

### Commit-body follow-up / parked signals (last 14d)

| Commit | Date | Signal | Meaning |
|--------|------|--------|---------|
| `b5d6f4da` | Jun 12 | `#231 follow-up` | Template wizard — follow-up already shipped |
| Various | Jun 2-10 | `deferred` | `@types/node 25`, `@tanstack/eslint-config 0.4` — majors deferred; slash commands (`/background /approve /deny /voice /sethome /reload-mcp /update`) deferred for a follow-up; `stubbed gracefully and flagged as TODO(parity)` — matrix-coder parity stubs |
| — | Jun 10 | `explicit follow-up issue recommended` | `shadcn/base-ui migration` deliberately not an issue yet — "track as narrow follow-up" |
| — | Jun 12 | `Docker follow-up: .dockerignore excludes website/` | /website not served inside Docker — noted, no issue created |

### Source of truth

- GitHub issues: `gh issue list --repo Interstellar-code/hermes-switchui --state open --limit 50` (69 total, 19 below cap)
- Source markers: `grep -rnE 'TODO|FIXME|HACK|XXX' src/` (reduced to 6 real markers after filtering vendored `electron/server-bundle.cjs`, syntax-highlighter codelib in lockfiles, and jokes)
- Commit bodies: `git log --since="14 days ago"` scanning for "follow-up", "later", "pending", "parked", "deferred", "TODO", "stub"
