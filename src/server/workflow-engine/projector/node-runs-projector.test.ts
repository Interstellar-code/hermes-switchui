/**
 * node-runs-projector tests.
 *
 * Uses an in-memory SQLite store and injects the emitter directly — no
 * createWorkflowEngine() overhead.
 */
import { describe, it, expect, beforeEach } from 'vitest';

/** Drain all pending microtasks (multiple async hops in projector). */
const flushPromises = () => new Promise((r) => setTimeout(r, 0));
import { WorkflowEventEmitter } from '../emitter/event-emitter.js';
import { createWorkflowStore } from '../store/index.js';
import { createNodeRunsProjector } from './node-runs-projector.js';

function makeStore() {
  return createWorkflowStore({ dbPath: ':memory:' });
}

// Insert a minimal workflow_run row so FK constraints pass.
async function seedRun(store: ReturnType<typeof makeStore>, runId: string) {
  // createWorkflowRun auto-generates the id; we need to use a seeded
  // workflow_definitions row so the FK resolves. Bypass via raw insert.
  const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO workflow_definitions
       (id, name, description, source, scope_path, yaml, checksum, version, created_at, updated_at)
     VALUES (?, ?, NULL, 'test', NULL, '', '', 1, ?, ?)`
  ).run('wf-test', 'wf-test', now, now);
  db.prepare(
    `INSERT OR IGNORE INTO workflow_runs
       (id, workflow_id, conversation_id, parent_conversation_id, codebase_id,
        working_path, user_message, status, current_phase, metadata,
        started_at, completed_at, last_heartbeat, error)
     VALUES (?, ?, 'conv-test', NULL, NULL, '/tmp', 'smoke', 'running', 'execute', NULL, ?, NULL, ?, NULL)`
  ).run(runId, 'wf-test', now, now);
}

describe('node-runs-projector', () => {
  let store: ReturnType<typeof makeStore>;
  let emitter: WorkflowEventEmitter;

  beforeEach(() => {
    store = makeStore();
    emitter = new WorkflowEventEmitter();
    createNodeRunsProjector({ store, emitter });
  });

  it('node_started creates a node_run row with status pending/running', async () => {
    const runId = 'run-1';
    await seedRun(store, runId);

    emitter.emit({ type: 'node_started', runId, nodeId: 'n1', nodeName: 'n1' });
    // projector listener is synchronous via EventEmitter; flush microtasks
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{ dag_node_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].dag_node_id).toBe('n1');
  });

  it('node_completed updates status to completed', async () => {
    const runId = 'run-2';
    await seedRun(store, runId);

    emitter.emit({ type: 'node_started', runId, nodeId: 'n2', nodeName: 'n2' });
    await flushPromises();
    emitter.emit({ type: 'node_completed', runId, nodeId: 'n2', nodeName: 'n2', duration: 100 });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{ status: string }>;
    expect(rows[0].status).toBe('completed');
  });

  it('node_failed updates status to failed with error', async () => {
    const runId = 'run-3';
    await seedRun(store, runId);

    emitter.emit({ type: 'node_started', runId, nodeId: 'n3', nodeName: 'n3' });
    await flushPromises();
    emitter.emit({ type: 'node_failed', runId, nodeId: 'n3', nodeName: 'n3', error: 'boom' });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{ status: string; error: string }>;
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBe('boom');
  });

  it('node_skipped creates row and marks it skipped (no prior node_started)', async () => {
    const runId = 'run-4';
    await seedRun(store, runId);

    emitter.emit({ type: 'node_skipped', runId, nodeId: 'n4', nodeName: 'n4', reason: 'when_condition' });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{ status: string; skip_reason: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('skipped');
    expect(rows[0].skip_reason).toBe('when_condition');
  });

  it('node_started duplicate is handled gracefully (no throw)', async () => {
    const runId = 'run-5';
    await seedRun(store, runId);

    emitter.emit({ type: 'node_started', runId, nodeId: 'n5', nodeName: 'n5' });
    await flushPromises();
    // Second node_started on same nodeId — should not throw
    emitter.emit({ type: 'node_started', runId, nodeId: 'n5', nodeName: 'n5' });
    await flushPromises();

    const rows = store.listNodeRuns(runId);
    expect(rows).toHaveLength(1);
  });

  it('loop_iteration_started creates row with loop_iteration', async () => {
    const runId = 'run-6';
    await seedRun(store, runId);

    emitter.emit({ type: 'loop_iteration_started', runId, nodeId: 'loop1', iteration: 0, maxIterations: 3 });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{ dag_node_id: string; loop_iteration: number | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].dag_node_id).toBe('loop1');
    expect(rows[0].loop_iteration).toBe(0);
  });

  it('loop_iteration_completed updates loop iteration row to completed', async () => {
    const runId = 'run-7';
    await seedRun(store, runId);

    emitter.emit({ type: 'loop_iteration_started', runId, nodeId: 'loop2', iteration: 1, maxIterations: 3 });
    await flushPromises();
    emitter.emit({ type: 'loop_iteration_completed', runId, nodeId: 'loop2', iteration: 1, duration: 50, completionDetected: false });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{ status: string }>;
    expect(rows[0].status).toBe('completed');
  });
});
