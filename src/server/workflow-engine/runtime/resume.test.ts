/**
 * A.5 resume semantics — integration test.
 *
 * Exercises the pause/resume cycle end-to-end using an in-memory store and
 * a mocked executeWorkflow. No HTTP route is called — the route's logic is
 * light validation + the same store helpers exercised here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { SwitchUiWorkflowStore } from '../store/workflow-store.js';
import { WorkflowEventEmitter } from '../emitter/event-emitter.js';
import { EngineWorkflowPlatform } from './platform.js';
import { loadWorkflowConfig } from './load-config.js';
import { launchWorkflowRun } from './runner.js';
import type { WorkflowEngine } from '../wiring/engine.js';

// ---------------------------------------------------------------------------
// Mock executeWorkflow
// ---------------------------------------------------------------------------
vi.mock('../core/executor.js', () => ({
  executeWorkflow: vi.fn(),
}));
import { executeWorkflow } from '../core/executor.js';
const mockExecuteWorkflow = vi.mocked(executeWorkflow);

// ---------------------------------------------------------------------------
// Minimal valid workflow YAML
// ---------------------------------------------------------------------------
const VALID_YAML = `
name: test-workflow
description: test
nodes:
  - id: step1
    type: prompt
    prompt: "hello"
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function seedDefinition(db: Database.Database, id = 'wf-1'): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO workflow_definitions
       (id, name, source, yaml, checksum, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, id, 'bundled', VALID_YAML, 'abc', now, now);
}

function makeEngine(store: SwitchUiWorkflowStore): WorkflowEngine {
  const emitter = new WorkflowEventEmitter();
  const platform = new EngineWorkflowPlatform(emitter);
  const deps = {
    store: store as unknown as WorkflowEngine['deps']['store'],
    getAgentProvider: () => ({}) as WorkflowEngine['deps']['getAgentProvider'] extends (t: string) => infer R ? R : never,
    loadConfig: loadWorkflowConfig,
  };
  return {
    store,
    dispatcher: {} as WorkflowEngine['dispatcher'],
    consumer: {} as WorkflowEngine['consumer'],
    emitter,
    platform,
    deps,
    projector: { stop: () => {} },
    cronPoller: { start: () => {}, stop: () => {}, tick: async () => {}, size: () => 0 },
    boot: { orphanedRuns: 0, recoveredDispatches: 0, seededDefinitions: 0, seedErrors: 0, manifestWritten: 0, pausedAwaitingApproval: 0 },
    shutdown: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A.5 pause/resume cycle', () => {
  let db: Database.Database;
  let store: SwitchUiWorkflowStore;
  let engine: WorkflowEngine;

  beforeEach(() => {
    db = makeDb();
    store = new SwitchUiWorkflowStore(db);
    seedDefinition(db);
    engine = makeEngine(store);
    vi.clearAllMocks();
  });

  it('pause → store helpers → resume with resumeMode skips phase transitions', async () => {
    // 1. Create a workflow_run.
    const run = await store.createWorkflowRun({
      workflow_name: 'wf-1',
      conversation_id: 'conv-resume-1',
      user_message: 'trigger',
    });

    // 2. First launch — executeWorkflow pauses the run then suspends (never resolves),
    //    mimicking the executor yielding at an approval node. This prevents the
    //    IIFE from reaching completeWorkflowRun and overwriting status='paused'.
    mockExecuteWorkflow.mockImplementation(async () => {
      await store.pauseWorkflowRun(run.id, { nodeRunId: 'nr-1', message: 'needs approval' });
      // Suspend indefinitely — simulates the executor waiting for approval signal.
      return new Promise<never>(() => {/* never resolves */}) as never;
    });

    await launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-resume-1',
      cwd: '/tmp',
      userMessage: 'trigger',
      conversationDbId: 'conv-resume-1',
    });

    // Allow the fire-and-forget IIFE to settle.
    await new Promise((r) => setTimeout(r, 20));

    // 3. Assert run is paused.
    const pausedRun = await store.getWorkflowRun(run.id);
    expect(pausedRun!.status).toBe('paused');
    expect(pausedRun!.current_phase).toBe('execute');

    // 4. Phase transitions from the first launch: plan→route + route→execute = 2 rows.
    const transitionsAfterFirstLaunch = store.listPhaseTransitions(run.id);
    expect(transitionsAfterFirstLaunch.length).toBe(2);

    // 5. Create a node_run in 'paused' status (simulating what the projector writes).
    const nodeRun = await store.createNodeRun({
      workflow_run_id: run.id,
      dag_node_id: 'step1',
      node_type: 'approval',
      approval_message: 'Please approve this step',
    });
    await store.updateNodeRun(nodeRun.id, { status: 'paused' });

    // Verify the node_run is paused.
    const pausedNodeRun = store.findNodeRunById(nodeRun.id);
    expect(pausedNodeRun!.status).toBe('paused');
    expect(pausedNodeRun!.approval_message).toBe('Please approve this step');

    // 6. Simulate the approval route: update node_run, emit event, resume run.
    await store.updateNodeRun(nodeRun.id, {
      status: 'completed',
      approval_response: 'Looks good',
      completed_at: Date.now(),
    });
    await store.appendWorkflowEvent({
      workflow_run_id: run.id,
      node_run_id: nodeRun.id,
      event_type: 'approval_received',
      data: { decision: 'approved', response: 'Looks good' },
    });
    await store.resumeWorkflowRun(run.id);

    // Verify node_run updated correctly.
    const approvedNodeRun = store.findNodeRunById(nodeRun.id);
    expect(approvedNodeRun!.status).toBe('completed');
    expect(approvedNodeRun!.approval_response).toBe('Looks good');

    // 7. Second launch with resumeMode=true — no new phase transitions should be created.
    mockExecuteWorkflow.mockResolvedValue({ success: true } as unknown as Awaited<ReturnType<typeof executeWorkflow>>);

    await launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-resume-1',
      cwd: '/tmp',
      userMessage: 'trigger',
      conversationDbId: 'conv-resume-1',
      resumeMode: true,
    });

    // Allow fire-and-forget to settle.
    await new Promise((r) => setTimeout(r, 20));

    // Allow the second fire-and-forget IIFE to settle (completeWorkflowRun records execute→report).
    await new Promise((r) => setTimeout(r, 20));

    // 8. Only the plan→route and route→execute transitions from the FIRST launch
    //    exist, plus the execute→report recorded by completeWorkflowRun on the
    //    second (resume) launch = 3 total. Critically, NO duplicate plan→route or
    //    route→execute rows were added by the resume (resumeMode=true skipped them).
    const transitionsAfterResume = store.listPhaseTransitions(run.id);
    expect(transitionsAfterResume.length).toBe(3);
    // Confirm no duplicate plan→route or route→execute.
    const planToRoute = transitionsAfterResume.filter((t) => t.from_phase === 'plan' && t.to_phase === 'route');
    const routeToExecute = transitionsAfterResume.filter((t) => t.from_phase === 'route' && t.to_phase === 'execute');
    expect(planToRoute.length).toBe(1);
    expect(routeToExecute.length).toBe(1);

    // 9. Assert run completed successfully (the DAG resolved immediately since
    //    mockExecuteWorkflow returned a result on the second call).
    const resumedRun = await store.getWorkflowRun(run.id);
    expect(resumedRun!.status).toBe('completed');
  });

  it('listWorkflowRuns filters by status=paused correctly', async () => {
    // Create two runs: one paused, one running.
    const runA = await store.createWorkflowRun({
      workflow_name: 'wf-1',
      conversation_id: 'conv-list-paused-a',
      user_message: 'a',
    });
    const runB = await store.createWorkflowRun({
      workflow_name: 'wf-1',
      conversation_id: 'conv-list-paused-b',
      user_message: 'b',
    });

    await store.pauseWorkflowRun(runA.id, { nodeRunId: 'nr-x', message: 'approval needed' });
    await store.updateWorkflowRun(runB.id, { status: 'running' });

    const paused = store.listWorkflowRuns({ statuses: ['paused'] });
    const ids = (paused as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(runA.id);
    expect(ids).not.toContain(runB.id);
  });
});
