# Archon Engine Research — Workstream A Prep

> **Source repo:** `/Volumes/Ext-nvme/Development/archon` (resolved via direct path probe; no GitHub search needed).
> **Scope:** Engine-only research to support Workstream A.0–A.4 of `docs/plans/archon-hermes-integration.md`.
> **Method:** Read-only inspection of `packages/workflows/src/` and `packages/providers/src/`. No code modified.

---

## 1. File Inventory — `packages/workflows/src/`

Total non-test TS files: **30** (matches plan A.1 count, but contents differ — see "Discrepancies").

### Engine core

| Path | LOC | Purpose |
|---|---:|---|
| `dag-executor.ts` | 3184 | DAG executor. Builds topological layers (Kahn's algorithm), runs each layer's nodes concurrently via `Promise.allSettled`, owns all emitter `emit()` sites for node/loop/tool/workflow events, handles pause/cancel/approval transitions. Entry point: `executeDagWorkflow()` at L2486. |
| `executor.ts` | 850 | Per-node provider dispatch wrapper (orchestrator path). Invoked by dag-executor; resolves provider via registry, applies node config, streams MessageChunks. |
| `executor-shared.ts` | 534 | Pure helpers shared between executor + dag-executor: `classifyError`, `loadCommandPrompt`, `substituteWorkflowVariables` (the DAG-aware substitution — NOT `utils/variable-substitution.ts`), `detectCompletionSignal`, `stripCompletionTags`, `isInlineScript`, `formatSubprocessFailure`, `buildPromptWithContext`. |
| `loader.ts` | 504 | YAML → typed `WorkflowDefinition`. Uses `Bun.YAML.parse` (only Bun call in the engine). Calls `dagNodeSchema.safeParse` per node, emits warnings for AI-only fields on bash/script/loop/approval/cancel. |
| `router.ts` | 266 | Natural-language → workflow selection via LLM (not a per-node router; this picks which workflow to run for a given mission). |
| `event-emitter.ts` | 261 | Singleton `WorkflowEventEmitter` over `events.EventEmitter`. Holds `runId → conversationId` map. Subscribers (Web/SSE adapter) attach here. |
| `store.ts` | 113 | `IWorkflowStore` interface + `WORKFLOW_EVENT_TYPES` constant. Definitions only — no implementation. |
| `deps.ts` | 115 | `WorkflowDeps`, `IWorkflowPlatform`, `WorkflowConfig`, `AgentProviderFactory` — the DI contract. |

### Schemas (`schemas/`)

| Path | LOC | Purpose |
|---|---:|---|
| `schemas/dag-node.ts` | 638 | Per-node Zod schema. Flat schema + `superRefine` enforces mutual exclusivity of `command/prompt/bash/loop/approval/cancel/script`. Exports `dagNodeBaseSchema`, per-variant schemas, `dagNodeSchema` (validator), AI-field warning lists. |
| `schemas/workflow.ts` | 162 | Top-level workflow schema (`workflowDefinitionSchema`), worktree policy, result-type unions (`WorkflowExecutionResult`, `LoadCommandResult`, `WorkflowWithSource`). |
| `schemas/workflow-run.ts` | 169 | `WorkflowRun`, `WorkflowRunStatus` (6 values), `NodeState`, `NodeOutput` (discriminated by state), `ApprovalContext`, `ArtifactType`, terminal/resumable status arrays. |
| `schemas/index.ts` | 121 | Re-exports for everything above. |
| `schemas/hooks.ts` | 88 | Per-node `workflowNodeHooksSchema` (mirrors Claude SDK hook events). |
| `schemas/loop.ts` | 33 | `loopNodeConfigSchema` — `prompt`, `until`, `max_iterations`, `fresh_context`, `until_bash`, `interactive`, `gate_message`. |
| `schemas/retry.ts` | 23 | `stepRetryConfigSchema` — `max_attempts` (1–5), `delay_ms` (1000–60000), `on_error` ('transient' | 'all'). |

### Validators

| Path | LOC | Purpose |
|---|---:|---|
| `validator.ts` | 680 | Post-parse DAG structural validation: cycle detection, `depends_on` reference checks, `$nodeId.output` reference validation, provider/MCP capability warnings. Uses `getProviderCapabilities` + `execFileAsync` for resource checks. |
| `validation-parser.ts` | 64 | Parses `validate:` sub-block from YAML (distinct from `validator.ts`). |
| `command-validation.ts` | 15 | `isValidCommandName(s)` regex check for command-node names. |
| `condition-evaluator.ts` | 174 | Evaluates `when:` expressions on nodes against accumulated `nodeOutputs`. |

### Discovery

| Path | LOC | Purpose |
|---|---:|---|
| `workflow-discovery.ts` | 372 | Filesystem scan for YAML across bundled / `~/.archon/workflows/` / `<repo>/.archon/workflows/` (precedence: bundled < global < project). |
| `script-discovery.ts` | 170 | Discover scripts in `.archon/scripts/` for `script:` nodes (`runtime: bun | uv`). |

### Utilities (`utils/`)

| Path | LOC | Purpose |
|---|---:|---|
| `utils/idle-timeout.ts` | 116 | `withIdleTimeout()` wraps an AsyncGenerator with idle-deadline detection (`STEP_IDLE_TIMEOUT_MS`). |
| `utils/tool-formatter.ts` | 98 | `formatToolCall()` pretty-prints provider tool calls for display. |
| `utils/duration.ts` | 47 | `formatDuration`, `parseDbTimestamp`. |
| `utils/variable-substitution.ts` | 33 | Minimal `substituteVariables(text, args)` — handles `$1..$9`, `$ARGUMENTS`, `\$`. Used for **command-arg** substitution, NOT workflow vars. The full workflow variable substitution lives in `executor-shared.ts:365` (`substituteWorkflowVariables`). |

### Defaults (`defaults/`)

| Path | LOC | Purpose |
|---|---:|---|
| `defaults/bundled-defaults.ts` | 42 | Loader for embedded default workflow YAMLs. Imports `BUNDLED_IS_BINARY` flag. |
| `defaults/bundled-defaults.generated.ts` | 78 | Auto-generated bundle of the 20 default workflow YAMLs as TypeScript string literals. |
| `defaults/text-imports.d.ts` | 28 | TS ambient module declaration for text imports. |

### Misc

| Path | LOC | Purpose |
|---|---:|---|
| `logger.ts` | 237 | Helper logging facade (`logNodeStart`, `logNodeComplete`, `logTool`, etc.) on top of `createLogger` from `@archon/paths`. |
| `test-utils.ts` | 33 | Test helpers (NOT a test file but excluded from runtime use). |

### Discrepancies vs. Plan A.1

Plan A.1 lists these files that **DO NOT EXIST** in `packages/workflows/src/`:

1. **`script-node-deps.ts`** — listed in plan as "resolve dependencies for script nodes". Not present. Script-node `deps:` parsing is inline in `schemas/dag-node.ts` (`scriptNodeSchema`). Runtime resolution is inside `dag-executor.ts` (`runScriptNode` execution path).
2. **`load-command-prompt.ts`** — listed in plan. Not a standalone file. The function `loadCommandPrompt` lives in `executor-shared.ts:199`.
3. **`types.ts`** — listed in plan exports section. Not present. Type exports are split across `schemas/index.ts`, `store.ts`, `deps.ts`. The closest analog is `@archon/providers/types` (a different package).
4. **`index.ts`** — listed in plan as "re-exports". Not present in `workflows/src/`. There is no barrel — consumers import directly from sub-paths.

Plan additionally omits:

- **`logger.ts`** (237 LOC) — needs porting; widely used facade.
- **`test-utils.ts`** — exclude (test-only).
- **`schemas/index.ts`** — needs porting (the barrel that re-exports all schemas).
- **`defaults/bundled-defaults.generated.ts`** — must port or regenerate; 78 LOC of embedded YAML strings.
- **`defaults/text-imports.d.ts`** — needed for TS compilation if defaults are kept as text imports.

Net adjustment: **port count is the same ~30 files**, but composition differs from the plan's named list.

---

## 2. Public API Surface

### `IWorkflowStore` (`store.ts:34-113`) — the SQLite-bridging interface

Backing constant: `WORKFLOW_EVENT_TYPES` (19 event type strings):
`workflow_started | workflow_completed | workflow_failed | node_started | node_completed | node_failed | node_skipped | node_skipped_prior_success | loop_iteration_started | loop_iteration_completed | loop_iteration_failed | tool_called | tool_completed | ralph_story_started | ralph_story_completed | approval_requested | approval_received | workflow_cancelled | workflow_artifact`.

Signatures (verbatim):

```ts
createWorkflowRun(data: {
  workflow_name: string;
  conversation_id: string;
  codebase_id?: string;
  user_message: string;
  metadata?: Record<string, unknown>;
  working_path?: string;
  parent_conversation_id?: string;
}): Promise<WorkflowRun>;

getWorkflowRun(id: string): Promise<WorkflowRun | null>;

getActiveWorkflowRunByPath(
  workingPath: string,
  self?: { id: string; startedAt: Date }
): Promise<WorkflowRun | null>;

findResumableRun(workflowName: string, workingPath: string): Promise<WorkflowRun | null>;
failOrphanedRuns(): Promise<{ count: number }>;
resumeWorkflowRun(id: string): Promise<WorkflowRun>;

updateWorkflowRun(
  id: string,
  updates: Partial<Pick<WorkflowRun, 'status' | 'metadata'>>
): Promise<void>;

updateWorkflowActivity(id: string): Promise<void>;
getWorkflowRunStatus(id: string): Promise<WorkflowRunStatus | null>;
completeWorkflowRun(id: string, metadata?: Record<string, unknown>): Promise<void>;
failWorkflowRun(id: string, error: string): Promise<void>;
pauseWorkflowRun(id: string, approvalContext: ApprovalContext): Promise<void>;
cancelWorkflowRun(id: string): Promise<void>;

createWorkflowEvent(data: {
  workflow_run_id: string;
  event_type: WorkflowEventType;
  step_index?: number;
  step_name?: string;
  data?: Record<string, unknown>;
}): Promise<void>;  // MUST NOT throw — log internally.

getCompletedDagNodeOutputs(workflowRunId: string): Promise<Map<string, string>>;
getCodebaseEnvVars(codebaseId: string): Promise<Record<string, string>>;

getCodebase(id: string): Promise<{
  id: string;
  name: string;
  repository_url: string | null;
  default_cwd: string;
} | null>;
```

**17 methods** (plan A.1.1 says "20+"). Plan's named methods (`updateWorkflowStatus`, `logWorkflowEvent`) **do not exist** — actual names are `updateWorkflowRun` and `createWorkflowEvent`.

### `WorkflowDeps` and the DI contract (`deps.ts`)

```ts
export type AgentProviderFactory = (provider: string) => IAgentProvider;

export interface WorkflowDeps {
  store: IWorkflowStore;
  getAgentProvider: AgentProviderFactory;
  loadConfig: (cwd: string) => Promise<WorkflowConfig>;
}
```

`IWorkflowPlatform` (narrow subset of `IPlatformAdapter`):

```ts
export interface IWorkflowPlatform {
  sendMessage(conversationId: string, message: string, metadata?: WorkflowMessageMetadata): Promise<void>;
  getStreamingMode(): 'stream' | 'batch';
  getPlatformType(): string;
  sendStructuredEvent?(conversationId: string, event: MessageChunk): Promise<void>;
  emitRetract?(conversationId: string): Promise<void>;
}
```

`WorkflowConfig`:

```ts
export interface WorkflowConfig {
  assistant: string;                       // default provider id
  baseBranch?: string;
  docsPath?: string;
  envVars?: Record<string, string>;
  commands: { folder?: string };
  defaults?: { loadDefaultWorkflows?: boolean; loadDefaultCommands?: boolean };
  assistants: ProviderDefaultsMap & {
    claude: { model?: string; settingSources?: ('project'|'user')[] };
    codex: {
      model?: string;
      modelReasoningEffort?: ModelReasoningEffort;
      webSearchMode?: WebSearchMode;
      additionalDirectories?: string[];
    };
  };
}
```

`WorkflowMessageMetadata.category` enum: `'tool_call_formatted' | 'workflow_status' | 'workflow_dispatch_status' | 'isolation_context' | 'workflow_result'`.

### YAML schema shape (top level)

`workflowBaseSchema` (`schemas/workflow.ts:56`) + `nodes: DagNode[]`:

Top-level keys: `name` (req), `description` (req), `provider?`, `model?`, `modelReasoningEffort?`, `webSearchMode?`, `additionalDirectories?`, `interactive?`, `effort?`, `thinking?`, `fallbackModel?`, `betas?`, `sandbox?`, `worktree?: { enabled?: boolean }`, `mutates_checkout?: boolean`, `tags?: string[]`, `nodes`.

Node types (mutually exclusive per node): `command | prompt | bash | script | loop | approval | cancel`.

---

## 3. External Dependency Stubs (A.0 scope)

### `@archon/paths` imports (must be stubbed)

Used by 9 workflow files + 7 provider files. Imports needed:

| Symbol | Use sites |
|---|---|
| `createLogger(ns)` | All over: `condition-evaluator`, `dag-executor`, `event-emitter`, `executor`, `executor-shared`, `loader`, `logger`, `router`, `script-discovery`, `validator`, `workflow-discovery`, plus all 4 provider files + `registry.ts`. |
| `BUNDLED_IS_BINARY` | `defaults/bundled-defaults.ts`, `claude/binary-resolver.ts`, `codex/binary-resolver.ts`. |
| `BUNDLED_VERSION` | `executor.ts:9`. |
| `captureWorkflowInvoked` | `executor.ts:9` (analytics no-op candidate). |
| `getHomeScriptsPath` | `script-discovery.ts:9`. |
| `getArchonHome` | `codex/binary-resolver.ts:21` (vendor dir lookup). |
| (broad import) `import * as archonPaths from '@archon/paths'` | `executor-shared.ts:11`, `executor.ts:8`, `workflow-discovery.ts:27`. Star imports — stub must expose all named exports the engine touches. Inspect each star site to enumerate the precise call set before the stub is locked. |
| (more) `validator.ts` lines 17–21 import additional path/log helpers. |

`captureWorkflowInvoked` — analytics call → safe no-op.

### `@archon/git` imports

| Symbol | Use sites |
|---|---|
| `execFileAsync` | `dag-executor.ts:10`, `validator.ts:22`. Stub via `util.promisify(child_process.execFile)`. |
| `getDefaultBranch` | `executor.ts:10`. Stub returns `'main'` per A.0. |
| `toRepoPath` | `executor.ts:10`. Identity stub (no worktrees). |

### `@archon/isolation`

**Zero imports detected** in workflow or provider source. Plan A.0 lists it as needing a stub, but the engine doesn't actually import from it. Worktree-isolation concepts are referenced only as TypeScript identifiers via `workflowWorktreePolicySchema`. **Stub not needed unless a port surfaces hidden uses.**

### `@archon/providers` (NOT a stub — A.3 port target)

`dag-executor`, `executor`, `loader`, `validator` import from `@archon/providers` and `@archon/providers/types`. These are the symbols that come from A.3:

- From `@archon/providers/types`: `IAgentProvider`, `MessageChunk`, `TokenUsage`, `SendQueryOptions`, `NodeConfig`, `ProviderDefaultsMap`, `ProviderCapabilities`, `ProviderRegistration`, `ProviderInfo`, `AgentRequestOptions`.
- From `@archon/providers` (registry): `isRegisteredProvider`, `getRegisteredProviders`, `getProviderCapabilities`.

These must be available before `executor.ts` / `dag-executor.ts` compile. Plan ordering (A.3 after A.1) is workable only if A.1 ports `deps.ts` first and provider types are stubbed; otherwise A.3 must come earlier.

### Bun-specific APIs

**Only one Bun call** in the engine + providers:

- `loader.ts:29` — `Bun.YAML.parse(content)`. Replace with `js-yaml` or `yaml` npm package.

No `Bun.spawn`, `Bun.file`, `Bun.write`, `Bun.serve`, etc.

### Node-incompatible APIs

None detected beyond `Bun.YAML.parse`. The providers use `node:fs`, `node:os`, `node:path`, `node:child_process` (via SDK). Subprocess work is delegated to the Claude/Codex SDKs (`@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`), which are Node-compatible.

`runtime-check.test.ts` exists (not ported — test only). Worth reading before final port to verify any runtime-shim assumptions.

---

## 4. Provider Port Scope

### File inventory (`packages/providers/src/`)

Files to port for hermes-switchui (excluding Pi community provider + tests + mocks):

| Path | LOC | Purpose |
|---|---:|---|
| `claude/provider.ts` | 1055 | `ClaudeProvider` — implements `IAgentProvider`. Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` async generator. Translates `NodeConfig` to SDK `Options`, normalizes content blocks (`text` / `tool_use`) into `MessageChunk`. Auth modes via `CLAUDE_USE_GLOBAL_AUTH` env. |
| `claude/binary-resolver.ts` | 125 | Resolves `pathToClaudeCodeExecutable` for the SDK. Order: `CLAUDE_BIN_PATH` env → config `assistants.claude.claudeBinaryPath` → autodetect `~/.local/bin/claude[.exe]` → throw. Dev mode (`BUNDLED_IS_BINARY=false`) returns undefined so SDK self-resolves. |
| `claude/config.ts` | 35 | `parseClaudeConfig()` — coerces YAML assistants block into `ClaudeProviderDefaults`. |
| `claude/capabilities.ts` | 17 | `CLAUDE_CAPABILITIES` constant. |
| `claude/index.ts` | 8 | Barrel exports. |
| `codex/provider.ts` | 665 | `CodexProvider` — implements `IAgentProvider`. Singleton `Codex` instance from `@openai/codex-sdk`. Translates `NodeConfig` to `ThreadOptions/TurnOptions`. Streams `TurnCompletedEvent` into `MessageChunk`. |
| `codex/binary-resolver.ts` | 165 | Resolves Codex CLI binary. Order: `CODEX_BIN_PATH` env → config `assistants.codex.codexBinaryPath` → `~/.archon/vendor/codex/<bin>` → autodetect npm prefix paths → throw. |
| `codex/config.ts` | 46 | `parseCodexConfig()`. |
| `codex/capabilities.ts` | 17 | `CODEX_CAPABILITIES` constant. |
| `codex/index.ts` | 3 | Barrel. |
| `types.ts` | 328 | Contract layer (no runtime deps). All interfaces consumed by `deps.ts`. |
| `registry.ts` | 161 | Provider registry: `registerProvider`, `getAgentProvider`, `getRegistration`, `getProviderCapabilities`, `getRegisteredProviders`, `getProviderInfoList`, `isRegisteredProvider`, `registerBuiltinProviders`, `registerCommunityProviders`, `clearRegistry`. Map-backed. |
| `errors.ts` | 14 | `UnknownProviderError`. |
| `index.ts` | 55 | Barrel re-exports. |

**Total to port: 14 files / ~2,694 LOC** (excludes Pi: 8 files / ~1,725 LOC excluded per plan).

`test/mocks/logger.ts` (28 LOC) — test-only, skip.

### `IAgentProvider` (verbatim)

```ts
export interface IAgentProvider {
  sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: SendQueryOptions
  ): AsyncGenerator<MessageChunk>;

  getType(): string;
  getCapabilities(): ProviderCapabilities;
}
```

### Subprocess stdio streaming

Neither provider spawns subprocesses directly — both delegate to SDKs:

- **Claude:** `@anthropic-ai/claude-agent-sdk` exports a `query()` function returning an async iterable of SDK message objects. `claude/provider.ts` consumes the iterable, classifies each message (assistant text, thinking, tool use, tool result, system, result), and yields the engine's `MessageChunk` discriminated-union shape. The SDK itself spawns `claude` (native binary or `cli.js`).
- **Codex:** `@openai/codex-sdk` exposes `Codex` class → `Thread` → `Turn`. The provider opens one singleton `Codex` instance (`codexPathOverride` from `resolveCodexBinaryPath`), creates a `Thread` with `ThreadOptions` (cwd, sandbox, model, reasoning effort, web search mode), and observes `TurnCompletedEvent` to flush tokens. The SDK spawns `codex` CLI.

Both providers therefore inherit stdio handling from the SDK. The engine sees only `MessageChunk` events; no raw stdout/stderr handling needed in the port.

### Binary resolution

Two near-identical patterns documented above. Key differences:

- Claude defaults to native installer path (`~/.local/bin/claude[.exe]`).
- Codex falls back to `~/.archon/vendor/codex/<bin>` then npm-prefix autodetect (`~/.npm-global/bin/codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, `%AppData%/npm/codex.cmd`).
- Both honor `*_BIN_PATH` env, then config, then autodetect, then throw with install instructions.
- `BUNDLED_IS_BINARY=false` (dev) → Claude honors env override only; Codex returns undefined unconditionally.

Both expose `fileExists(path)` as a separately-importable wrapper for test spying.

---

## 5. Event Emitter Contract (`event-emitter.ts`)

Singleton emitter wired to `events.EventEmitter` (max 50 listeners). One channel: `'workflow_event'`. Subscriber-side filtering by `conversationId` via `conversationMap: Map<runId, conversationId>`.

### Event types (TypeScript union `WorkflowEmitterEvent`, 15 variants)

All carry `type` discriminator and `runId`. Payloads verbatim:

| Event `type` | Payload (in addition to `runId`) | Emitted by |
|---|---|---|
| `workflow_started` | `workflowName, conversationId` | `executor.ts` / `dag-executor.ts` near run entry |
| `workflow_completed` | `workflowName, duration` | dag-executor end-of-run |
| `workflow_failed` | `workflowName, error` | dag-executor failure paths (lines 3084, 3115, 3154) |
| `workflow_cancelled` | `nodeId, reason` | dag-executor cancel branches (line 2470 area) |
| `workflow_artifact` | `artifactType: ArtifactType, label, url?, path?` | post-node artifact reporting (executor.ts) |
| `node_started` | `nodeId, nodeName` | dag-executor (lines 610, 1301, 1468, etc., per node-type) |
| `node_completed` | `nodeId, nodeName, duration, costUsd?, stopReason?, numTurns?` | dag-executor (lines 1189, 1367, 1631) |
| `node_failed` | `nodeId, nodeName, error` | dag-executor (lines 638, 1059, 1104, 1147, 1245, 1415, 1528, 1559, 1679) |
| `node_skipped` | `nodeId, nodeName, reason: 'when_condition' \| 'when_condition_parse_error' \| 'trigger_rule' \| 'prior_success'` | dag-executor skip branches |
| `loop_iteration_started` | `nodeId?, iteration, maxIterations` | dag-executor loop (line 1814) |
| `loop_iteration_completed` | `nodeId?, iteration, duration, completionDetected` | dag-executor loop |
| `loop_iteration_failed` | `nodeId?, iteration, error` | dag-executor loop (lines 2022, 2073) |
| `tool_started` | `toolName, stepName` | dag-executor (lines 817, 1974) |
| `tool_completed` | `toolName, stepName, durationMs` | dag-executor (lines 790, 862, 1894, 1953) |
| `approval_pending` | `nodeId, message` | dag-executor approval-pause path |

### DB event types vs emitter event types

`store.ts` exports `WORKFLOW_EVENT_TYPES` — **19** event names persisted to DB. They overlap but are not identical to the emitter's 15 in-memory events. DB-only events include: `node_skipped_prior_success`, `tool_called` (vs emitter's `tool_started`), `ralph_story_started`, `ralph_story_completed`, `approval_requested` (vs emitter's `approval_pending`), `approval_received`. **Two parallel taxonomies — A.1.2 SSE bridge must pick one or normalize both.**

### Subscription API

```ts
subscribe(listener: (e: WorkflowEmitterEvent) => void): () => void  // unsubscribe
subscribeForConversation(conversationId: string, listener): () => void
registerRun(runId: string, conversationId: string): void
unregisterRun(runId: string): void
getConversationId(runId: string): string | undefined
emit(event: WorkflowEmitterEvent): void  // fire-and-forget; listener errors logged not thrown
```

Singleton accessor: `getWorkflowEventEmitter()`. Test reset: `resetWorkflowEventEmitter()`.

---

## 6. YAML Node Type Semantics

All node variants extend `dagNodeBaseSchema` (`schemas/dag-node.ts:132`). Base fields:

```
id (req, non-empty after trim)
depends_on?: string[]
when?: string                 // condition expression
trigger_rule?: 'all_success' | 'one_success' | 'none_failed_min_one_success' | 'all_done'
model?: string
provider?: string             // must match registered provider id (validator runtime check)
context?: 'fresh' | 'shared'
output_format?: Record<string, unknown>  // typically { type:'json_schema', schema:{} }
allowed_tools?: string[]
denied_tools?: string[]
idle_timeout?: number         // ms, finite positive
retry?: { max_attempts: 1-5, delay_ms?: 1000-60000, on_error?: 'transient'|'all' }
hooks?: WorkflowNodeHooks     // see hooks.ts (21 SDK hook event names)
mcp?: string                  // path to MCP config JSON
skills?: NonEmpty<string[]>
agents?: Record<kebab-case-id, AgentDefinition>
effort?: 'low'|'medium'|'high'|'max'
thinking?: 'adaptive'|'enabled'|'disabled' | { type, budgetTokens? }
maxBudgetUsd?: number (>0)
systemPrompt?: string
fallbackModel?: string
betas?: NonEmpty<string[]>
sandbox?: SandboxSettings     // full Claude SDK SandboxSettings shape
```

Per-variant additions:

### `command:`
```ts
commandNodeSchema = dagNodeBaseSchema.extend({ command: z.string() })
```
- `command` validated via `isValidCommandName()`.
- Loader reads command body via `loadCommandPrompt()` from `.archon/commands/`.

### `prompt:`
```ts
promptNodeSchema = dagNodeBaseSchema.extend({ prompt: z.string() })
```
- Inline AI prompt; uses provider for execution.

### `bash:`
```ts
bashNodeSchema = dagNodeBaseSchema.extend({
  bash: z.string(),
  timeout?: z.number()   // ms, positive
})
```
- AI fields ignored at runtime (warning). See `BASH_NODE_AI_FIELDS`.

### `script:`
```ts
scriptNodeSchema = dagNodeBaseSchema.extend({
  script: z.string().min(1),
  runtime: z.enum(['bun', 'uv']),
  deps?: z.array(z.string().min(1)),
  timeout?: z.number()
})
```
- `runtime` REQUIRED (enforced in superRefine).
- AI fields ignored (same list as bash).

### `loop:`
```ts
loopNodeSchema = dagNodeBaseSchema.extend({
  loop: loopNodeConfigSchema
})
// loopNodeConfigSchema:
{
  prompt: string (non-empty),
  until: string (non-empty),         // completion signal
  max_iterations: positive int,
  fresh_context: boolean (default false),
  until_bash?: string,                // exit 0 = complete
  interactive?: boolean,
  gate_message?: string               // required when interactive=true
}
```
- `retry` NOT allowed on loop nodes (enforced at parse time).
- Most AI fields ignored on loop wrapper but `model`/`provider` ARE used (forwarded to each iteration). See `LOOP_NODE_AI_FIELDS`.

### `approval:`
```ts
approvalNodeSchema = dagNodeBaseSchema.extend({
  approval: {
    message: string (non-empty),
    capture_response?: boolean,
    on_reject?: { prompt: string, max_attempts?: 1-10 }
  }
})
```
- Pauses run; surfaces through `approval_pending` event + DB `approval_requested`.
- `capture_response=true` → user's comment stored as `$nodeId.output`.

### `cancel:`
```ts
cancelNodeSchema = dagNodeBaseSchema.extend({
  cancel: z.string().min(1)    // reason
})
```
- Terminates workflow with reason string.

### Mutual exclusivity

Exactly **one** of `command | prompt | bash | loop | approval | cancel | script` per node. Enforced by `superRefine` (`dag-node.ts:418`).

---

## 7. Variable Substitution Rules

Two distinct substitution layers — easy to confuse.

### Layer 1: `utils/variable-substitution.ts:14` — command-arg substitution

Used for loading command files. Substitutes:
- `$1`..`$9` → positional args
- `$ARGUMENTS` → all args joined by space
- `\$` → literal `$` (escape)

```ts
substituteVariables(text: string, args: string[], _metadata = {}): string
```

### Layer 2: `executor-shared.ts:365` — workflow-variable substitution

The full DAG-aware substitution. Supports (verbatim from doc comment):

| Variable | Source |
|---|---|
| `$WORKFLOW_ID` | Run id |
| `$USER_MESSAGE` | User trigger message |
| `$ARGUMENTS` | Alias for `$USER_MESSAGE` |
| `$ARTIFACTS_DIR` | External artifacts dir for this run |
| `$BASE_BRANCH` | Resolved base branch (or throws if referenced and unresolved) |
| `$DOCS_DIR` | From config or `'docs/'` default |
| `$CONTEXT` / `$EXTERNAL_CONTEXT` / `$ISSUE_CONTEXT` | GitHub issue/PR context; replaced with `''` when none |
| `$LOOP_USER_INPUT` | Interactive-loop approval payload (first iteration of resumed loop only) |
| `$REJECTION_REASON` | Reviewer feedback on `on_reject` prompts |
| `$LOOP_PREV_OUTPUT` | Cleaned prior-iteration output (empty on first iteration) |

Returns `{ prompt, contextSubstituted }` so `buildPromptWithContext()` can decide whether to append context separately (no duplication).

### Layer 3: `$nodeId.output` references

Handled by `substituteNodeOutputRefs()` in `dag-executor.ts:286`. Reads from accumulated `nodeOutputs: Map<string, NodeOutput>` populated as upstream nodes complete. Validator pre-checks references at parse time.

### Escape rules

`\$` → `$` (Layer 1 only). Layer 2 doesn't escape — patterns are literal `$VARNAME` regex replacements; if you need a literal dollar in workflow text, no escape exists.

### Plan note

Plan A.2.4 lists `$WORKFLOW_ID, $ARTIFACTS_DIR, $1, $ARGUMENTS, $LOOP_USER_INPUT`. **Missing from plan:** `$USER_MESSAGE, $BASE_BRANCH, $DOCS_DIR, $CONTEXT, $EXTERNAL_CONTEXT, $ISSUE_CONTEXT, $REJECTION_REASON, $LOOP_PREV_OUTPUT` and the `$nodeId.output` reference syntax. Also: `$1`..`$9` only apply at command-arg layer (not workflow vars).

---

## 8. Run Lifecycle (`dag-executor.ts`)

### Entry point

```
executeDagWorkflow(workflow, ...)  // dag-executor.ts:2486
```

### State machine

Statuses (from `workflowRunStatusSchema`): `pending | running | completed | failed | cancelled | paused`. Terminal: `completed | failed | cancelled`. Resumable: `failed | paused`.

```
                ┌────────────────────────────────────┐
                ▼                                    │
created → pending → running ──► completed            │
                      │                              │
                      ├──► failed ◄─── (resume) ◄────┤
                      │                              │
                      ├──► cancelled                 │
                      │                              │
                      └──► paused ──► (resume) ──────┘
                          (approval / interactive loop)
```

Transitions (all driven via `deps.store.*` methods in dag-executor):

| Transition | Trigger | Method called |
|---|---|---|
| `created → pending → running` | Run dispatch / start | `createWorkflowRun` (caller) → run loop begins |
| `running → completed` | All layers finished without failure or pause | `completeWorkflowRun(id, metadata)` |
| `running → failed` | Any layer reports failure with no retry remaining; OR caught exception in executor | `failWorkflowRun(id, error)` (lines 3084, 3115, 3154 emit `workflow_failed`) |
| `running → paused` | Approval node reached OR interactive loop gate hit | `pauseWorkflowRun(id, approvalContext)` (lines 2261, 2461) |
| `paused → running` | User approves; caller invokes `resumeWorkflowRun` | `resumeWorkflowRun(id)` |
| `running → cancelled` | Cancel signal observed via `getWorkflowRunStatus` poll OR cancel node executed | `cancelWorkflowRun(id)` (lines 2342, 2816) |

Between-layer status checks: `getWorkflowRunStatus(id)` is polled between topological layers. If status is `paused` or `cancelled`, the executor breaks out cleanly. Mid-stream (within a node), `shouldContinueStreamingForStatus()` (line 181) controls whether to keep a streaming node alive — `running` and `paused` continue; everything else aborts.

### Concurrency / topology

```
buildTopologicalLayers(nodes)  // dag-executor.ts:521
```

Pure Kahn's algorithm:

1. Compute `inDegree[node.id] = depends_on?.length ?? 0`.
2. Reverse-adj map (`dependents`) built from each node's `depends_on`.
3. Initial layer = all `inDegree=0` nodes.
4. For each layer: collect all currently-ready nodes; for each, decrement dependents' in-degrees; next layer = newly-zero nodes.
5. Cycle detection: `if sum(layer sizes) < nodes.length → cycle exists` (throws).

Execution per layer (`dag-executor.ts:2554`):

```ts
const layerResults = await Promise.allSettled(
  layer.map(async (node) => executeNode(node, ...))
);
```

- `Promise.allSettled` so one node's rejection doesn't tear down siblings.
- After the layer: store all `nodeOutputs`, detect failures, decide whether to abort.
- Session threading: for sequential single-node layers, the SDK session id is threaded forward into the next layer. Parallel layers (>1 node) always get fresh sessions per node. Explicit `context: 'fresh'` forces fresh regardless.

### Pause/cancel semantics (in-layer)

When one node in a parallel layer pauses (approval) or another transitions the run to `cancelled`:

- Concurrent in-flight nodes: pause = let them finish naturally; cancel = abort via stream-cancel branch.
- Approval nodes always emit `approval_pending` + DB `approval_requested` before pausing.
- Resume path uses `getCompletedDagNodeOutputs(runId)` to pre-populate `nodeOutputs` so already-done nodes are skipped on re-run (skip emitted as `node_skipped_prior_success`).

### Retry

- Default for transient errors: `DEFAULT_NODE_MAX_RETRIES=2`, `DEFAULT_NODE_RETRY_DELAY_MS=3000`.
- Per-node override via `retry: { max_attempts, delay_ms, on_error }`.
- Classification via `classifyError()` in `executor-shared.ts:73`.

### Heartbeats

- `updateWorkflowActivity(id)` called periodically per `ACTIVITY_HEARTBEAT_INTERVAL_MS=60_000` (stale/zombie detection).
- Cancel poll throttle: `CANCEL_CHECK_INTERVAL_MS=10_000`.
- Idle timeout per node: `STEP_IDLE_TIMEOUT_MS` (default) wraps streams via `withIdleTimeout()`.

---

## GAPS / OPEN QUESTIONS

Issues, omissions, and inaccuracies in `docs/plans/archon-hermes-integration.md` A.0–A.4 surfaced by this research:

1. **A.1 file list is partially fictional.**
   - `script-node-deps.ts`, `load-command-prompt.ts`, `types.ts`, `index.ts` listed but **DO NOT EXIST**. Functions named in those bullets actually live in `executor-shared.ts` (`loadCommandPrompt`) or `dag-executor.ts` (script-node deps resolution) or split across `schemas/index.ts` + `store.ts` + `deps.ts` (types).
   - Plan **omits** `logger.ts` (237 LOC, used everywhere via `logNode*` helpers), `schemas/index.ts`, `defaults/bundled-defaults.generated.ts`, `defaults/text-imports.d.ts`. All needed for port.

2. **A.0 lists `@archon/isolation` as needing stubs — zero engine/provider imports from it.** Either drop from A.0 or document why we expect future imports.

3. **A.0 stub list is incomplete.**
   - Missing: `BUNDLED_IS_BINARY`, `getArchonHome` (Codex needs it for vendor dir), plus the star-import surface from `executor-shared.ts`, `executor.ts`, `workflow-discovery.ts`. Star imports must be enumerated by inspection before the stub is locked.

4. **A.0 missing the `@archon/providers` boundary.** `dag-executor.ts`, `executor.ts`, `loader.ts`, `validator.ts` import from `@archon/providers` (registry helpers) and `@archon/providers/types` (contract). A.1 cannot compile without these in place — either A.3 must precede A.1, or A.0 must include a type-only providers stub. Plan's "Provider types ported in A.1" note in Key Decisions is correct but the ordering table (P0 A.1 before P1 A.3) contradicts it.

5. **A.1.1 method count and names wrong.** Plan says "20+ methods" — actual count is **17**. Plan-named methods that don't exist: `updateWorkflowStatus`, `logWorkflowEvent`. Real names: `updateWorkflowRun(id, {status, metadata})`, `createWorkflowEvent(...)`. Implementation contract also requires `createWorkflowEvent` to NEVER throw (silently log) — important for the Kanban-backed implementation.

6. **A.1.1 missing methods.**
   - `getActiveWorkflowRunByPath(workingPath, self?)` — split-brain prevention for dual dispatch. Critical for correctness; not mentioned.
   - `findResumableRun(workflowName, workingPath)` — used by resume flow.
   - `failOrphanedRuns()` — orphan reaper called on startup.
   - `getCompletedDagNodeOutputs(runId)` — drives resume node-skipping; non-trivial Kanban schema impact (must reconstruct from `task_runs`/`task_events`).
   - `getCodebaseEnvVars(codebaseId)`, `getCodebase(id)` — codebase concept doesn't exist in Hermes Kanban. Either add a mapping (workspace = codebase) or stub.

7. **Two parallel event taxonomies.** `WORKFLOW_EVENT_TYPES` (19 DB events in `store.ts`) ≠ `WorkflowEmitterEvent` (15 emitter events). Examples: emitter uses `tool_started/completed`, DB uses `tool_called/completed`; emitter uses `approval_pending`, DB uses `approval_requested/received`. **A.1.2 must decide whether the SSE bridge subscribes to the emitter, tails the DB events table, or both.** Plan A.1.2's named events (`workflow:started`, `workflow:node_completed`, etc.) match neither taxonomy verbatim.

8. **Variable substitution scope wider than A.2.4 lists.** Plan misses `$USER_MESSAGE, $BASE_BRANCH, $DOCS_DIR, $CONTEXT/$EXTERNAL_CONTEXT/$ISSUE_CONTEXT, $REJECTION_REASON, $LOOP_PREV_OUTPUT`. Also misses the `{prompt, contextSubstituted}` return contract that prevents context duplication. The `$1..$9` listed in plan applies only to command-arg loading, not workflow-vars.

9. **A.2.2 node-type mapping omits `cancel`.** Plan table has prompt/bash/script/loop/approval/command. Engine ALSO ships `cancel:` nodes (terminate run with reason) — used by routing logic in several bundled workflows (e.g. `archon-create-issue` when reproduction fails). Needs a Kanban mapping or explicit "terminates parent task with reason."

10. **`loader.ts` Bun dependency.** Plan says "use Node.js child_process, fs equivalents". The ONLY Bun call is `Bun.YAML.parse` on `loader.ts:29`. Replace with `yaml` or `js-yaml` npm package (one-line change). Worth calling out so the port doesn't over-engineer.

11. **Provider port LOC is bigger than implied.** `claude/provider.ts` is 1055 LOC, `codex/provider.ts` is 665 LOC — these encode all the SDK-option translation logic. Plan A.3 lists files but doesn't flag scope; budget should account for ~2,700 LOC across 14 files, mostly mechanical but with subprocess/SDK gotchas (auth modes, binary resolution edge cases, singleton lifecycle for Codex).

12. **`registerBuiltinProviders()` registers BOTH Claude and Codex unconditionally.** Plan implies we may want to gate behind installed-binary detection. Worth deciding whether to (a) call `registerBuiltinProviders()` at startup and accept lazy errors when a provider is invoked without its binary, or (b) only register providers whose `resolveXxxBinaryPath()` succeeds. Current code does (a).

13. **`registerCommunityProviders()` registers Pi unconditionally** via `community/pi/registration.ts`. Plan correctly excludes Pi but the `registry.ts` file imports `registerPiProvider` at the top. Port either: (a) keep import + leave `registerCommunityProviders` callable as no-op equivalent, (b) delete the import and the function, or (c) refactor to make community registration pluggable. Pick one and document.

14. **`WorkflowConfig.assistant` is the default provider id.** Hermes equivalent = Switch UI settings. Plan B.3 covers UI but A.3 doesn't say where the `loadConfig(cwd)` implementation lives in Switch UI. Suggest: new `hermes-workflow-config.ts` alongside `hermes-workflow-store.ts`.

15. **Resume semantics undefined in plan.** Engine has rich resume (`resumeWorkflowRun`, `findResumableRun`, `getCompletedDagNodeOutputs`, `RESUMABLE_WORKFLOW_STATUSES = ['failed', 'paused']`). A.4 covers replay-on-reconnect for triggers, but A.1/A.2 don't address how user-initiated resume surfaces in UI or how `task_runs` participates. Open: does each resume create a new `task_runs` row, or update the prior one?
