/**
 * Kanban task event consumer.
 *
 * Bridges Hermes Kanban task lifecycle → engine node_runs.
 * The dispatcher (A.3) creates a Kanban task and returns immediately. This
 * consumer watches dispatched tasks and resolves the corresponding node_run
 * when the task reaches a terminal state.
 *
 * v1 strategy: per-task polling via getKanbanTask(taskId). The gateway has no
 * bulk task_events stream client yet; A.4 / A.11 may switch to true SSE later.
 *
 * Status mapping (canonical — shared with the inline dispatcher via
 * dispatcher/kanban-status.ts):
 *   done       → completed
 *   blocked    → failed
 *   archived   → cancelled
 *   running / ready / todo / triage → no change (still in flight)
 */
import { kanbanStatusToNodeRunStatus } from "../dispatcher/kanban-status";
import type { TerminalNodeStatus as CanonicalTerminalNodeStatus } from "../dispatcher/kanban-status";
import type { SwitchUiWorkflowStore } from "../store/workflow-store";
import type { HermesKanbanStatus, HermesKanbanTaskDetail } from "../../../lib/hermes-kanban-types";

export type TaskFetcher = (taskId: string) => Promise<HermesKanbanTaskDetail>;

export interface TaskEventConsumerOptions {
  store: SwitchUiWorkflowStore;
  fetchTask: TaskFetcher;
  /** Polling interval ms. Default 5_000. */
  pollIntervalMs?: number;
  /** Optional callback per resolved node_run. Useful for SSE bridge wiring. */
  onResolved?: (nodeRunId: string, terminalStatus: TerminalNodeStatus) => void;
}

export type TerminalNodeStatus = CanonicalTerminalNodeStatus;

interface TrackedDispatch {
  kanbanTaskId: string;
  nodeRunId: string;
  workflowRunId: string;
  startedAt: number;
}

/**
 * Maintains an in-memory map of dispatched Kanban tasks and polls each one
 * until it reaches a terminal status. The dispatcher (A.3) calls track() on
 * every successful dispatch.
 */
export class TaskEventConsumer {
  private readonly tracked = new Map<string, TrackedDispatch>(); // kanbanTaskId → dispatch
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private readonly opts: TaskEventConsumerOptions) {}

  /** Register a Kanban task to watch. Called by the dispatcher on every dispatch. */
  track(input: { kanbanTaskId: string; nodeRunId: string; workflowRunId: string }): void {
    this.tracked.set(input.kanbanTaskId, { ...input, startedAt: Date.now() });
  }

  /** Stop tracking a task without resolving it (e.g., manual abort). */
  untrack(kanbanTaskId: string): void {
    this.tracked.delete(kanbanTaskId);
  }

  /** Currently-tracked task count — for ops/metrics. */
  size(): number {
    return this.tracked.size;
  }

  /** Start the polling loop. Idempotent. */
  start(): void {
    if (this.timer) return;
    const interval = this.opts.pollIntervalMs ?? 5_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  /** Stop the polling loop. Does not clear the tracked map. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One poll pass. Iterates tracked tasks, fetches each, applies terminal
   * mapping, updates the store, fires onResolved, and removes from the map.
   * Exposed for tests so they can drive the loop deterministically.
   */
  async tick(): Promise<void> {
    if (this.polling) return; // re-entrancy guard
    this.polling = true;
    try {
      const entries = Array.from(this.tracked.values());
      for (const entry of entries) {
        try {
          const detail = await this.opts.fetchTask(entry.kanbanTaskId);
          const terminal = mapTerminalStatus(detail.task.status);
          if (terminal) {
            await this.resolve(entry, terminal, detail);
          }
        } catch (err) {
          // Fetch failure is transient — leave entry in map, retry next tick.
          // Persistent failures will be reaped by the orphan sweep (A.11).
          // Log via console only; no engine event emitted to avoid SSE noise.
          console.warn(`[task-event-consumer] poll failed for ${entry.kanbanTaskId}:`, err);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async resolve(
    entry: TrackedDispatch,
    terminal: TerminalNodeStatus,
    detail: HermesKanbanTaskDetail,
  ): Promise<void> {
    // Codex Bundle 2 Q2 idempotency guard: if the projector (or a prior
    // resumed dispatcher invocation) already marked this node_run terminal,
    // skip the write. Otherwise the cold-start consumer would clobber a
    // fresh result with stale summary text.
    //
    // SwitchUiWorkflowStore exposes findNodeRun via dag_node_id lookup; we
    // only have nodeRunId here so use the raw row fetch path via
    // listNodeRuns (cheap — one workflow's node_runs is a small set).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const peer = this.opts.store.findNodeRunById?.(entry.nodeRunId);
    if (peer && (peer.status === "completed" || peer.status === "failed" || peer.status === "cancelled")) {
      // Already resolved by the live dispatcher / projector. Drop tracking,
      // do not double-write.
      this.tracked.delete(entry.kanbanTaskId);
      return;
    }

    // Keep the orphan reaper from sweeping this run while children resolve.
    await this.opts.store.heartbeatWorkflowRun(entry.workflowRunId);
    await this.opts.store.updateNodeRun(entry.nodeRunId, {
      status: terminal,
      completed_at: Date.now(),
      summary: extractSummary(detail),
    });
    await this.opts.store.appendWorkflowEvent({
      id: crypto.randomUUID(),
      workflow_run_id: entry.workflowRunId,
      node_run_id: entry.nodeRunId,
      event_type: terminal === "completed" ? "node_completed" : "node_failed",
      data: { kanbanTaskId: entry.kanbanTaskId, kanbanStatus: detail.task.status },
      created_at: Date.now(),
    });
    this.tracked.delete(entry.kanbanTaskId);
    this.opts.onResolved?.(entry.nodeRunId, terminal);
  }
}

/**
 * @deprecated Use kanbanStatusToNodeRunStatus from ../dispatcher/kanban-status.
 * Kept as a re-export so existing callers / tests resolve to the canonical
 * mapping (now blocked→failed, not blocked→paused).
 */
export function mapTerminalStatus(status: HermesKanbanStatus): TerminalNodeStatus | null {
  return kanbanStatusToNodeRunStatus(status);
}

const SUMMARY_CAP = 10_000;

function extractSummary(detail: HermesKanbanTaskDetail): string {
  // Field preference: result (explicit worker output) → body (task description)
  // → "". Cap at SUMMARY_CAP chars so a runaway worker can't bloat the DB.
  const task = detail.task;
  const raw = (typeof task.result === "string" && task.result.trim().length > 0)
    ? task.result
    : (typeof task.body === "string" ? task.body : "");
  return raw.trim().slice(0, SUMMARY_CAP);
}
