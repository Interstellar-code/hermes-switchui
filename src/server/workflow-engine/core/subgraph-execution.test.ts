/**
 * Subgraph execution integration tests (A.7-subgraphs, Track 2).
 *
 * Exercises the full lifecycle: subgraph_started → child node_started →
 * child node_completed → subgraph_completed, against the real
 * in-memory store + emitter + projector. Verifies the parent_subgraph_node_run_id
 * linkage, cancellation cascade, when:-false skip, child-failure rollup, and
 * output aggregation behavior.
 *
 * The full `executeDagWorkflow` requires the provider stack; these tests
 * model the executor's emission sequence directly so the integration covers
 * the event contract without booting a workflow run.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { WorkflowEventEmitter } from '../emitter/event-emitter';
import { createWorkflowStore } from '../store/index';
import { createNodeRunsProjector } from '../projector/node-runs-projector';
import { aggregateSubgraphOutputs, type SubgraphOutputSpec } from './dag-executor';
import type { NodeOutput } from '../schemas';

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

type Store = ReturnType<typeof createWorkflowStore>;

function makeStore(): Store {
  return createWorkflowStore({ dbPath: ':memory:' });
}

async function seedRun(store: Store, runId: string) {
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

describe('subgraph execution integration', () => {
  let store: Store;
  let emitter: WorkflowEventEmitter;

  beforeEach(() => {
    store = makeStore();
    emitter = new WorkflowEventEmitter();
    createNodeRunsProjector({ store, emitter });
  });

  it('full subgraph run produces 1 placeholder + N children, all completed', async () => {
    const runId = 'run-full-1';
    await seedRun(store, runId);

    const placeholderId = 'placeholder-1';
    const childA = 'review.code-review';
    const childB = 'review.synthesize';

    // 1) subgraph_started — projector creates placeholder
    emitter.emit({
      type: 'subgraph_started',
      runId,
      nodeId: 'review',
      subgraphRef: 'pr-review',
      nodeRunId: placeholderId,
      childCount: 2,
    });
    await flushPromises();

    // 2) Pre-create child rows with parent linkage (executor does this before
    //    the layer loop emits its own node_started events).
    for (const childId of [childA, childB]) {
      emitter.emit({
        type: 'node_started',
        runId,
        nodeId: childId,
        nodeName: childId,
        parentSubgraphNodeRunId: placeholderId,
      });
    }
    await flushPromises();

    // 3) Children complete
    for (const childId of [childA, childB]) {
      emitter.emit({
        type: 'node_completed',
        runId,
        nodeId: childId,
        nodeName: childId,
        duration: 10,
      });
    }
    await flushPromises();

    // 4) Aggregator emits subgraph_completed with outputs
    emitter.emit({
      type: 'subgraph_completed',
      runId,
      nodeId: 'review',
      duration: 100,
      outputs: { synthesis: 'looks good' },
    });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{
      id: string;
      dag_node_id: string;
      node_type: string;
      status: string;
      parent_subgraph_node_run_id: string | null;
      summary: string | null;
    }>;

    expect(rows).toHaveLength(3);
    const placeholder = rows.find(r => r.dag_node_id === 'review')!;
    expect(placeholder.node_type).toBe('subgraph');
    expect(placeholder.status).toBe('completed');
    expect(placeholder.summary).toContain('synthesis');

    const a = rows.find(r => r.dag_node_id === childA)!;
    const b = rows.find(r => r.dag_node_id === childB)!;
    expect(a.parent_subgraph_node_run_id).toBe(placeholder.id);
    expect(b.parent_subgraph_node_run_id).toBe(placeholder.id);
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
  });

  it('child failure cascades to placeholder + cancels running siblings', async () => {
    const runId = 'run-fail-1';
    await seedRun(store, runId);
    const placeholderId = 'placeholder-fail';
    const failed = 'review.code-review';
    const sibling = 'review.synthesize';

    emitter.emit({
      type: 'subgraph_started',
      runId,
      nodeId: 'review',
      subgraphRef: 'pr-review',
      nodeRunId: placeholderId,
      childCount: 2,
    });
    await flushPromises();

    for (const id of [failed, sibling]) {
      emitter.emit({
        type: 'node_started',
        runId,
        nodeId: id,
        nodeName: id,
        parentSubgraphNodeRunId: placeholderId,
      });
    }
    await flushPromises();

    // Sibling is still running. Failed child fails.
    emitter.emit({
      type: 'node_failed',
      runId,
      nodeId: failed,
      nodeName: failed,
      error: 'boom',
    });
    await flushPromises();

    // Aggregator detects failure → emits subgraph_failed → projector cascades.
    emitter.emit({
      type: 'subgraph_failed',
      runId,
      nodeId: 'review',
      failedChildNodeId: failed,
      error: 'boom',
    });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{
      dag_node_id: string;
      status: string;
      error: string | null;
      parent_subgraph_node_run_id: string | null;
    }>;
    const placeholder = rows.find(r => r.dag_node_id === 'review')!;
    expect(placeholder.status).toBe('failed');
    expect(placeholder.error).toBe('boom');

    const siblingRow = rows.find(r => r.dag_node_id === sibling)!;
    expect(siblingRow.status).toBe('cancelled');
  });

  it('when:false on subgraph node produces a skipped placeholder + no children', async () => {
    const runId = 'run-skip-1';
    await seedRun(store, runId);

    // Skipped subgraph emits ONLY a node_skipped event (per executor contract).
    emitter.emit({
      type: 'node_skipped',
      runId,
      nodeId: 'review',
      nodeName: 'review',
      reason: 'when_condition',
    });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{
      dag_node_id: string;
      status: string;
      skip_reason: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].dag_node_id).toBe('review');
    expect(rows[0].status).toBe('skipped');
    expect(rows[0].skip_reason).toBe('when_condition');
  });

  it('cancellation cascades: workflow_cancelled marker leaves placeholder linkage intact', async () => {
    const runId = 'run-cancel-1';
    await seedRun(store, runId);
    const placeholderId = 'placeholder-cancel';
    const childA = 'phase.alpha';

    emitter.emit({
      type: 'subgraph_started',
      runId,
      nodeId: 'phase',
      subgraphRef: 'pipeline',
      nodeRunId: placeholderId,
      childCount: 1,
    });
    await flushPromises();

    emitter.emit({
      type: 'node_started',
      runId,
      nodeId: childA,
      nodeName: childA,
      parentSubgraphNodeRunId: placeholderId,
    });
    await flushPromises();

    // Workflow-level cancel: cascade via subgraph_failed path (executor's
    // aggregation step emits this when a child fails OR the run is cancelled).
    emitter.emit({
      type: 'subgraph_failed',
      runId,
      nodeId: 'phase',
      error: 'workflow cancelled',
    });
    await flushPromises();

    const rows = store.listNodeRuns(runId) as Array<{
      dag_node_id: string;
      status: string;
      parent_subgraph_node_run_id: string | null;
    }>;
    const child = rows.find(r => r.dag_node_id === childA)!;
    expect(child.parent_subgraph_node_run_id).toBe(placeholderId);
    expect(child.status).toBe('cancelled');
  });

  it('output aggregation surfaces declared outputs by name', () => {
    const outputs: SubgraphOutputSpec[] = [
      { name: 'verdict', from: 'judge.output' },
      { name: 'score',   from: 'judge.output.score' },
    ];
    const nodeOutputs = new Map<string, NodeOutput>([
      ['gate.judge', { state: 'completed', output: JSON.stringify({ score: 9, label: 'pass' }) }],
    ]);
    const agg = aggregateSubgraphOutputs(outputs, 'gate', nodeOutputs);
    expect(agg.verdict).toBeTypeOf('string');
    expect(agg.score).toBe(9);
  });
});
