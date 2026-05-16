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
import { closeDb } from '../db/client';
import type { SwitchUiWorkflowStore } from '../store/workflow-store';
import { KanbanDispatcher } from '../dispatcher/kanban-dispatcher';
import { TaskEventConsumer } from '../consumer/task-event-consumer';
import { getKanbanTask } from '../../hermes-kanban-client';
import { WorkflowEventEmitter, getWorkflowEventEmitter } from '../emitter/event-emitter';
import { EngineWorkflowPlatform } from '../runtime/platform';
import { loadWorkflowConfig } from '../runtime/load-config';
import { seedBundledWorkflows } from '../runtime/seed-defaults';
import { createNodeRunsProjector, type NodeRunsProjector } from '../projector/node-runs-projector';
import { createCronTriggerPoller, type CronTriggerPoller } from '../cron/cron-trigger-poller';
import { writeWorkflowsManifest } from '../runtime/manifest';
import { dashboardFetch } from '../../gateway-capabilities';
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
  /** Enable cron trigger poller (polls /api/cron/jobs). Default true. Tests opt out with false. */
  enableCronTriggers?: boolean;
  /** Cron poller interval in ms. Default 60_000. */
  cronPollIntervalMs?: number;
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
  /** Node-runs projector — subscribes to emitter and writes node_runs rows. */
  projector: NodeRunsProjector;
  /** A.4: cron trigger poller — polls /api/cron/jobs and fires launchWorkflowRun. */
  cronPoller: CronTriggerPoller;
  /** Cold-start stats from boot reconciliation. */
  boot: {
    orphanedRuns: number;
    recoveredDispatches: number;
    seededDefinitions: number;
    seedErrors: number;
    manifestWritten: number;
    /** A.5: runs still in 'paused' state after orphan reaping — awaiting user approval. */
    pausedAwaitingApproval: number;
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
    enableCronTriggers = true,
    cronPollIntervalMs = 60_000,
  } = options;

  // Codex Bundle 4 Q6 fix: wrap construction in try/catch so a partial boot
  // failure (after DB open) releases the file lock instead of leaving the
  // engine in a half-initialised state that bricks the process.
  return _createWorkflowEngineInner({
    dbPath, pollIntervalMs, orphanThresholdMs,
    autoStartConsumer, seedBundled,
    enableCronTriggers, cronPollIntervalMs,
  });
}

async function _createWorkflowEngineInner(opts: {
  dbPath?: string;
  pollIntervalMs: number;
  orphanThresholdMs: number;
  autoStartConsumer: boolean;
  seedBundled: boolean;
  enableCronTriggers: boolean;
  cronPollIntervalMs: number;
}): Promise<WorkflowEngine> {
  const {
    dbPath,
    pollIntervalMs,
    orphanThresholdMs,
    autoStartConsumer,
    seedBundled,
    enableCronTriggers,
    cronPollIntervalMs,
  } = opts;

  // 1. Open DB + run migrations. openDb enforces the single-instance lock.
  const store = createWorkflowStore({ dbPath: dbPath ?? '' });
  const isMemory = dbPath === ':memory:';

  try {
    return await _buildEngine(store, {
      pollIntervalMs,
      orphanThresholdMs,
      autoStartConsumer,
      seedBundled,
      enableCronTriggers,
      cronPollIntervalMs,
    });
  } catch (err) {
    // Release the lock + close the DB so the next boot attempt isn't blocked.
    // :memory: paths never registered with the singleton — skip closeDb.
    if (!isMemory) {
      try { closeDb(); } catch { /* ignore */ }
    }
    throw err;
  }
}

async function _buildEngine(
  store: SwitchUiWorkflowStore,
  opts: {
    pollIntervalMs: number;
    orphanThresholdMs: number;
    autoStartConsumer: boolean;
    seedBundled: boolean;
    enableCronTriggers: boolean;
    cronPollIntervalMs: number;
  },
): Promise<WorkflowEngine> {
  const {
    pollIntervalMs,
    orphanThresholdMs,
    autoStartConsumer,
    seedBundled,
    enableCronTriggers,
    cronPollIntervalMs,
  } = opts;

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

  // 3a. A.5: surface paused runs awaiting approval (not auto-resumed — explicit user action required).
  const pausedRows = store.listWorkflowRuns({ statuses: ['paused'], limit: 100 });
  const pausedAwaitingApproval = pausedRows.length;
  if (pausedAwaitingApproval > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[engine] ${pausedAwaitingApproval} workflow_run(s) in 'paused' state — awaiting approval`);
  }

  // 3. Build consumer (no dispatcher wired yet — order matters because
  //    dispatcher needs consumer to call .track() in its onTaskCreated hook).
  const consumer = new TaskEventConsumer({
    store,
    fetchTask: getKanbanTask,
    pollIntervalMs,
  });

  // 4. Build dispatcher with onTaskCreated hook that persists kanban_task_id
  //    and registers the task with the consumer for live polling.
  const dispatcher = new KanbanDispatcher({
    onTaskCreated: async ({ kanbanTaskId, nodeRunId, workflowRunId }) => {
      if (nodeRunId) {
        store.setNodeRunKanbanTaskId(nodeRunId, kanbanTaskId);
      }
      if (nodeRunId && workflowRunId) {
        consumer.track({ nodeRunId, kanbanTaskId, workflowRunId });
      }
    },
  });

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
  // Use the module singleton so executor.ts (which calls getWorkflowEventEmitter())
  // and the projector subscriber share the same instance.
  const emitter = getWorkflowEventEmitter();
  const platform = new EngineWorkflowPlatform(emitter);
  const deps: WorkflowDeps = {
    // store/types.ts::WorkflowRun and schemas::WorkflowRun differ only in
    // last_activity_at / workflow_name (upstream fields). The executor never
    // reads last_activity_at; structurally compatible at runtime.
    store: store as unknown as WorkflowDeps['store'],
    getAgentProvider: (_type: string) => dispatcher,
    loadConfig: loadWorkflowConfig,
  };

  // 8. Node-runs projector — projects engine events into node_runs rows.
  const projector = createNodeRunsProjector({ store, emitter });

  // 8.5 A.10: emit manifest for Hermes chat-based launch routing.
  const manifestResult = writeWorkflowsManifest({ store });
  if (manifestResult.parseErrors.length > 0) {
    console.warn(`[engine] manifest written with ${manifestResult.parseErrors.length} parse errors:`, manifestResult.parseErrors);
  }

  // 9. A.4: Cron trigger poller. fetchJobs wraps dashboardFetch so the engine
  //    boots even when the gateway is offline (returns [] on any error).
  const engineRef = {} as WorkflowEngine; // forward ref — filled below
  const cronPoller = createCronTriggerPoller({
    store,
    engine: engineRef,
    fetchJobs: async () => {
      try {
        const res = await dashboardFetch('/api/cron/jobs');
        if (!res.ok) return [];
        const data = await res.json() as unknown;
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    pollIntervalMs: cronPollIntervalMs,
  });

  if (enableCronTriggers) {
    cronPoller.start();
  }

  Object.assign(engineRef, {
    store,
    dispatcher,
    consumer,
    emitter,
    platform,
    deps,
    projector,
    cronPoller,
    boot: { orphanedRuns, recoveredDispatches, seededDefinitions, seedErrors, manifestWritten: manifestResult.entriesWritten, pausedAwaitingApproval },
    async shutdown() {
      cronPoller.stop();
      projector.stop();
      consumer.stop();
    },
  });

  return engineRef;
}
