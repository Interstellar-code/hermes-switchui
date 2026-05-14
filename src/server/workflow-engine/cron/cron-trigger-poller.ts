/**
 * CronTriggerPoller — A.4
 *
 * PULL-based integration between Hermes Agent cron and the Switch UI
 * workflow engine. Polls /api/cron/jobs every N ms; for each job with
 * payload.switchui_workflow_id set and last_run_at advanced beyond the
 * per-job cursor, fires engine.launchWorkflowRun.
 *
 * Zero gateway changes required. Cursor is stored as a JSON-encoded map
 * { jobId: lastRunAtIso } in gateway_event_cursor using consumer id
 * "workflow-engine.cron-triggers".
 */

import type { SwitchUiWorkflowStore } from '../store/workflow-store.js';
import { launchWorkflowRun } from '../runtime/runner.js';
import type { WorkflowEngine } from '../wiring/engine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  name?: string;
  enabled?: boolean;
  payload?: {
    switchui_workflow_id?: string;
    switchui_input?: Record<string, unknown>;
  } | null;
  last_run_at?: string | null;
  last_status?: string | null;
}

export interface CronTriggerPollerOpts {
  store: SwitchUiWorkflowStore;
  /** Minimal engine shape required — only launchWorkflowRun is called. */
  engine: Pick<WorkflowEngine, 'store' | 'deps' | 'platform'>;
  /** Returns current cron job list from the gateway. */
  fetchJobs: () => Promise<CronJob[]>;
  /** Poll interval in ms. Default 60_000. */
  pollIntervalMs?: number;
  /** Consumer id for cursor storage. Default "workflow-engine.cron-triggers". */
  consumerId?: string;
}

export interface CronTriggerPoller {
  start(): void;
  stop(): void;
  /** Runs one poll cycle deterministically (for tests). */
  tick(): Promise<void>;
  /** Returns count of tracked jobs from last tick. */
  size(): number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_CONSUMER_ID = 'workflow-engine.cron-triggers';
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export function createCronTriggerPoller(opts: CronTriggerPollerOpts): CronTriggerPoller {
  const {
    store,
    engine,
    fetchJobs,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    consumerId = DEFAULT_CONSUMER_ID,
  } = opts;

  // In-memory cursor map: { [jobId]: lastRunAtIso }
  // Lazily hydrated from store on first tick.
  let cursorMap: Record<string, string> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let trackedJobCount = 0;

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  function hydrateCursor(): Record<string, string> {
    if (cursorMap !== null) return cursorMap;
    const raw = store.getCursor(consumerId);
    if (raw) {
      try {
        cursorMap = JSON.parse(raw) as Record<string, string>;
      } catch {
        cursorMap = {};
      }
    } else {
      cursorMap = {};
    }
    return cursorMap;
  }

  function persistCursor(map: Record<string, string>): void {
    store.setCursor(consumerId, JSON.stringify(map));
  }

  async function processJob(job: CronJob, cursor: Record<string, string>): Promise<void> {
    const workflowId = job.payload?.switchui_workflow_id;
    if (!workflowId) return;
    if (!job.enabled) return;
    if (!job.last_run_at) return;
    if (job.last_status === 'error') return;
    if (cursor[job.id] === job.last_run_at) return;

    // Resolve workflow definition
    const def = store.getWorkflowDefinition(workflowId);
    if (!def) {
      console.warn(
        `[cron-trigger-poller] workflow definition not found: ${workflowId} (job ${job.id} — ${job.name ?? 'unnamed'})`
      );
      // Still advance cursor to avoid repeated warnings on every tick
      cursor[job.id] = job.last_run_at;
      return;
    }

    const input = job.payload?.switchui_input ?? null;
    const conversationId = `cron-${job.id}-${Date.now()}`;

    // Create run row
    let run: Awaited<ReturnType<SwitchUiWorkflowStore['createWorkflowRun']>>;
    try {
      run = await store.createWorkflowRun({
        workflow_name: workflowId,
        conversation_id: conversationId,
        user_message: 'cron trigger',
        metadata: { trigger: 'cron', jobId: job.id, input },
      });
    } catch (err) {
      console.error(
        `[cron-trigger-poller] failed to create workflow run for job ${job.id}:`,
        err
      );
      // Advance cursor anyway to prevent infinite retry loop
      cursor[job.id] = job.last_run_at;
      return;
    }

    // Launch workflow (fire-and-forget; errors logged, cursor still advances)
    try {
      await launchWorkflowRun(engine as WorkflowEngine, {
        runId: run.id,
        workflowYaml: def.yaml,
        workflowId,
        conversationId: run.conversation_id,
        cwd: '/tmp',
        userMessage: 'cron trigger',
        conversationDbId: run.conversation_id,
      });
    } catch (err) {
      console.error(
        `[cron-trigger-poller] launchWorkflowRun failed for job ${job.id} / run ${run.id}:`,
        err
      );
    }

    cursor[job.id] = job.last_run_at;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async function tick(): Promise<void> {
    const cursor = hydrateCursor();

    let jobs: CronJob[];
    try {
      jobs = await fetchJobs();
    } catch (err) {
      console.error('[cron-trigger-poller] fetchJobs failed (skipping tick):', err);
      return;
    }

    // Only consider jobs that have the switchui_workflow_id marker and are enabled
    const relevant = jobs.filter(
      (j) => j.enabled !== false && j.payload?.switchui_workflow_id
    );
    trackedJobCount = relevant.length;

    for (const job of relevant) {
      await processJob(job, cursor);
    }

    persistCursor(cursor);
  }

  return {
    start() {
      if (timer !== null) return;
      // First tick runs after one interval (not immediately) to avoid
      // hammering the gateway at cold-start alongside other probes.
      timer = setInterval(() => {
        tick().catch((err) =>
          console.error('[cron-trigger-poller] unhandled error in tick:', err)
        );
      }, pollIntervalMs);
    },

    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },

    tick,

    size() {
      return trackedJobCount;
    },
  };
}
