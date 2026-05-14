/**
 * KanbanDispatcher — IAgentProvider implementation that routes workflow node
 * execution to Hermes Kanban. The generator is short-lived: it dispatches a
 * task and closes. The event consumer (A.2.3) resolves node_runs on task
 * completion.
 */
import type { CreateKanbanTaskInput } from '../../../lib/hermes-kanban-types';
import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
} from '../stubs/providers-types';

export type CreateKanbanTaskFn = (
  input: CreateKanbanTaskInput,
) => Promise<{ task: { id: string }; warning?: string }>;

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
}

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

  constructor(opts: KanbanDispatcherOpts = {}) {
    this.onTaskCreated = opts.onTaskCreated;
    if (opts.createTask) {
      this.createTaskFn = opts.createTask;
    } else {
      // Lazy import so tests that inject createTask never pull in dashboardFetch.
      this.createTaskFn = async (input: CreateKanbanTaskInput) => {
        const { createKanbanTask } = await import('../../hermes-kanban-client.js');
        return createKanbanTask(input);
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

    // Yield dispatch confirmation text.
    yield {
      type: 'assistant',
      content: `[kanban] dispatched as task ${kanbanTaskId} (idempotency: ${idempotencyKey})`,
    } satisfies MessageChunk;

    // Yield structured dispatch metadata using the 'result' variant — closest
    // match to a structured envelope in the MessageChunk union (no 'metadata'
    // variant exists). structuredOutput carries the dispatch record.
    yield {
      type: 'result',
      structuredOutput: { kanbanTaskId, idempotencyKey, dispatchedAt: Date.now() },
    } satisfies MessageChunk;

    // Generator closes. Event consumer (A.2.3) resolves node_run on task completion.
  }
}
