/**
 * Workflow engine — module-level singleton accessor.
 *
 * Lazy-inits on first call. All API routes import getWorkflowEngine() and
 * share the same engine instance + DB connection + consumer poll loop.
 *
 * Idempotent: repeated calls return the same instance. shutdownWorkflowEngine
 * is exposed for graceful shutdown (tests, server stop signal).
 */
import { createWorkflowEngine, type WorkflowEngine, type WorkflowEngineOptions } from './wiring/engine';

let enginePromise: Promise<WorkflowEngine> | null = null;
let engineInstance: WorkflowEngine | null = null;

export async function getWorkflowEngine(options?: WorkflowEngineOptions): Promise<WorkflowEngine> {
  if (engineInstance) return engineInstance;
  if (!enginePromise) {
    enginePromise = createWorkflowEngine(options).then(
      (eng) => {
        engineInstance = eng;
        return eng;
      },
      (err) => {
        // Codex Bundle 4 Q6 fix: a rejected boot must clear the cached
        // promise so the next caller can retry instead of receiving the
        // same rejection forever.
        enginePromise = null;
        throw err;
      },
    );
  }
  return enginePromise;
}

export async function shutdownWorkflowEngine(): Promise<void> {
  if (engineInstance) {
    await engineInstance.shutdown();
    engineInstance = null;
    enginePromise = null;
  }
}

export type { WorkflowEngine, WorkflowEngineOptions } from './wiring/engine';
