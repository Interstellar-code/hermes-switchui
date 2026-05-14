import { describe, it, expect, vi } from 'vitest';
import { KanbanDispatcher } from './kanban-dispatcher.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDispatcher(overrides: {
  createTask?: ReturnType<typeof vi.fn>;
  onTaskCreated?: ReturnType<typeof vi.fn>;
} = {}) {
  const createTask =
    overrides.createTask ??
    vi.fn().mockResolvedValue({ task: { id: 'task-123' } });
  const onTaskCreated =
    overrides.onTaskCreated ?? undefined;

  const dispatcher = new KanbanDispatcher({ createTask, onTaskCreated });
  return { dispatcher, createTask, onTaskCreated };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('KanbanDispatcher', () => {
  it('1. getType() returns "hermes-kanban"', () => {
    const { dispatcher } = makeDispatcher();
    expect(dispatcher.getType()).toBe('hermes-kanban');
  });

  it('2. getCapabilities() returns documented shape', () => {
    const { dispatcher } = makeDispatcher();
    const caps = dispatcher.getCapabilities();
    expect(caps).toMatchObject({
      sessionResume: false,
      mcp: false,
      hooks: false,
      skills: true,
      agents: false,
      toolRestrictions: false,
      structuredOutput: false,
      envInjection: false,
      costControl: false,
      effortControl: false,
      thinkingControl: false,
      fallbackModel: false,
      sandbox: false,
    });
  });

  it('3. sendQuery yields text chunk, metadata chunk, then closes', async () => {
    const { dispatcher } = makeDispatcher();
    const gen = dispatcher.sendQuery('hello', '/tmp/repo');

    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: 'assistant',
      content: expect.stringContaining('task-123'),
    });
    const content = (first.value as { type: string; content: string }).content;
    expect(content).toMatch(/idempotency:/);

    const second = await gen.next();
    expect(second.done).toBe(false);
    expect(second.value).toMatchObject({
      type: 'result',
      structuredOutput: expect.objectContaining({
        kanbanTaskId: 'task-123',
        idempotencyKey: expect.any(String),
      }),
    });

    const third = await gen.next();
    expect(third.done).toBe(true);
  });

  it('4. onTaskCreated callback invoked with (idempotencyKey, "task-123") before first yield', async () => {
    const onTaskCreated = vi.fn().mockResolvedValue(undefined);
    const { dispatcher } = makeDispatcher({ onTaskCreated });

    const gen = dispatcher.sendQuery('hello', '/tmp/repo');
    // onTaskCreated is called before yields, so after first .next() it's done
    const first = await gen.next();
    expect(first.done).toBe(false);

    expect(onTaskCreated).toHaveBeenCalledOnce();
    const [key, id] = onTaskCreated.mock.calls[0] as [string, string];
    expect(id).toBe('task-123');
    expect(key).toMatch(/^anon-\d+$/);

    // idempotencyKey in text chunk matches what was passed to callback
    const content = (first.value as { content: string }).content;
    expect(content).toContain(key);
  });

  it('5. gateway error propagates: createKanbanTask rejects → sendQuery throws on first .next()', async () => {
    const createTask = vi.fn().mockRejectedValue(new Error('502 bad gateway'));
    const { dispatcher } = makeDispatcher({ createTask });

    const gen = dispatcher.sendQuery('hello', '/tmp/repo');
    await expect(gen.next()).rejects.toThrow('502 bad gateway');
  });

  it('6. options.nodeConfig.skills and model_hint are forwarded to gateway call body', async () => {
    const createTask = vi.fn().mockResolvedValue({ task: { id: 'task-456' } });
    const { dispatcher } = makeDispatcher({ createTask });

    const gen = dispatcher.sendQuery('do work', '/repo', undefined, {
      nodeConfig: {
        id: 'my-node',
        skills: ['python', 'pytest'],
        model_hint: 'claude-opus-4',
      },
    });
    await gen.next(); // consume first chunk

    expect(createTask).toHaveBeenCalledOnce();
    const callArg = createTask.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.skills).toEqual(['python', 'pytest']);
    expect(callArg.body).toContain('claude-opus-4');
    expect(callArg.workspace_path).toBe('/repo');
    expect(callArg.idempotency_key).toMatch(/^my-node-\d+$/);
  });
});
