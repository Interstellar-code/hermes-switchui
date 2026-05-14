# Spec: A.8 — 5-Phase Orchestration Wrapper

> **Workstream:** A
> **Owner:** Executor subagent (Sonnet 4.6)
> **Depends on:** A.0, A.1, A.1.1, A.2.1, A.2.3, A.3 (all merged)
> **Archon source pin:** `78d32cfb`

## Goal

Wire the engine end-to-end so `POST /api/workflow-runs` actually runs the DAG. Add the 5-phase state machine (`plan → route → execute → review → report`) on top of the existing DAG executor.

For v1, plan/route/review are minimal:
- **plan**: trivial — variables already collected by Launch Wizard. Auto-records transition.
- **route**: trivial — workflow already chosen. Auto-records transition.
- **execute**: invokes ported `executeWorkflow(deps, platform, ...)` async.
- **review**: skipped in v1 (no review nodes wired). Recorded as auto-skip transition.
- **report**: emits a `workflow_completed` summary event + advances workflow_runs.status='completed' or 'failed'.

## Files to create / modify

```
src/server/workflow-engine/
├── store/workflow-store.ts                # ADD: recordPhaseTransition() + listPhaseTransitions()
├── phases/
│   ├── phase-machine.ts                   # NEW: advancePhase + transition log writes
│   ├── phase-machine.test.ts              # NEW
│   └── index.ts
├── runtime/
│   ├── runner.ts                          # NEW: launchWorkflowRun() — entry from POST route
│   ├── runner.test.ts                     # NEW
│   ├── load-config.ts                     # NEW: minimal WorkflowConfig loader
│   ├── platform.ts                        # NEW: IWorkflowPlatform impl bridging emitter
│   └── index.ts
└── wiring/engine.ts                       # MODIFY: expose deps + emitter + platform on engine

src/routes/api/
├── workflow-runs.ts                       # MODIFY: POST → call launchWorkflowRun
└── workflow-runs.$runId.ts                # MODIFY: action=advance to/from any phase
```

## Phase machine contract

```ts
// src/server/workflow-engine/phases/phase-machine.ts
export type Phase = 'plan' | 'route' | 'execute' | 'review' | 'report';
export type DecidedBy = 'user' | 'engine' | 'router' | 'system';

export const VALID_TRANSITIONS: Record<Phase, Phase[]> = {
  plan:    ['route', 'execute'],   // v1 may skip route directly to execute
  route:   ['execute'],
  execute: ['review', 'report'],   // review optional; can skip to report
  review:  ['execute', 'report'],  // can loop back to execute
  report:  [],                     // terminal phase
};

export interface PhaseMachine {
  advancePhase(
    runId: string,
    toPhase: Phase,
    decidedBy: DecidedBy,
    decisionData?: Record<string, unknown>,
  ): Promise<{ from: Phase; to: Phase }>;
}
```

**Validation rules:**
- `to` must be in `VALID_TRANSITIONS[current]` else throw `InvalidPhaseTransitionError`.
- Atomic: `UPDATE workflow_runs SET current_phase=?` + `INSERT INTO phase_transitions` in one tx.
- Idempotent: same-phase advance is a no-op (returns `{ from: x, to: x }`).
- Returns the actual transition for logging.

## Store additions

```ts
// store/workflow-store.ts (extend the existing class)

/** Atomic phase advance — records transition AND updates workflow_runs.current_phase. */
async recordPhaseTransition(input: {
  runId: string;
  toPhase: Phase;
  decidedBy: DecidedBy;
  decisionData?: Record<string, unknown>;
}): Promise<{ from: Phase; to: Phase }> {
  // 1. SELECT current_phase FROM workflow_runs WHERE id=?
  // 2. Validate against VALID_TRANSITIONS (throw if invalid; idempotent if same).
  // 3. db.transaction(() => {
  //      UPDATE workflow_runs SET current_phase=? WHERE id=?;
  //      INSERT INTO phase_transitions (id, workflow_run_id, from_phase, to_phase, decided_by, decision_data, at)
  //    })();
  // 4. Return { from, to }.
}

listPhaseTransitions(runId: string): Array<{
  id: string;
  from_phase: string | null;
  to_phase: string;
  decided_by: string;
  decision_data: Record<string, unknown> | null;
  at: number;
}> {
  // SELECT ... FROM phase_transitions WHERE workflow_run_id=? ORDER BY at ASC
}
```

## IWorkflowPlatform implementation

```ts
// runtime/platform.ts
import type { IWorkflowPlatform, WorkflowMessageMetadata, MessageChunk } from '../wiring/deps';
import type { WorkflowEventEmitter } from '../emitter/event-emitter';

export class EngineWorkflowPlatform implements IWorkflowPlatform {
  constructor(private readonly emitter: WorkflowEventEmitter) {}

  async sendMessage(conversationId: string, message: string, metadata?: WorkflowMessageMetadata): Promise<void> {
    // Bridge to the emitter so SSE consumers see workflow messages.
    // For v1: emit a custom 'platform_message' event payload. The SSE bridge
    // (A.1.2, future) translates these to SSE frames.
    this.emitter.emit('platform_message', {
      conversationId,
      message,
      metadata,
    });
  }

  getStreamingMode(): 'stream' | 'batch' { return 'stream'; }
  getPlatformType(): string { return 'switch-ui'; }

  async sendStructuredEvent(conversationId: string, event: MessageChunk): Promise<void> {
    this.emitter.emit('platform_chunk', { conversationId, event });
  }

  async emitRetract(conversationId: string): Promise<void> {
    this.emitter.emit('platform_retract', { conversationId });
  }
}
```

**If the emitter doesn't have generic `emit` (it's typed by WORKFLOW_EVENT_TYPES), pick the closest existing event type or extend the emitter's union with a `platform_*` group.** Inspect `emitter/event-emitter.ts` for its public surface — adapt the platform's calls to match.

## Config loader

```ts
// runtime/load-config.ts
import type { WorkflowConfig } from '../wiring/deps';

/**
 * v1 minimal config — hard-coded defaults. v1.1 will read ~/.hermes/switchui-workflows.config.yaml
 * if present.
 */
export async function loadWorkflowConfig(_cwd: string): Promise<WorkflowConfig> {
  return {
    assistant: 'hermes-kanban',                 // single provider — A.3 KanbanDispatcher
    commands: { folder: undefined },
    defaults: { loadDefaultWorkflows: true, loadDefaultCommands: true },
    envVars: {},
    baseBranch: undefined,
    docsPath: undefined,
    assistants: {
      claude: { model: undefined },
      codex: { model: undefined },
    } as WorkflowConfig['assistants'],
  };
}
```

## Runner

```ts
// runtime/runner.ts
import { parseWorkflowYaml } from '../discovery/loader';
import { executeWorkflow } from '../core/executor';
import { recordPhaseTransition } from './phases-helpers';  // wraps store helper
import type { WorkflowEngine } from '../wiring/engine';

export interface LaunchInput {
  runId: string;            // already-created workflow_runs row
  workflowYaml: string;     // raw yaml from workflow_definitions.yaml
  conversationId: string;
  cwd: string;
  userMessage: string;
  conversationDbId: string;
  codebaseId?: string;
  parentConversationId?: string;
}

/**
 * Fire-and-forget DAG launch. Caller (POST /api/workflow-runs) returns immediately
 * after this resolves the *plan → route → execute* phase entry; the actual DAG
 * runs async on the server process and resolves the run later.
 */
export async function launchWorkflowRun(
  engine: WorkflowEngine,
  input: LaunchInput,
): Promise<void> {
  const { store, deps, platform } = engine;  // deps + platform added in engine.ts modification

  // 1. plan → route (auto, system)
  await store.recordPhaseTransition({
    runId: input.runId, toPhase: 'route', decidedBy: 'system',
    decisionData: { reason: 'launch-wizard-precollected' },
  });

  // 2. route → execute (auto, engine)
  await store.recordPhaseTransition({
    runId: input.runId, toPhase: 'execute', decidedBy: 'engine',
    decisionData: { workflow_id: /* from run */ '' },
  });

  // 3. Parse YAML once.
  const workflow = parseWorkflowYaml(input.workflowYaml);

  // 4. Mark workflow_runs.status='running'.
  await store.updateWorkflowRun(input.runId, { status: 'running' });

  // 5. Kick off DAG async — do NOT await here. The HTTP response returns
  //    immediately; the DAG completes later and the report-phase hook
  //    advances the run.
  void (async () => {
    try {
      const result = await executeWorkflow(
        deps,
        platform,
        input.conversationId,
        input.cwd,
        workflow,
        input.userMessage,
        input.conversationDbId,
        input.codebaseId,
        undefined,
        undefined,
        input.parentConversationId,
        // preCreatedRun: skip (run row already exists)
      );
      // 6a. execute → report on success.
      await store.recordPhaseTransition({
        runId: input.runId, toPhase: 'report', decidedBy: 'engine',
        decisionData: { result },
      });
      await store.completeWorkflowRun(input.runId, { result });
    } catch (err) {
      // 6b. Failure — mark run failed; phase stays in execute (terminal-failed).
      await store.failWorkflowRun(input.runId, (err as Error).message);
    }
  })();
}
```

**Note on `parseWorkflowYaml`**: the existing `discovery/loader.ts` exposes YAML loading helpers. Find the right export (likely `parseWorkflowYaml` or `loadWorkflow`) — verify its signature against `WorkflowDefinition` (the schema-validated shape used by `executeWorkflow`). If a public parse helper doesn't exist, port a minimal one (the YAML lib is already loaded; wrap with the schema validator from `validation/validator.ts`).

## Engine factory modification

```ts
// wiring/engine.ts — extend WorkflowEngine type + initialization

export interface WorkflowEngine {
  store: SwitchUiWorkflowStore;
  dispatcher: KanbanDispatcher;
  consumer: TaskEventConsumer;
  emitter: WorkflowEventEmitter;     // NEW
  platform: IWorkflowPlatform;       // NEW
  deps: WorkflowDeps;                // NEW
  boot: { orphanedRuns: number; recoveredDispatches: number };
  shutdown(): Promise<void>;
}

// In createWorkflowEngine:
const emitter = new WorkflowEventEmitter();
const platform = new EngineWorkflowPlatform(emitter);
const deps: WorkflowDeps = {
  store,
  getAgentProvider: (_type) => dispatcher,           // kanban-dispatcher is the only provider
  loadConfig: loadWorkflowConfig,
};

return { store, dispatcher, consumer, emitter, platform, deps, boot, shutdown };
```

## API route modifications

`src/routes/api/workflow-runs.ts` POST handler — after `createWorkflowRun`, call `launchWorkflowRun(engine, { runId: run.id, workflowYaml: def.yaml, ... })`. Return the run immediately (DAG is async).

`src/routes/api/workflow-runs.$runId.ts` POST handler — extend action vocabulary:
- `?action=advance&to=<phase>` → manual phase advance (decidedBy='user')
- existing `cancel|resume` remain.

## Tests

`phase-machine.test.ts`:
1. plan→route→execute valid path.
2. plan→report invalid (throws).
3. review→execute valid (loop).
4. report→* invalid (terminal).
5. Idempotent same-phase advance returns `{from:x,to:x}`.
6. phase_transitions row inserted on every advance.
7. `current_phase` updated atomically with the insert.

`runner.test.ts`:
1. launchWorkflowRun records plan→route + route→execute transitions before kicking off DAG.
2. updateWorkflowRun(status='running') called before DAG kickoff.
3. On DAG success: recordPhaseTransition(execute→report) + completeWorkflowRun called.
4. On DAG failure: failWorkflowRun called (no report transition).
5. DAG kickoff doesn't block — runner returns before executeWorkflow resolves.

Mock `executeWorkflow` (don't run real DAG in tests).

## Verification gates

1. `pnpm tsc --noEmit` — zero new errors. Existing `text-shimmer.tsx` errors are unrelated.
2. `pnpm vitest run src/server/workflow-engine/` — total 105+ passing (was 93; +7 phase-machine, +5 runner).
3. New API actions reachable: `POST /api/workflow-runs/:id?action=advance&to=route`.
4. End-to-end on dev server: `POST /api/workflow-runs` returns 201; `GET /api/workflow-runs/:id` shows `current_phase='execute'` within a tick and at least 2 phase_transitions rows.
5. `recordPhaseTransition` is the ONLY path that mutates `workflow_runs.current_phase` — grep confirms no other UPDATE touches that column.

## Deliverables checklist

- [ ] Phase machine module + tests
- [ ] Store: `recordPhaseTransition` + `listPhaseTransitions`
- [ ] Runtime: `loadConfig`, `platform`, `runner`
- [ ] Engine factory: emitter + platform + deps wired
- [ ] API: POST launch calls runner; action=advance route
- [ ] Tests: 12+ new passing
- [ ] tsc clean

## Non-goals

- No chat-driven plan phase (v1.1).
- No review-phase nodes (v1.1).
- No SSE bridge (A.1.2 — emitter wired, but raw events; SSE adapter ships separately).
- No actual provider switching — the only provider is `KanbanDispatcher`.
- No cron/schedule trigger sources (A.4).
- No new MessageChunk variants — use what's in `providers-types.ts`.

## Open questions for executor to resolve

- Is there a public `parseWorkflowYaml` in `discovery/loader.ts`? If not, port the smallest helper needed.
- Does `WorkflowEventEmitter` accept arbitrary event types, or is it typed by `WORKFLOW_EVENT_TYPES`? If typed, either extend the union with platform events OR skip emitter forwarding from platform.sendMessage (acceptable v1 fallback — `console.log` until A.1.2 SSE bridge wires real consumers). Document the choice.
- Does `executeWorkflow` honor a pre-existing `workflow_runs` row, or does it try to create its own? Use the `preCreatedRun` parameter if it exists.
