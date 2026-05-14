import { describe, it, expect, vi } from 'vitest';
import { KanbanDispatcher, type FetchKanbanTaskFn } from './kanban-dispatcher.js';
import type { HermesKanbanStatus, HermesKanbanTaskDetail } from '../../../lib/hermes-kanban-types';

function detail(status: HermesKanbanStatus, body = ''): HermesKanbanTaskDetail {
  return {
    task: { id: 'task-123', status, body },
    comments: [],
    events: [],
    links: { parents: [], children: [] },
    runs: [],
  } as unknown as HermesKanbanTaskDetail;
}

function makeDispatcher(overrides: {
  createTask?: ReturnType<typeof vi.fn>;
  fetchTask?: FetchKanbanTaskFn;
  onTaskCreated?: ReturnType<typeof vi.fn>;
} = {}) {
  const createTask =
    overrides.createTask ?? vi.fn().mockResolvedValue({ task: { id: 'task-123' } });
  const fetchTask =
    overrides.fetchTask ?? (vi.fn().mockResolvedValue(detail('done', 'result body')) as FetchKanbanTaskFn);
  const onTaskCreated = overrides.onTaskCreated ?? undefined;

  const dispatcher = new KanbanDispatcher({
    createTask,
    fetchTask,
    onTaskCreated,
    pollIntervalMs: 0,
  });
  return { dispatcher, createTask, fetchTask, onTaskCreated };
}

describe('KanbanDispatcher', () => {
  it('1. getType() returns "hermes-kanban"', () => {
    const { dispatcher } = makeDispatcher();
    expect(dispatcher.getType()).toBe('hermes-kanban');
  });

  it('2. getCapabilities() returns documented shape', () => {
    const { dispatcher } = makeDispatcher();
    expect(dispatcher.getCapabilities()).toMatchObject({
      sessionResume: false,
      skills: true,
      sandbox: false,
    });
  });

  it('3. sendQuery yields dispatch chunk, status chunk, result, then closes (terminal=done)', async () => {
    const { dispatcher } = makeDispatcher();
    const chunks = [] as Array<{ type: string }>;
    for await (const c of dispatcher.sendQuery('hello', '/tmp/repo')) {
      chunks.push(c as { type: string });
    }
    // assistant (dispatch) + assistant (status flip to done) + result
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ type: 'assistant' });
    expect(chunks[1]).toMatchObject({ type: 'assistant' });
    expect(chunks[2]).toMatchObject({
      type: 'result',
      structuredOutput: expect.objectContaining({
        kanbanTaskId: 'task-123',
        kanbanStatus: 'done',
        succeeded: true,
        summary: 'result body',
      }),
    });
  });

  it('4. onTaskCreated invoked with (idempotencyKey, "task-123") before first yield', async () => {
    const onTaskCreated = vi.fn().mockResolvedValue(undefined);
    const { dispatcher } = makeDispatcher({ onTaskCreated });
    const gen = dispatcher.sendQuery('hello', '/tmp/repo');
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(onTaskCreated).toHaveBeenCalledOnce();
    const [key, id] = onTaskCreated.mock.calls[0] as [string, string];
    expect(id).toBe('task-123');
    expect(key).toMatch(/^anon-\d+$/);
    // Drain to allow generator cleanup
    await gen.return(undefined);
  });

  it('5. gateway error on dispatch: throws on first .next()', async () => {
    const createTask = vi.fn().mockRejectedValue(new Error('502 bad gateway'));
    const { dispatcher } = makeDispatcher({ createTask });
    const gen = dispatcher.sendQuery('hello', '/tmp/repo');
    await expect(gen.next()).rejects.toThrow('502 bad gateway');
  });

  it('6. nodeConfig.skills + model_hint forwarded to gateway body', async () => {
    const createTask = vi.fn().mockResolvedValue({ task: { id: 'task-456' } });
    const fetchTask = vi.fn().mockResolvedValue(detail('done')) as FetchKanbanTaskFn;
    const { dispatcher } = makeDispatcher({ createTask, fetchTask });
    const gen = dispatcher.sendQuery('do work', '/repo', undefined, {
      nodeConfig: {
        id: 'my-node',
        skills: ['python', 'pytest'],
        model_hint: 'claude-opus-4',
      },
    });
    await gen.next();
    expect(createTask).toHaveBeenCalledOnce();
    const arg = createTask.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.skills).toEqual(['python', 'pytest']);
    expect(arg.body).toContain('claude-opus-4');
    expect(arg.workspace_path).toBe('/repo');
    expect(arg.idempotency_key).toMatch(/^my-node-\d+$/);
    await gen.return(undefined);
  });

  it('7. terminal=blocked → throws on generator close', async () => {
    const fetchTask = vi.fn().mockResolvedValue(detail('blocked')) as FetchKanbanTaskFn;
    const { dispatcher } = makeDispatcher({ fetchTask });
    const consume = async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of dispatcher.sendQuery('x', '/repo')) {
        /* drain */
      }
    };
    await expect(consume()).rejects.toThrow(/non-success status: blocked/);
  });

  it('8. polls multiple times until terminal status seen', async () => {
    const statuses: HermesKanbanStatus[] = ['ready', 'running', 'running', 'done'];
    let i = 0;
    const fetchTask = vi.fn().mockImplementation(async () => detail(statuses[i++] ?? 'done')) as FetchKanbanTaskFn;
    const { dispatcher } = makeDispatcher({ fetchTask });
    const chunks: unknown[] = [];
    for await (const c of dispatcher.sendQuery('hi', '/r')) chunks.push(c);
    expect(fetchTask).toHaveBeenCalledTimes(4);
    // dispatch + 3 status flips (ready, running, done) + result
    expect(chunks).toHaveLength(5);
  });
});
