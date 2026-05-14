# Spec: A.1-a — Engine Executor Cluster

> **Workstream:** A (Archon engine port)
> **Owner:** Executor subagent (Sonnet 4.6)
> **Cluster:** Executor + DAG executor + condition + helpers
> **Depends on:** A.0 (stubs), A.1.1 (store), runs in parallel with A.1-b, A.1-c
> **Archon source pin:** `78d32cfb751f1da433d1a81b89a9747f7d0167f8` at `/Volumes/Ext-nvme/Development/archon/packages/workflows/src/`

## Goal

Port the runtime execution core of the Archon workflow engine into Switch UI. These files run the DAG, evaluate node conditions, manage executor state, and route node execution through the dependency-injected provider (in our case, the kanban-dispatcher from A.3).

This cluster does NOT touch schemas (A.1-b) or wiring/deps (A.1-c). Each file is a near-verbatim port with the adaptations listed below.

## Files to port (5 files, ~4980 LOC)

Source → destination (all under `src/server/workflow-engine/core/`):

| Source (in `archon/packages/workflows/src/`) | Dest | LOC | Notes |
|---|---|---:|---|
| `dag-executor.ts` | `core/dag-executor.ts` | 3184 | Main DAG state machine. Bulk of port. |
| `executor.ts` | `core/executor.ts` | 850 | Workflow-level executor entry point. |
| `executor-shared.ts` | `core/executor-shared.ts` | 534 | Helpers: `classifyError`, `loadCommandPrompt`, `substituteWorkflowVariables`, `detectCompletionSignal`, `stripCompletionTags`, `isInlineScript`, `formatSubprocessFailure`, `buildPromptWithContext`. |
| `condition-evaluator.ts` | `core/condition-evaluator.ts` | 174 | `evaluateWhenCondition` for skip logic. |
| `logger.ts` | `core/logger.ts` | 237 | Engine-internal logger (separate from `@archon/paths`'s `createLogger` which lives in stubs). |

## Adaptations per file

### `dag-executor.ts`
- Imports stay as-is. The Bun-specific call (`Bun.YAML.parse`) is in `loader.ts` (A.1-b), not here.
- `@archon/paths` imports already aliased to `stubs/paths.ts` (A.0). Do not edit them.
- `@archon/providers/types` imports already aliased to `stubs/providers-types.ts` (A.0).
- `@archon/git` imports already aliased to `stubs/git.ts` (A.0).
- IWorkflowStore comes from a relative import — replace `from "./store"` with `from "../store"` (the new path is `src/server/workflow-engine/store/`).
- `WorkflowEventEmitter` import path: `from "./event-emitter"` becomes `from "./event-emitter"` (sibling file in `core/`) — **but** the emitter is in A.1-c. Use `from "../emitter/event-emitter"` (A.1-c will place it under `src/server/workflow-engine/emitter/`).
- `router` import: `from "./router"` → `from "../routing/router"` (A.1-c).
- `deps` import: `from "./deps"` → `from "../wiring/deps"` (A.1-c).
- Schema imports `from "./schemas"` → `from "../schemas"` (A.1-b).
- Util imports `from "./utils/..."` → `from "../utils/..."` (A.1-c).
- Any `Bun.*` calls — flag in report, do not silently rewrite.

### `executor.ts`
- Same import-path rewrites as `dag-executor.ts`.
- `defaults/bundled-defaults` import → `../defaults/bundled-defaults` (A.1-c).
- `workflow-discovery` import → `../discovery/workflow-discovery` (A.1-b).

### `executor-shared.ts`
- Same import-path rewrites.
- Star import from `@archon/paths` already covered by A.0 stub exports — leave the import as-is.
- The `loadCommandPrompt` helper reads from filesystem; no changes needed.
- `substituteWorkflowVariables` is the DAG-aware substitution. The simpler util in `utils/variable-substitution.ts` (A.1-c) is a different function. Do NOT consolidate.

### `condition-evaluator.ts`
- Standalone; minimal cross-file imports. Just rewrite any `./` to `../schemas` etc. as needed.

### `logger.ts`
- Engine-internal logger. Pure module. Likely no path rewrites needed; verify imports.

## NOT in scope

- `Bun.YAML.parse` replacement (A.1-b handles it in `loader.ts`).
- The provider registry shim (`isRegisteredProvider`, etc.) — A.3 wires the kanban-dispatcher as the sole registered provider.
- The SSE bridge — A.1.2.
- Any new logic. This is a port, not a rewrite.

## Import-path rewrite map (canonical)

Apply consistently across all 5 files. Use sed/awk or hand edits — but verify with grep after.

```
./store              → ../store                   (A.1.1)
./schemas            → ../schemas                 (A.1-b)
./schemas/...        → ../schemas/...             (A.1-b)
./validator          → ../validation/validator    (A.1-b)
./validation-parser  → ../validation/validation-parser  (A.1-b)
./command-validation → ../validation/command-validation (A.1-b)
./loader             → ../discovery/loader        (A.1-b)
./workflow-discovery → ../discovery/workflow-discovery  (A.1-b)
./script-discovery   → ../discovery/script-discovery    (A.1-b)
./event-emitter      → ../emitter/event-emitter   (A.1-c)
./router             → ../routing/router          (A.1-c)
./deps               → ../wiring/deps             (A.1-c)
./utils/<x>          → ../utils/<x>               (A.1-c)
./defaults/<x>       → ../defaults/<x>            (A.1-c)
```

**No edits to `@archon/paths`, `@archon/git`, `@archon/providers/types`** — keep package names; aliases handle them.

## Co-port: tests

Port the matching `.test.ts` files for these 5 modules **only if** they don't pull in fixtures or test utilities from outside the cluster. List each test file's status in your report:
- `dag-executor.test.ts`, `executor.test.ts`, `executor-shared.test.ts`, `executor-preamble.test.ts`, `condition-evaluator.test.ts`, `logger.test.ts`.

If a test imports cross-cluster (e.g., from `./loader` which is A.1-b), park it with `.skip.test.ts` extension and flag in report — A.1-b's verifier re-enables after wiring lands.

`test-utils.ts` (shared fixture helper) is technically cluster-c (A.1-c). If A.1-a tests need it, import via `../test-utils.js` after A.1-c places it under `src/server/workflow-engine/test-utils.ts`.

## Verification gates

1. `pnpm tsc --noEmit 2>&1 | grep src/server/workflow-engine/core/` — empty (no errors **in this cluster**; cross-cluster errors expected until A.1-b + A.1-c land).
2. `rg "from \"\\./" src/server/workflow-engine/core/` — no leftover `./` imports referencing modules outside `core/`. (Sibling-only imports OK within `core/`.)
3. `rg "Bun\\." src/server/workflow-engine/core/` — empty. Any Bun call must be replaced or flagged. Spec assumes there are none in these 5 files; if there are, flag and stop.
4. `rg "@archon/" src/server/workflow-engine/core/` — only the three aliased packages (`@archon/paths`, `@archon/git`, `@archon/providers/types`). No `@archon/providers` (registry — A.3 owns that), no `@archon/isolation` (engine doesn't use it).
5. Behavioral: line counts within ±2% of upstream (no accidental file truncation). Report deltas.

## Deliverables checklist

- [ ] 5 source files at `src/server/workflow-engine/core/`
- [ ] Co-ported tests (or `.skip.test.ts` flagged park) listed in report
- [ ] No `./` imports to non-sibling modules
- [ ] No `Bun.*` calls (flag if found)
- [ ] `tsc --noEmit` clean for files **in this cluster** (cross-cluster errors expected)
- [ ] Report: line-count delta per file vs upstream, list of import rewrites applied, any TODOs or surprises

## Non-goals

- No emitter, router, deps, schemas, validator, loader, discovery — those are A.1-b / A.1-c.
- No provider port (A.3).
- No SQLite changes (A.1.1 owns the DB layer; this cluster just uses `IWorkflowStore`).
