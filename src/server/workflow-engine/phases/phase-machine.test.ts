import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { SwitchUiWorkflowStore } from '../store/workflow-store.js';
import { InvalidPhaseTransitionError, VALID_TRANSITIONS } from './phase-machine.js';

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
  ).run(id, id, 'bundled', 'yaml: true', 'abc', now, now);
}

describe('recordPhaseTransition (phase-machine)', () => {
  let db: Database.Database;
  let store: SwitchUiWorkflowStore;

  beforeEach(() => {
    db = makeDb();
    store = new SwitchUiWorkflowStore(db);
    seedDefinition(db);
  });

  async function createRun(workflowId = 'wf-1') {
    return store.createWorkflowRun({
      workflow_name: workflowId,
      conversation_id: 'conv-1',
      user_message: 'test',
    });
  }

  // 1. valid path: plan → route → execute
  it('allows plan → route → execute transitions', async () => {
    const run = await createRun();
    expect(run.current_phase).toBe('plan');

    const t1 = await store.recordPhaseTransition({
      runId: run.id,
      toPhase: 'route',
      decidedBy: 'system',
    });
    expect(t1).toEqual({ from: 'plan', to: 'route' });

    const t2 = await store.recordPhaseTransition({
      runId: run.id,
      toPhase: 'execute',
      decidedBy: 'engine',
    });
    expect(t2).toEqual({ from: 'route', to: 'execute' });

    const updated = await store.getWorkflowRun(run.id);
    expect(updated!.current_phase).toBe('execute');
  });

  // 2. plan → report is invalid (not in VALID_TRANSITIONS['plan'])
  it('throws InvalidPhaseTransitionError for plan → report', async () => {
    const run = await createRun();
    await expect(
      store.recordPhaseTransition({ runId: run.id, toPhase: 'report', decidedBy: 'user' })
    ).rejects.toBeInstanceOf(InvalidPhaseTransitionError);
  });

  // 3. review → execute is valid (loop back)
  it('allows review → execute loop', async () => {
    const run = await createRun();
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'execute', decidedBy: 'engine' });
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'review', decidedBy: 'user' });
    const t = await store.recordPhaseTransition({ runId: run.id, toPhase: 'execute', decidedBy: 'engine' });
    expect(t).toEqual({ from: 'review', to: 'execute' });
  });

  // 4. report → * is invalid (terminal)
  it('throws when advancing past terminal report phase', async () => {
    const run = await createRun();
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'execute', decidedBy: 'engine' });
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'report', decidedBy: 'engine' });
    await expect(
      store.recordPhaseTransition({ runId: run.id, toPhase: 'execute', decidedBy: 'user' })
    ).rejects.toBeInstanceOf(InvalidPhaseTransitionError);
    // Verify VALID_TRANSITIONS['report'] is empty
    expect(VALID_TRANSITIONS.report).toHaveLength(0);
  });

  // 5. idempotent same-phase advance returns { from: x, to: x } without writing
  it('idempotent same-phase advance returns same phase without inserting row', async () => {
    const run = await createRun();
    const t = await store.recordPhaseTransition({
      runId: run.id,
      toPhase: 'plan',
      decidedBy: 'system',
    });
    expect(t).toEqual({ from: 'plan', to: 'plan' });

    const transitions = store.listPhaseTransitions(run.id);
    expect(transitions).toHaveLength(0); // no row written
  });

  // 6. phase_transitions row inserted on every advance
  it('inserts phase_transitions row on each advance', async () => {
    const run = await createRun();
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'route', decidedBy: 'system', decisionData: { foo: 1 } });
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'execute', decidedBy: 'engine' });

    const transitions = store.listPhaseTransitions(run.id);
    expect(transitions).toHaveLength(2);
    expect(transitions[0].from_phase).toBe('plan');
    expect(transitions[0].to_phase).toBe('route');
    expect(transitions[0].decided_by).toBe('system');
    expect(transitions[0].decision_data).toEqual({ foo: 1 });
    expect(transitions[1].from_phase).toBe('route');
    expect(transitions[1].to_phase).toBe('execute');
  });

  // 7. current_phase updated atomically with the insert
  it('updates current_phase atomically with phase_transitions insert', async () => {
    const run = await createRun();
    await store.recordPhaseTransition({ runId: run.id, toPhase: 'route', decidedBy: 'system' });

    const row = db
      .prepare('SELECT current_phase FROM workflow_runs WHERE id=?')
      .get(run.id) as { current_phase: string };
    expect(row.current_phase).toBe('route');

    const transitions = store.listPhaseTransitions(run.id);
    expect(transitions).toHaveLength(1);
  });
});
