/**
 * KanbanDispatcher — IAgentProvider implementation that routes workflow node
 * execution to Hermes Kanban. The generator is short-lived: it dispatches a
 * task and closes. The event consumer (A.2.3) resolves node_runs on task
 * completion.
 */
import type {
  CreateKanbanTaskInput,
  HermesKanbanStatus,
  HermesKanbanTaskDetail,
} from '../../../lib/hermes-kanban-types';
import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
} from '../stubs/providers-types';

export type CreateKanbanTaskFn = (
  input: CreateKanbanTaskInput,
) => Promise<{ task: { id: string }; warning?: string }>;

export type FetchKanbanTaskFn = (taskId: string) => Promise<HermesKanbanTaskDetail>;

export interface KanbanDispatcherOpts {
  /**
   * Called with (idempotencyKey, kanbanTaskId) after the task is created.
   * Engine store uses this to write node_runs.kanban_task_id atomically.
   */
  onTaskCreated?: (idempotencyKey: string, kanbanTaskId: string) => Promise<void>;
  /**
   * Injected gateway client. Defaults to the real createKanbanTask from
   * hermes-kanban-client. Injected in tests without vi.mock.
   */
  createTask?: CreateKanbanTaskFn;
  /**
   * Injected polling client. Defaults to the real getKanbanTask. Used after
   * dispatch to await terminal status before yielding the final result chunk.
   */
  fetchTask?: FetchKanbanTaskFn;
  /** Poll interval ms. Default 3_000. */
  pollIntervalMs?: number;
}

const TERMINAL_KANBAN_STATUSES = new Set<HermesKanbanStatus>(['done', 'blocked', 'archived']);

const KANBAN_CAPABILITIES: ProviderCapabilities = {
  sessionResume: false,
  mcp: false,
  hooks: false,
  skills: true,   // workers pick up skills/labels from the task
  agents: false,
  toolRestrictions: false,
  structuredOutput: false,
  envInjection: false,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
};

export class KanbanDispatcher implements IAgentProvider {
  private readonly onTaskCreated?: (key: string, id: string) => Promise<void>;
  private readonly createTaskFn: CreateKanbanTaskFn;
  private readonly fetchTaskFn: FetchKanbanTaskFn;
  private readonly pollIntervalMs: number;

  constructor(opts: KanbanDispatcherOpts = {}) {
    this.onTaskCreated = opts.onTaskCreated;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
    if (opts.createTask) {
      this.createTaskFn = opts.createTask;
    } else {
      this.createTaskFn = async (input: CreateKanbanTaskInput) => {
        const { createKanbanTask } = await import('../../hermes-kanban-client.js');
        return createKanbanTask(input);
      };
    }
    if (opts.fetchTask) {
      this.fetchTaskFn = opts.fetchTask;
    } else {
      this.fetchTaskFn = async (taskId: string) => {
        const { getKanbanTask } = await import('../../hermes-kanban-client.js');
        return getKanbanTask(taskId);
      };
    }
  }

  getType(): string {
    return 'hermes-kanban';
  }

  getCapabilities(): ProviderCapabilities {
    return KANBAN_CAPABILITIES;
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    _resumeSessionId?: string,
    options?: SendQueryOptions,
  ): AsyncGenerator<MessageChunk> {
    const nodeId = options?.nodeConfig?.['id'] as string | undefined ?? 'anon';
    const idempotencyKey = `${nodeId}-${Date.now()}`;

    const nodeSkills = options?.nodeConfig?.skills;
    const modelHint = options?.nodeConfig?.['model_hint'] as string | undefined;

    // Build task title from nodeId; use prompt as body.
    const title = nodeId !== 'anon' ? `workflow:${nodeId}` : 'workflow:dispatch';

    const input: CreateKanbanTaskInput = {
      title,
      body: modelHint ? `[model_hint:${modelHint}]\n\n${prompt}` : prompt,
      workspace_path: cwd || undefined,
      idempotency_key: idempotencyKey,
      ...(nodeSkills && nodeSkills.length > 0 ? { skills: nodeSkills } : {}),
    };

    // Dispatch — throws on gateway error (4xx/5xx/network), DAG executor retries.
    const { task } = await this.createTaskFn(input);
    const kanbanTaskId = task.id;

    // Notify engine store before yielding so callers see the ID atomically.
    if (this.onTaskCreated) {
      await this.onTaskCreated(idempotencyKey, kanbanTaskId);
    }

    // Yield dispatch confirmation so the dag-executor surfaces it as an
    // engine event without waiting for the worker to start.
    yield {
      type: 'assistant',
      content: `[kanban] dispatched as task ${kanbanTaskId} (idempotency: ${idempotencyKey})`,
    } satisfies MessageChunk;

    // Poll until the Kanban task reaches a terminal status. The dag-executor
    // iterates this generator with `for await` and treats generator-close as
    // node-complete, so blocking here is what gives node_runs the correct
    // lifecycle: pending → running (during poll) → completed/failed when
    // the Kanban worker finishes.
    let lastStatus: HermesKanbanStatus | null = null;
    let terminalDetail: HermesKanbanTaskDetail | null = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      let detail: HermesKanbanTaskDetail;
      try {
        detail = await this.fetchTaskFn(kanbanTaskId);
      } catch {
        // Transient gateway failure — keep polling. Persistent outages are
        // bounded by the dag-executor's idle-timeout wrapper around
        // sendQuery, which will tear down the generator.
        continue;
      }
      const status = detail.task.status;
      if (status !== lastStatus) {
        lastStatus = status;
        yield {
          type: 'assistant',
          content: `[kanban] task ${kanbanTaskId} → ${status}`,
        } satisfies MessageChunk;
      }
      if (TERMINAL_KANBAN_STATUSES.has(status)) {
        terminalDetail = detail;
        break;
      }
    }

    const terminalStatus = terminalDetail.task.status;
    const body = (terminalDetail.task as { body?: string }).body ?? '';

    // Final result chunk — structuredOutput carries enough for the dag-executor
    // to surface success/failure to the engine event stream.
    yield {
      type: 'result',
      structuredOutput: {
        kanbanTaskId,
        idempotencyKey,
        kanbanStatus: terminalStatus,
        succeeded: terminalStatus === 'done',
        summary: body,
      },
    } satisfies MessageChunk;

    // Hard failure: 'blocked' / 'archived' translate to thrown errors so the
    // dag-executor's retry/handling kicks in. 'done' closes cleanly.
    if (terminalStatus !== 'done') {
      throw new Error(`Kanban task ${kanbanTaskId} ended in non-success status: ${terminalStatus}`);
    }
  }
}
