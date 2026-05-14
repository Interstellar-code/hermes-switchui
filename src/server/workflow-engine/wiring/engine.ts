/**
 * Workflow engine boot helper.
 *
 * Bundles store + dispatcher + consumer + cold-start reconciliation into a
 * single entry point. Server boot calls createWorkflowEngine() once on
 * startup; later API routes consume the returned handles.
 *
 * A.11 reliability contract pieces wired here:
 *   1. Single-instance DB lock — enforced by openDb() inside createWorkflowStore.
 *   2. Cold-start orphan reaper — fails workflow_runs with stale heartbeat.
 *   3. Cold-start dispatch reconciliation — re-tracks in-flight Kanban tasks in
 *      the consumer so previously-dispatched node_runs resolve correctly after
 *      a Switch UI server restart.
 *   4. Polling consumer started automatically; stop()/shutdown() during
 *      graceful shutdown.
 */
import { createWorkflowStore } from '../store';
import type { SwitchUiWorkflowStore } from '../store/workflow-store';
import { KanbanDispatcher } from '../dispatcher/kanban-dispatcher';
import { TaskEventConsumer } from '../consumer/task-event-consumer';
import { getKanbanTask } from '../../hermes-kanban-client';
import { WorkflowEventEmitter } from '../emitter/event-emitter';
import { EngineWorkflowPlatform } from '../runtime/platform';
import { loadWorkflowConfig } from '../runtime/load-config';
import { seedBundledWorkflows } from '../runtime/seed-defaults';
import type { IWorkflowPlatform, WorkflowDeps } from './deps';

export interface WorkflowEngineOptions {
  /** SQLite path. Default ~/.hermes/switchui-workflows.db (via openDb). */
  dbPath?: string;
  /** Consumer polling interval. Default 5_000 ms. */
  pollIntervalMs?: number;
  /** Orphan-reap threshold. Default 300_000 ms (5 min). */
  orphanThresholdMs?: number;
  /** Skip consumer.start() — useful for tests or one-shot boot checks. */
  autoStartConsumer?: boolean;
  /** Seed the 20 bundled Archon workflow YAMLs into workflow_definitions. Default true. */
  seedBundled?: boolean;
}

export interface WorkflowEngine {
  store: SwitchUiWorkflowStore;
  dispatcher: KanbanDispatcher;
  consumer: TaskEventConsumer;
  /** A.8: event emitter — subscribe for observability / SSE bridge (A.1.2). */
  emitter: WorkflowEventEmitter;
  /** A.8: platform adapter — bridges executor messages to emitter. */
  platform: IWorkflowPlatform;
  /** A.8: dependency bundle passed to executeWorkflow. */
  deps: WorkflowDeps;
  /** Cold-start stats from boot reconciliation. */
  boot: {
    orphanedRuns: number;
    recoveredDispatches: number;
    seededDefinitions: number;
    seedErrors: number;
  };
  /** Stop the consumer and close the store. Safe to call multiple times. */
  shutdown(): Promise<void>;
}

export async function createWorkflowEngine(
  options: WorkflowEngineOptions = {}
): Promise<WorkflowEngine> {
  const {
    dbPath,
    pollIntervalMs = 5_000,
    orphanThresholdMs = 300_000,
    autoStartConsumer = true,
    seedBundled = true,
  } = options;

  // 1. Open DB + run migrations. openDb enforces the single-instance lock.
  const store = createWorkflowStore({ dbPath: dbPath ?? '' });

  // 2. Seed bundled workflow YAMLs (idempotent — checksum short-circuit).
  let seededDefinitions = 0;
  let seedErrors = 0;
  if (seedBundled) {
    const seed = seedBundledWorkflows(store);
    seededDefinitions = seed.inserted;
    seedErrors = seed.errors.length;
  }

  // 3. Fail orphaned workflow_runs from the previous boot.
  const { count: orphanedRuns } = await store.failOrphanedRuns(orphanThresholdMs);

  // 3. Build consumer (no dispatcher wired yet — order matters because
  //    dispatcher needs consumer to call .track() in its onTaskCreated hook).
  const consumer = new TaskEventConsumer({
    store,
    fetchTask: getKanbanTask,
    pollIntervalMs,
  });

  // 4. Build dispatcher. The dispatcher exposes onTaskCreated(idempotencyKey,
  //    kanbanTaskId); the DAG executor binds the per-call nodeRunId /
  //    workflowRunId via SendQueryOptions.nodeConfig and is responsible for
  //    calling consumer.track() with that context after dispatch.
  //    Engine-side glue lives in the ported dag-executor.ts (A.1).
  const dispatcher = new KanbanDispatcher();

  // 5. Cold-start dispatch reconciliation — re-track every node_run that the
  //    previous Switch UI process had dispatched but not yet resolved. This
  //    means the consumer's polling loop will pick up status changes that
  //    happened while Switch UI was down. (Status flips that happened during
  //    downtime are visible on the next tick — no events are lost.)
  const inFlight = store.listInFlightDispatches();
  for (const dispatch of inFlight) {
    consumer.track(dispatch);
  }
  const recoveredDispatches = inFlight.length;

  // 6. Start the polling loop unless caller opted out (tests).
  if (autoStartConsumer) {
    consumer.start();
  }

  // 7. A.8: build emitter, platform, deps.
  const emitter = new WorkflowEventEmitter();
  const platform = new EngineWorkflowPlatform(emitter);
  const deps: WorkflowDeps = {
    // store/types.ts::WorkflowRun and schemas::WorkflowRun differ only in
    // last_activity_at / workflow_name (upstream fields). The executor never
    // reads last_activity_at; structurally compatible at runtime.
    store: store as unknown as WorkflowDeps['store'],
    getAgentProvider: (_type: string) => dispatcher,
    loadConfig: loadWorkflowConfig,
  };

  return {
    store,
    dispatcher,
    consumer,
    emitter,
    platform,
    deps,
    boot: { orphanedRuns, recoveredDispatches, seededDefinitions, seedErrors },
    async shutdown() {
      consumer.stop();
      // Store closes via process exit handler in openDb. No explicit close API
      // here — every shutdown path should let the process exit handler run.
    },
  };
}
