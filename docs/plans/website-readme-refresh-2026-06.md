# Website + README + Docs Refresh — 2026-06-15

Goal: bring the repo home page (README), the website (landing + docs), and the
plugin documentation up to the **real** state of Switch UI v2.3.48 and the
Interstellar Hermes Agent fork. Real, verified content only — no assumptions.
Screenshots are captured by the maintainer; content leaves explicit placeholders.

## Canonical plugin one-liners (single source of truth — all writers use these)

The 8 custom plugins that extend the Interstellar Hermes Agent core:

1. **matrix_coder** (0.6.1) — Specialist-coder layer. A `pre_llm_call` hook composes
   a developer-tier persona; a deterministic IntentGate routes implicit requests to
   one of 8 roles (explore/plan/executor/review/debug/test/verify/simplify).
2. **workflow-engine** (0.1.0) — YAML DAG workflow engine (branching, parallel, bash
   nodes, approval gates, cron, kanban dispatch). Powers the `/workflows` page. 5 tools, 19 REST routes.
3. **a2a_fleet** (0.8.14) — Agent-to-Agent fleet over JSON-RPC. Embedded A2A server +
   `fleet_send` tool + managed repo-scoped executors (Claude Code, OpenCode, Codex CLI, Antigravity).
4. **mcp_lazy** (0.2.0) — Lazy MCP schema loading. Stubs MCP tool schemas per turn,
   promotes on demand via `load_mcp_tools`; per-session pool. ~80% MCP token cut.
5. **kanban** (1.0.0) — Multi-agent collaboration boards. Tasks, comments, attachments,
   dispatch to profiles, decompose/specify, board templates. 35+ REST routes + WS events. Powers `/tasks`, `/boards`, `/board-templates`.
6. **karpathy-self-improve** (0.1.0) — Self-improvement engine: collect metrics → propose
   SOUL.md/config diffs → evaluate vs scenarios → apply/verify/revert via git ratchet. Powers `/self-improve`. 20 REST routes.
7. **personas** (0.1.0) — Canonical store of 20 persona templates + runtime tools
   (persona_list/get/apply) + persona_ref binding hook. Backs the profile wizard persona step.
8. **hermes-switch-ui** (0.1.0) — Backend awareness + bidirectional config sync for the
   Switch UI frontend. Per-turn nudge, switchui_info/status tools, register/heartbeat API.

## Workstreams

### WS1 — Plugin docs (docs/plugins/)
- NEW: `kanban.md`, `self-improve.md` (karpathy), `personas.md`, `hermes-switch-ui.md`.
- REFRESH stale: `matrix-coder.md` (v0.6.1 IntentGate + #140 injection hardening),
  `a2a-fleet.md` (4 executor modes, security fixes).
- `overview.md`: "four custom plugins" → "eight"; fill `[SCREENSHOT: ...]` placeholder.
- `docs-manifest.yaml`: add the 4 new plugin slugs to the Plugins group.

### WS2 — README.md
- FIX L13: `NousResearch/hermes-agent` → `Interstellar-code/hermes-agent`.
- Tagline (L7): broaden beyond "Matrix-aesthetic interface" to agent control plane
  (kanban, workflows, profiles, self-improve, plugin suite).
- Sub-tagline (L13): drop "in lockstep with upstream" — own fork now maintained.
- Screenshots (L15, L46–51): swap stale `splash.png`; remove the aged apology block.
- "What's different from upstream" table (L32–42): add rows — profile wizard, clarify
  tool, board templates, self-improve, plugin section, A2A fleet, workflows.
- NEW section after L476: "Powered by the Hermes Agent plugin suite" — the 8 plugins.

### WS3 — Website landing (website/src/pages/index.astro)
- Architecture prose: "two processes" → 4-layer (Interface → Gateway → Agent → Tools/Plugins),
  matching the already-updated ArchDiagram. Add the plugin layer to copy.
- coreFeatures: keep 5; consider clarify mention.
- extendedFeatures: add Board Templates + Self-Improve cards; fix blank Agora desc;
  rewrite Profiles desc (9-step wizard, persona prefill, C-suite, toolsets).

### WS4 — Core docs staleness + new pages (docs/)
- REFRESH: `main/chat/slash-commands.md` (+/reset /stop /title /reasoning),
  `settings/profiles.md` (9-step wizard), `main/chat/composer.md` (clarify card).
- NEW: `main/board-templates.md`, `main/self-improve.md`, `main/agora.md`, `main/chat/commands.md`.
- `docs-manifest.yaml`: register new pages + the orphaned existing pages
  (knowledge/memory, settings/preferences, settings/sidebar, settings/themes, troubleshooting/*).

## Screenshot shot-list (maintainer captures → drop in website/public/docs-assets/screenshots/)
New features with NO current screenshot:
- `self-improve.png` — scorecard + hero diff + stepper + scenario checklist
- `profile-wizard.png` — the 9-step agent wizard (persona step ideal)
- `clarify-card.png` — inline clarify card mid-chat
- `board-templates.png` — templates grid + 5-step wizard
- `boards.png` — boards page (only tasks.png exists today)
- `workflows.png`, `operations.png`, `matrix3d.png`, `agora.png`
- `plugins-collage.png` — for plugins/overview placeholder
- `splash-matrix.png` — real Matrix UI hero shot to replace upstream splash.png in README
