# Spec: A.3 — Kanban Dispatcher (Provider Replacement)

> **Workstream:** A
> **Owner:** Executor subagent (Sonnet 4.6)
> **Status:** Ready
> **Depends on:** A.0 (providers-types stub), A.1 (engine compiled), A.1.1 (store for `node_runs.kanban_task_id` updates)
> **Blocks:** A.2 (engine ↔ store wiring), A.11 (idempotency contract)
> **Replaces:** the entire upstream Archon provider port (`ClaudeProvider` + `CodexProvider`, ~2700 LOC). This module is ~200 LOC.

## Goal

Implement `IAgentProvider` (from `stubs/providers-types.ts`) as a thin shim that routes `prompt:` / `command:` node execution to Hermes Kanban. The engine's DAG executor calls `provider.sendQuery(...)`; the dispatcher creates a Kanban task via `createKanbanTask()` and yields `MessageChunk` events as the task progresses. Hermes workers decide which CLI (`claude` / `codex` / other) to drive based on the task's skills/labels.

This is the **only** execute-phase channel. There is no parallel CLI-spawning mechanism in the Switch UI engine.

## Files to create

```
src/server/workflow-engine/dispatcher/
├── kanban-dispatcher.ts        # KanbanDispatcher implements IAgentProvider
├── kanban-dispatcher.test.ts   # unit tests with mocked gateway client
└── index.ts                    # barrel + factory
```

Also update:
```
src/server/workflow-engine/stubs/providers.ts
```
to register `KanbanDispatcher` as the single provider returned by `getRegisteredProviders()` and `getProviderCapabilities()`.

## Interface to implement

From `src/server/workflow-engine/stubs/providers-types.ts:303-330`:

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

## `KanbanDispatcher` contract

```ts
export class KanbanDispatcher implements IAgentProvider {
  constructor(
    private readonly opts: {
      /** Engine store — used to map dispatch → node_runs.kanban_task_id. */
      onTaskCreated?: (idempotencyKey: string, kanbanTaskId: string) => Promise<void>;
      /** Engine-emitter for surfacing chunks back to SSE; injected by deps wiring. */
      onChunk?: (chunk: MessageChunk) => void;
    } = {}
  ) {}

  getType(): string { return "hermes-kanban"; }

  getCapabilities(): ProviderCapabilities {
    return {
      streaming: true,
      tools: true,        // workers can use tools per their CLI/plugin
      approvals: false,   // approvals are handled by the engine's approval node, not the worker
      checkpoints: false, // resume is per node_run, not per CLI session
    };
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    resumeSessionId?: string,
    options?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    // 1. Derive idempotency key from options.nodeConfig.id + retries (A.11 will refine).
    //    For v1: idempotencyKey = `${options?.nodeConfig?.id ?? "anon"}-${Date.now()}`.
    //    THREAD this key through createKanbanTask body (header support added later).
    //
    // 2. POST /api/tasks via createKanbanTask({ title, description, skills, model_hint, working_path }).
    //    Map options.nodeConfig.skills → task.skills; options.nodeConfig.model_hint → task.model_hint;
    //    cwd → task.working_path; prompt → task.description.
    //
    // 3. Notify onTaskCreated(idempotencyKey, task.id) so the engine store
    //    can flip node_runs.kanban_task_id atomically.
    //
    // 4. Stream chunks back. For v1, the dispatcher does NOT poll — it
    //    yields a single "task_dispatched" MessageChunk with the kanban task
    //    id and returns. The DAG executor's awaiter is the event consumer
    //    (A.2.3), which watches gateway task_events and resolves
    //    node_runs.summary when the task completes. The async generator
    //    closes after the dispatch chunk.
    //
    //    Rationale: keeping sendQuery short-lived avoids holding the
    //    generator open across worker execution (could be hours). Resume
    //    is event-driven, not generator-driven.
    //
    // 5. Errors during dispatch (gateway 4xx/5xx, network) throw — the DAG
    //    executor's retry layer handles them per node retry config.
  }
}
```

## MessageChunk emitted per dispatch

```ts
yield {
  type: "text",
  text: `[kanban] dispatched as task ${kanbanTaskId} (idempotency: ${idempotencyKey})`,
};
yield {
  type: "metadata",
  meta: { kanbanTaskId, idempotencyKey, dispatchedAt: Date.now() },
};
// generator closes; no further chunks until event-consumer resolves the node_run.
```

(Use the actual `MessageChunk` discriminator variants from `providers-types.ts:121-187`. If `metadata` isn't a variant, use the closest matching one — likely a `tool_use` block with name `"hermes-kanban-dispatch"` or similar. Read the type union and pick the best fit; flag in report.)

## Provider registry shim updates

Edit `src/server/workflow-engine/stubs/providers.ts`:

```ts
import { KanbanDispatcher } from "../dispatcher/kanban-dispatcher.js";
import type { IAgentProvider, ProviderCapabilities } from "./providers-types.js";

const dispatcher = new KanbanDispatcher();

export function isRegisteredProvider(type: string): boolean {
  return type === "hermes-kanban";
}

export function getRegisteredProviders(): IAgentProvider[] {
  return [dispatcher];
}

export function getProviderCapabilities(type: string): ProviderCapabilities | undefined {
  return type === "hermes-kanban" ? dispatcher.getCapabilities() : undefined;
}

// Stub no-ops to satisfy upstream import surface (used only by parked tests):
export function registerBuiltinProviders(): void { /* hermes-kanban auto-registered */ }
export function clearRegistry(): void { /* no-op; single dispatcher */ }
```

Confirm no upstream code references provider types other than `"hermes-kanban"`. If `dag-executor.ts` switches on `provider.getType()`, our value `hermes-kanban` must be accepted.

## Gateway client to call

`src/server/hermes-kanban-client.ts` already exposes `createKanbanTask(input)`. Read its signature, use it as-is. Do NOT add a new HTTP client. If a field the dispatcher needs (e.g. `idempotency_key`, `working_path`, `model_hint`) isn't supported, pass via `metadata` JSON if available, otherwise flag in report — A.11 will widen the gateway contract.

## Tests

`kanban-dispatcher.test.ts` — vitest, in-memory stubs:

1. `getType()` returns `"hermes-kanban"`.
2. `getCapabilities()` returns the documented shape.
3. `sendQuery("hello", "/tmp/repo")` with mocked `createKanbanTask` returning `{ id: "task-123" }`:
   - First yielded chunk is the dispatch text.
   - Second yielded chunk carries `kanbanTaskId: "task-123"` and an `idempotencyKey`.
   - Generator closes after the metadata chunk (third `.next()` returns `{ done: true }`).
4. `onTaskCreated` callback is invoked with `(idempotencyKey, "task-123")` before the generator yields.
5. Gateway error: `createKanbanTask` rejects with `new Error("502 bad gateway")` → `sendQuery` throws the same error on first `.next()`.
6. `options.nodeConfig.skills` and `model_hint` are forwarded to the gateway call body.

Mock `createKanbanTask` via `vi.mock("../../hermes-kanban-client.js", ...)` or by dependency injection (preferred — constructor takes a `createTask` fn for testability).

**Test gate:** all 6 tests pass.

## Verification gates

1. `pnpm tsc --noEmit 2>&1 | grep src/server/workflow-engine/dispatcher/` empty.
2. `pnpm vitest run src/server/workflow-engine/dispatcher/` — 6 passing.
3. `rg "@archon/providers" src/server/workflow-engine/dispatcher/` — empty (dispatcher imports types from stubs only, no registry deps).
4. `getRegisteredProviders()` returns exactly `[KanbanDispatcher instance]` — verified by a vitest case in `stubs/providers.test.ts` (add a new test file or extend existing).
5. Re-run full engine tsc — still 0 errors in `src/server/workflow-engine/`.
6. Re-run full vitest — still 77+ passing (existing tests must not regress).

## Deliverables checklist

- [ ] `dispatcher/kanban-dispatcher.ts` (~150-200 LOC) with the contract above
- [ ] `dispatcher/index.ts` barrel
- [ ] `dispatcher/kanban-dispatcher.test.ts` with 6 tests
- [ ] `stubs/providers.ts` updated to return the dispatcher
- [ ] Optional: `stubs/providers.test.ts` covering registry behavior
- [ ] `pnpm tsc --noEmit` clean (no new errors)
- [ ] `pnpm vitest run` total green
- [ ] PR-style report listing MessageChunk variant chosen + gateway client gaps (if any)

## Non-goals

- No actual polling of task lifecycle — that is the event consumer's job (A.2.3).
- No idempotency key persistence — A.11 owns the dispatch state machine; this spec exposes the key as a string, A.11 will pin generation + storage.
- No approval routing — approval nodes are handled by the engine, not the dispatcher.
- No new gateway endpoints. If existing `createKanbanTask` is insufficient, flag — do not extend the gateway from this side.

## Open question for executor to answer

- Pick the right `MessageChunk` variant for the dispatch confirmation. Read `providers-types.ts:121-187` and report which variant was used (text + tool_use? text + thinking? other?).
