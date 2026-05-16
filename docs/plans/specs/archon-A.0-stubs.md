# Spec: A.0 — Dependency Stub Module

> **Workstream:** A (Archon engine port)
> **Owner:** Executor subagent (Sonnet 4.6)
> **Status:** Ready for implementation
> **Depends on:** nothing (P0 leaf)
> **Blocks:** A.1, A.1.1, A.2, A.3
> **Archon source pin:** `78d32cfb751f1da433d1a81b89a9747f7d0167f8` at `/Volumes/Ext-nvme/Development/archon`

## Goal

Provide a thin Switch-UI-local replacement for the Archon-internal packages that the workflow engine imports (`@archon/paths`, `@archon/git`). The engine source under port (A.1) imports from these by package name; rather than re-publishing Archon's packages, we ship local modules that the engine compiles against. No `@archon/*` runtime dependency.

This module is **types + no-op-or-thin-impl**. It is NOT a port of provider code (that is A.3) and NOT a port of isolation helpers (engine doesn't import them — confirmed in `archon-engine-research.md:248`).

## Scope

### Files to create

```
src/server/workflow-engine/stubs/
├── paths.ts        # @archon/paths replacement
├── git.ts          # @archon/git replacement
├── providers-types.ts  # @archon/providers/types — type-only shim (consumed by deps.ts)
└── index.ts        # barrel
```

### Path-mapping for the engine port

`tsconfig.json` already supports path aliases. Add (under `compilerOptions.paths`):

```jsonc
{
  "@archon/paths": ["./src/server/workflow-engine/stubs/paths.ts"],
  "@archon/git":   ["./src/server/workflow-engine/stubs/git.ts"],
  "@archon/providers/types": ["./src/server/workflow-engine/stubs/providers-types.ts"]
}
```

This lets the A.1 ported engine source keep its original `import { ... } from "@archon/paths"` lines unchanged — easier upstream cherry-picks later.

## `paths.ts` — required exports

Verified against Archon source by grepping `import * from "@archon/paths"` across `packages/workflows/src/`. Star-imports require enumerating every accessed property.

```ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HERMES_HOME = join(homedir(), ".hermes");
const SWITCHUI_HOME = join(HERMES_HOME, "switchui");

export function createLogger(ns: string): Logger {
  // Minimal pino-style facade. Implementation may use console.* in v1.
  return {
    info: (...args: unknown[]) => console.log(`[${ns}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${ns}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${ns}]`, ...args),
    debug: (...args: unknown[]) => { if (process.env.DEBUG_WORKFLOW) console.debug(`[${ns}]`, ...args); },
  };
}

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

// Build-time constants
export const BUNDLED_IS_BINARY: boolean = false;            // dev mode; build can flip via define
export const BUNDLED_VERSION: string = "0.0.0-switchui";    // overridden at build by Vite define

// Filesystem helpers
export function getArchonHome(): string {
  mkdirSync(SWITCHUI_HOME, { recursive: true });
  return SWITCHUI_HOME;
}

export function getHomeScriptsPath(): string {
  const p = join(SWITCHUI_HOME, "scripts");
  mkdirSync(p, { recursive: true });
  return p;
}

// Analytics — no-op
export function captureWorkflowInvoked(_event: unknown): void {
  /* no-op in Switch UI */
}
```

### Verification step before locking

Before merging A.0, executor must `rg "from \"@archon/paths\"" /Volumes/Ext-nvme/Development/archon/packages/workflows/src/` and confirm every imported symbol is exported above. Any missing symbol → add stub + flag in PR description.

Specifically inspect the three star-import sites — `executor-shared.ts:11`, `executor.ts:8`, `workflow-discovery.ts:27` — for every `archonPaths.<symbol>` access.

## `git.ts` — required exports

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export async function getDefaultBranch(_cwd: string): Promise<string> {
  return "main";  // Switch UI doesn't manage worktrees; safe default.
}

export function toRepoPath(p: string): string {
  return p;  // identity — no worktree translation in Switch UI.
}
```

## `providers-types.ts` — type-only shim

Copy verbatim from `/Volumes/Ext-nvme/Development/archon/packages/providers/src/types.ts` (~328 LOC). **Type-only** — no runtime symbols. The `IAgentProvider` implementation comes from A.3 (`kanban-dispatcher.ts`).

Exports required by engine:
- `IAgentProvider`, `MessageChunk`, `TokenUsage`, `SendQueryOptions`, `NodeConfig`
- `ProviderDefaultsMap`, `ProviderCapabilities`, `ProviderRegistration`, `ProviderInfo`
- `AgentRequestOptions`

Verification: `rg "from \"@archon/providers/types\"" /Volumes/Ext-nvme/Development/archon/packages/workflows/src/` — every imported symbol must be present.

## `index.ts` — barrel

```ts
export * from "./paths";
export * from "./git";
export type * from "./providers-types";
```

## NOT in scope for A.0

- `@archon/providers` registry symbols (`isRegisteredProvider`, `getRegisteredProviders`, `getProviderCapabilities`) — these are runtime, provided by **A.3** (`kanban-dispatcher.ts` registers itself as the single provider, and the registry shim returns `[kanban]`).
- `@archon/isolation` — engine has zero imports from this package (`archon-engine-research.md:248`); skip stubbing.
- Bun YAML — handled in A.1 by swapping `loader.ts:29` to `yaml` npm package.

## Test gates

A.0 has no runtime behavior worth unit-testing beyond:

1. `pnpm tsc --noEmit` passes after path aliases are added (proves the shape is at least typechecked).
2. `getArchonHome()` and `getHomeScriptsPath()` create their directories without throwing on fresh install.
3. `execFileAsync("git", ["--version"])` returns a non-empty stdout (smoke test that the promisified wrapper works).

Vitest file: `src/server/workflow-engine/stubs/paths.test.ts` + `git.test.ts`.

## Deliverables checklist

- [ ] `src/server/workflow-engine/stubs/paths.ts` with all symbols above
- [ ] `src/server/workflow-engine/stubs/git.ts`
- [ ] `src/server/workflow-engine/stubs/providers-types.ts` (verbatim copy of Archon `types.ts`)
- [ ] `src/server/workflow-engine/stubs/index.ts`
- [ ] `tsconfig.json` path aliases added
- [ ] Star-import verification recorded in PR description (list every accessed `archonPaths.*` symbol from the three star sites)
- [ ] Two smoke-test vitest files passing
- [ ] `pnpm tsc --noEmit` clean
- [ ] No `@archon/*` entries added to `package.json`

## Non-goals

- No business logic, no engine ports, no DB code (A.1.1's job).
- No replacement of `Bun.YAML.parse` (that's an A.1 concern when `loader.ts` is ported).
- No analytics integration — `captureWorkflowInvoked` stays a no-op for v1.

## Acceptance criteria

Verifier subagent confirms:
1. All required symbols exported (cross-checked against archon source grep results).
2. Path aliases resolve when `tsc --noEmit` runs.
3. Smoke tests green.
4. No `@archon/*` runtime imports remain anywhere in `src/`.
