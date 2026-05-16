# Spec: A.1-b — Schemas, Validation, Discovery Cluster

> **Workstream:** A (Archon engine port)
> **Owner:** Executor subagent (Sonnet 4.6)
> **Cluster:** Zod schemas + validators + filesystem discovery + YAML loader
> **Depends on:** A.0 (stubs). Runs in parallel with A.1-a and A.1-c.
> **Archon source pin:** `78d32cfb751f1da433d1a81b89a9747f7d0167f8` at `/Volumes/Ext-nvme/Development/archon/packages/workflows/src/`

## Goal

Port the schema definitions, runtime validators, and filesystem discovery (workflows, scripts, commands) from Archon into Switch UI. These define what a valid YAML workflow looks like and how the engine finds it on disk.

This cluster does NOT touch the executor (A.1-a) or wiring/deps (A.1-c). Each file is a near-verbatim port with the import-path rewrites and one Bun replacement listed below.

## Files to port (~13 files, ~2700 LOC)

### Schemas → `src/server/workflow-engine/schemas/`

| Source | Dest | LOC |
|---|---|---:|
| `schemas/index.ts` | `schemas/index.ts` | 121 |
| `schemas/workflow.ts` | `schemas/workflow.ts` | 162 |
| `schemas/workflow-run.ts` | `schemas/workflow-run.ts` | 169 |
| `schemas/dag-node.ts` | `schemas/dag-node.ts` | 638 |
| `schemas/hooks.ts` | `schemas/hooks.ts` | 88 |
| `schemas/loop.ts` | `schemas/loop.ts` | 33 |
| `schemas/retry.ts` | `schemas/retry.ts` | 23 |

### Validation → `src/server/workflow-engine/validation/`

| Source | Dest | LOC |
|---|---|---:|
| `validator.ts` | `validation/validator.ts` | 680 |
| `validation-parser.ts` | `validation/validation-parser.ts` | 64 |
| `command-validation.ts` | `validation/command-validation.ts` | 15 |

### Discovery → `src/server/workflow-engine/discovery/`

| Source | Dest | LOC |
|---|---|---:|
| `loader.ts` | `discovery/loader.ts` | 504 |
| `workflow-discovery.ts` | `discovery/workflow-discovery.ts` | 372 |
| `script-discovery.ts` | `discovery/script-discovery.ts` | 170 |

## Adaptations per file

### Schemas (all 7 files)
- Zod imports unchanged (Zod is in `package.json` already).
- Cross-schema imports stay as `from "./workflow"` etc. (siblings).
- The barrel (`index.ts`) re-exports — keep as-is.
- Status enum in `workflow-run.ts` MUST contain `'completed'` (NOT `'done'`). Verify upstream uses `'completed'` (`archon/packages/workflows/src/schemas/workflow-run.ts:10`).

### Validation

- `validator.ts` imports `@archon/paths` star — already covered by A.0.
- `validator.ts` imports `@archon/git`'s `execFileAsync` — already aliased.
- `validation-parser.ts` is a small helper; just rewrite paths.
- `command-validation.ts` is tiny; verify and move.

### Discovery

- `loader.ts:29` uses `Bun.YAML.parse(content)`. **REPLACE** with the `yaml` npm package:
  ```ts
  import { parse as parseYaml } from "yaml";
  // ...
  const parsed = parseYaml(content);
  ```
  If `yaml` is not in `package.json`, add it as a dependency. List the install in your report.
- `workflow-discovery.ts` uses `@archon/paths` star import — already aliased. Filesystem behavior is fine on Node.js.
- `script-discovery.ts` uses `getHomeScriptsPath` from `@archon/paths` (now returns `~/.hermes/switchui/scripts/`). Behavior change is intentional — flag in report.

## Import-path rewrite map (canonical for this cluster)

Apply across all 13 files. Use sed/awk + verify with grep.

```
./schemas          → ../schemas               (sibling-in-this-cluster, but keep "./schemas" if in validator or discovery? NO — they're in different subdirs now, must be "../schemas")
./schemas/...      → ../schemas/...
./validator        → ../validation/validator  (only relevant for cross-cluster — within validation/, keep "./validator")
./loader           → ../discovery/loader
./workflow-discovery → ../discovery/workflow-discovery
./script-discovery → ../discovery/script-discovery
./command-validation → ./command-validation (within validation/, sibling) OR ../validation/command-validation (from elsewhere)
./validation-parser → ./validation-parser (within validation/)
./event-emitter    → ../emitter/event-emitter
./router           → ../routing/router
./deps             → ../wiring/deps
./store            → ../store
./utils/<x>        → ../utils/<x>
./defaults/<x>     → ../defaults/<x>
```

**Rule:** sibling files within the same cluster subdir use `./`. Cross-subdir uses `../<other-dir>/`.

**No edits to `@archon/paths`, `@archon/git`, `@archon/providers/types`** — keep package names; aliases handle them.

## Co-port: tests

Port matching `.test.ts` files for the cluster:
- `validator.test.ts`, `validation-parser.test.ts`, `command-validation.test.ts`
- `loader.test.ts`, `script-discovery.test.ts`, `script-node-deps.test.ts`
- `schemas.test.ts` (lives at workflows/src/schemas.test.ts upstream)

Tests that pull in cross-cluster fixtures (e.g., need `event-emitter`) → park with `.skip.test.ts` and flag.

`test-utils.ts` lives in A.1-c — if needed, import via `../test-utils.js` (A.1-c will place it at `src/server/workflow-engine/test-utils.ts`).

## Verification gates

1. `pnpm tsc --noEmit 2>&1 | grep -E "src/server/workflow-engine/(schemas|validation|discovery)/"` — empty (no errors **in this cluster**; cross-cluster errors expected until A.1-a + A.1-c land).
2. `rg "Bun\\." src/server/workflow-engine/{schemas,validation,discovery}/` — empty. Verify `loader.ts` Bun replacement.
3. `rg "@archon/" src/server/workflow-engine/{schemas,validation,discovery}/` — only `@archon/paths`, `@archon/git`, `@archon/providers/types` (zero of the last is likely — schemas/validation don't import provider types).
4. `rg "from \"yaml\"" src/server/workflow-engine/discovery/loader.ts` — must match (Bun replacement landed).
5. Status enum: `rg "'completed'" src/server/workflow-engine/schemas/workflow-run.ts` matches; `rg "'done'" src/server/workflow-engine/schemas/` empty.
6. Line counts within ±2% of upstream per file. Report deltas.

## Deliverables checklist

- [ ] 7 schema files at `src/server/workflow-engine/schemas/`
- [ ] 3 validation files at `src/server/workflow-engine/validation/`
- [ ] 3 discovery files at `src/server/workflow-engine/discovery/`
- [ ] `yaml` dep added (or confirmed present) — list in report
- [ ] Bun replacement in `loader.ts` verified
- [ ] Co-ported tests (or `.skip.test.ts` park) listed in report
- [ ] No `Bun.*` calls
- [ ] `tsc --noEmit` clean for cluster (cross-cluster errors OK)
- [ ] Report: line-count delta per file, import rewrites applied, any TODOs

## Non-goals

- No executor / DAG executor (A.1-a).
- No emitter, router, deps, utils, defaults (A.1-c).
- No SQLite changes (A.1.1).
- No new schema fields. The `hermes_task:` / `x-hermes:` extension fields land in A.9, not here.
