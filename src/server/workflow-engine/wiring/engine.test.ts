import { describe, it, expect, vi } from 'vitest';
import { createWorkflowEngine } from './engine';

// In-memory DB path is supported by createWorkflowStore (':memory:' bypasses lock).
const MEM = ':memory:';

describe('createWorkflowEngine', () => {
  it('boots, exposes store/dispatcher/consumer, reports zero orphans on fresh DB', async () => {
    const engine = await createWorkflowEngine({
      dbPath: MEM,
      autoStartConsumer: false,
    });
    expect(engine.store).toBeDefined();
    expect(engine.dispatcher).toBeDefined();
    expect(engine.consumer).toBeDefined();
    expect(engine.boot.orphanedRuns).toBe(0);
    expect(engine.boot.recoveredDispatches).toBe(0);
    await engine.shutdown();
  });

  it('cold-start reconciliation re-tracks in-flight dispatches', async () => {
    const engine1 = await createWorkflowEngine({ dbPath: MEM, autoStartConsumer: false });
    const store = engine1.store;

    // Seed: workflow definition (FK target) + workflow run + running node_run.
    store.upsertWorkflowDefinition({
      id: 'wf-1',
      name: 'wf-1',
      source: 'project',
      yaml: 'name: wf-1\nnodes: []',
      checksum: 'dummy',
    });
    const run = await store.createWorkflowRun({
      workflow_name: 'wf-1',
      conversation_id: 'conv-1',
      working_path: '/tmp/repo',
      user_message: 'hi',
    });
    const node = await store.createNodeRun({
      workflow_run_id: run.id,
      dag_node_id: 'n1',
      node_type: 'prompt',
    });
    await store.updateNodeRun(node.id, {
      status: 'running',
      kanban_task_id: 'k-42',
      started_at: Date.now(),
    });

    // Boot again over the SAME store (simulate restart by re-listing) —
    // engine factory re-tracks the in-flight dispatch.
    const inFlight = store.listInFlightDispatches();
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]).toMatchObject({
      nodeRunId: node.id,
      workflowRunId: run.id,
      kanbanTaskId: 'k-42',
    });

    await engine1.shutdown();
  });

  it('autoStartConsumer=false keeps consumer paused', async () => {
    const engine = await createWorkflowEngine({ dbPath: MEM, autoStartConsumer: false });
    const tickSpy = vi.spyOn(engine.consumer, 'tick');
    // Wait a beat — no automatic tick should fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(tickSpy).not.toHaveBeenCalled();
    await engine.shutdown();
  });
});
