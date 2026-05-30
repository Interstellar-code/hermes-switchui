# Workflow "DB as Single Source of Truth" — hermes-switchui plan

Status: 2026-05-30. Homework done. Building **buildable-now slice**; save/reset/import **blocked** on hermes-agent Phase 3 deploy.

## Background

Workflow definitions drifted across two axes:
1. **Files vs DB** — `plugins/workflow-engine/defaults/*.yaml` are git-seeds; engine executes from SQLite `workflow_definitions`. Fixed hermes-agent side (Phases 1–3) via `user_modified` flag.
2. **Native DB vs plugin DB** — Switch UI's own TS engine + `switchui-workflows.db` vs the hermes-agent plugin API + its DB. Goal: consolidate onto **plugin**. DB authoritative at runtime; files = factory seed only.

## Plugin API contract (post Phase 3)

Base path: `/api/plugins/workflow-engine` (NOT `/api/workflows`).

- `GET /definitions[/{id}]` → adds **`user_modified`** (0|1), **`bundled_checksum`** (sha256 factory yaml, null for user rows). Existing: `id,name,description,source(bundled|user|project),yaml,checksum`.
- `POST /definitions {id, yaml, expected_checksum}` — editing **bundled now allowed** (was 403); row stays `source=bundled`, server sets `user_modified=1`. `409` if `expected_checksum` stale, `422` on YAML validation fail. Unknown id → user/project row. Explicit create `source=bundled` still 403.
- `POST /definitions/{id}/reset-factory` — restores on-disk factory YAML, clears `user_modified→0`. 404 if not factory id, 403 if not bundled.
- DELETE bundled still 403. Reset-to-factory is the revert.

## Current state (key discovery)

- **Native TS engine already deleted** (commit `9e27db87`); `src/server/workflow-engine/factory.ts` returns `PluginClient` unconditionally. Phase 4's hard part already done.
- All routes proxy to plugin; 5× "Phase 2: always plugin" comments.
- `SourceBadge` exists (bundled/user/project); Save/Revert buttons **stubbed/disabled**; `isEditable = source !== 'bundled'`.
- Types missing `user_modified` / `bundled_checksum`; upsert sends no `expected_checksum`.
- Settings → Workflows backend toggle component was **deleted**.

## Phase 5 — provenance + bundled edit/reset UI (MEDIUM)

Badge map: `bundled&modified=0→Factory`, `bundled&modified=1→Modified factory`, `user/project→User`.

## Phase 4 — consolidation (HIGH; native engine already gone)

Remaining: default toggle (recreate as read-only status), one-time import of native-only user workflows, retire `switchui-workflows.db`.

## Buildable-now vs blocked

| Item | Status |
|---|---|
| Type fields (`user_modified`, `bundled_checksum`, `expected_checksum`) | **Buildable now** (optional/additive) |
| `provenanceOf` helper + badge markup/CSS | **Buildable now** (behind `WORKFLOW_PROVENANCE_V3` flag) |
| Settings → Workflows read-only status section | **Buildable now** |
| Route hardening + stale `localStorage['workflowBackend']` cleanup | **Buildable now** |
| Save w/ `expected_checksum`, drop bundled-403, 409/422 | **Blocked** on Phase 3 deploy |
| Reset-to-factory client + route + button | **Blocked** on Phase 3 deploy |
| Native→plugin import script | **Blocked** (needs plugin dedupe semantics) |
| Update-available pip | **Blocked** (needs `bundled_checksum`) |

## Open question — RESOLVED recommendation

Code already hard-cut (native engine gone). Only data-file decision remains: migrate native
`~/.hermes/switchui/workflow-engine.db` by **rename** to `.migrated-<ts>`, delete in the *following*
release after zero-loss confirmed. Soft (one-release) data window, hard code cutover.

## Files

- `src/server/workflow-engine/interface.ts` — `WorkflowDefinitionRow` fields
- `src/server/workflow-engine/clients/plugin-client.ts` — upsert + reset-factory (blocked parts)
- `src/server/workflow-engine/factory.ts` — already plugin-only
- `src/server/workflow-engine/migrate-native-db.ts` (new, blocked)
- `src/routes/api/workflow-definitions.ts` — drop bundled-403, pass `expected_checksum` (blocked)
- `src/routes/api/workflow-definitions.$id.ts`
- `src/routes/api/workflow-definitions.$id.reset-factory.ts` (new, blocked)
- `src/screens/workflows/api-client.ts` — types + upsert/reset client
- `src/screens/workflows/use-workflows.ts` — mutations + invalidation
- `src/screens/workflows/types.ts` — `WorkflowSummary` fields
- `src/screens/workflows/provenance.ts` (new)
- `src/screens/workflows/workflow-grid.tsx`, `workflow-editor.tsx`
- `src/screens/settings/sections/section-workflows.tsx` (new), `settings-screen.tsx`
- `docs/settings/workflows-backend-toggle.md` — rewrite as plugin-only + migration guide
