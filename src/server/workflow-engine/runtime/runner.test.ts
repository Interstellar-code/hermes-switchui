import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { SwitchUiWorkflowStore } from '../store/workflow-store.js';
import { WorkflowEventEmitter } from '../emitter/event-emitter.js';
import { EngineWorkflowPlatform } from './platform.js';
import { loadWorkflowConfig } from './load-config.js';
import { launchWorkflowRun } from './runner.js';
import type { WorkflowEngine } from '../wiring/engine.js';

// ---------------------------------------------------------------------------
// Minimal YAML for a workflow the executor won't try to actually run
// Uses nodes: (DAG) format — steps: format is rejected by the validator.
// ---------------------------------------------------------------------------
const VALID_YAML = `
name: test-workflow
description: test
nodes:
  - id: step1
    type: prompt
    prompt: "hello"
`;

const INVALID_YAML = `notanobject`;

// ---------------------------------------------------------------------------
// Mock executeWorkflow so tests don't hit the real DAG
// ---------------------------------------------------------------------------
vi.mock('../core/executor.js', () => ({
  executeWorkflow: vi.fn(),
}));

import { executeWorkflow } from '../core/executor.js';
const mockExecuteWorkflow = executeWorkflow as unknown as MockInstance;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
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
    boot: { orphanedRuns: 0, recoveredDispatches: 0 },
    shutdown: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('launchWorkflowRun', () => {
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

  async function createRun() {
    return store.createWorkflowRun({
      workflow_name: 'wf-1',
      conversation_id: 'conv-1',
      user_message: 'go',
    });
  }

  // 1. plan → route + route → execute transitions recorded before DAG kickoff
  it('records plan→route and route→execute before returning', async () => {
    mockExecuteWorkflow.mockResolvedValue({ success: true });
    const run = await createRun();

    await launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-1',
      cwd: '/tmp',
      userMessage: 'go',
      conversationDbId: 'conv-1',
    });

    const transitions = store.listPhaseTransitions(run.id);
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    expect(transitions[0].from_phase).toBe('plan');
    expect(transitions[0].to_phase).toBe('route');
    expect(transitions[1].from_phase).toBe('route');
    expect(transitions[1].to_phase).toBe('execute');
  });

  // 2. updateWorkflowRun(status='running') called before DAG kickoff
  it('marks run as running before returning', async () => {
    mockExecuteWorkflow.mockResolvedValue({ success: true });
    const run = await createRun();

    await launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-1',
      cwd: '/tmp',
      userMessage: 'go',
      conversationDbId: 'conv-1',
    });

    const updated = await store.getWorkflowRun(run.id);
    expect(updated!.status).toBe('running');
  });

  // 3. DAG kickoff doesn't block — runner returns before executeWorkflow resolves
  it('returns before executeWorkflow resolves (fire-and-forget)', async () => {
    let resolveExec!: (v: unknown) => void;
    mockExecuteWorkflow.mockReturnValue(new Promise((res) => { resolveExec = res; }));
    const run = await createRun();

    const launchPromise = launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-1',
      cwd: '/tmp',
      userMessage: 'go',
      conversationDbId: 'conv-1',
    });

    // launchWorkflowRun should resolve even though executeWorkflow is still pending
    await expect(launchPromise).resolves.toBeUndefined();

    // Let the background task finish cleanly
    resolveExec({ success: true });
    await new Promise((r) => setTimeout(r, 10));
  });

  // 4. On DAG success: recordPhaseTransition(execute→report) + completeWorkflowRun
  it('on DAG success records execute→report and completes the run', async () => {
    mockExecuteWorkflow.mockResolvedValue({ done: true });
    const run = await createRun();

    await launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-1',
      cwd: '/tmp',
      userMessage: 'go',
      conversationDbId: 'conv-1',
    });

    // Wait for the async IIFE to complete
    await new Promise((r) => setTimeout(r, 20));

    const transitions = store.listPhaseTransitions(run.id);
    const lastT = transitions[transitions.length - 1];
    expect(lastT.from_phase).toBe('execute');
    expect(lastT.to_phase).toBe('report');

    const finalRun = await store.getWorkflowRun(run.id);
    expect(finalRun!.status).toBe('completed');
  });

  // 5. On DAG failure: failWorkflowRun called (no report transition)
  it('on DAG failure calls failWorkflowRun without report transition', async () => {
    mockExecuteWorkflow.mockRejectedValue(new Error('boom'));
    const run = await createRun();

    await launchWorkflowRun(engine, {
      runId: run.id,
      workflowYaml: VALID_YAML,
      workflowId: 'wf-1',
      conversationId: 'conv-1',
      cwd: '/tmp',
      userMessage: 'go',
      conversationDbId: 'conv-1',
    });

    await new Promise((r) => setTimeout(r, 20));

    const transitions = store.listPhaseTransitions(run.id);
    const phases = transitions.map((t) => t.to_phase);
    expect(phases).not.toContain('report');

    const finalRun = await store.getWorkflowRun(run.id);
    expect(finalRun!.status).toBe('failed');
    expect(finalRun!.error).toContain('boom');
  });
});
