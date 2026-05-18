/**
 * Node-runs projector.
 *
 * Subscribes to the global WorkflowEventEmitter and projects engine events
 * into node_runs rows so that GET /api/workflow-runs/:id can return a full
 * node timeline.
 *
 * Design:
 * - Single global subscriber registered at engine boot.
 * - All projection errors are caught + logged; never thrown (must not
 *   terminate the emitter listener).
 * - findNodeRun() lookup is used by completed/failed/skipped handlers to
 *   locate the existing row before updating it.
 */
import { createLogger } from '@archon/paths';
import type { WorkflowEventEmitter } from '../emitter/event-emitter.js';
import type { SwitchUiWorkflowStore } from '../store/workflow-store.js';
import { DuplicateNodeRunError } from '../store/types.js';

const log = createLogger('node-runs-projector');

export interface NodeRunsProjector {
  stop(): void;
}

export function createNodeRunsProjector({
  store,
  emitter,
}: {
  store: SwitchUiWorkflowStore;
  emitter: WorkflowEventEmitter;
}): NodeRunsProjector {
  const unsubscribe = emitter.subscribe(async (event) => {
    try {
      switch (event.type) {
        case 'node_started': {
          const { runId, nodeId, nodeRunId, nodeType, agentProfileHint, skills, modelHint, parentSubgraphNodeRunId } = event;
          try {
            await store.createNodeRun({
              workflow_run_id: runId,
              dag_node_id: nodeId,
              node_type: nodeType ?? 'prompt',
              ...(nodeRunId ? { id: nodeRunId } : {}),
              ...(agentProfileHint ? { agent_profile_hint: agentProfileHint } : {}),
              ...(skills && skills.length > 0 ? { skills } : {}),
              ...(modelHint ? { model_hint: modelHint } : {}),
              ...(parentSubgraphNodeRunId ? { parent_subgraph_node_run_id: parentSubgraphNodeRunId } : {}),
            });
          } catch (err) {
            if (err instanceof DuplicateNodeRunError) {
              // Row already exists — mark it running.
              const existing = await store.findNodeRun(runId, nodeId, null);
              if (existing) {
                await store.updateNodeRun(existing.id, {
                  status: 'running',
                  started_at: Date.now(),
                });
              }
            } else {
              throw err;
            }
          }
          break;
        }

        case 'node_completed': {
          const { runId, nodeId } = event;
          const row = await store.findNodeRun(runId, nodeId, null);
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'completed',
              completed_at: Date.now(),
            });
          }
          break;
        }

        case 'node_failed': {
          const { runId, nodeId, error } = event;
          const row = await store.findNodeRun(runId, nodeId, null);
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'failed',
              completed_at: Date.now(),
              error,
            });
          }
          break;
        }

        case 'node_skipped': {
          const { runId, nodeId, reason } = event;
          let row = await store.findNodeRun(runId, nodeId, null);
          if (!row) {
            // Create the row first, then skip it.
            try {
              row = await store.createNodeRun({
                workflow_run_id: runId,
                dag_node_id: nodeId,
                node_type: 'prompt',
              });
            } catch (err) {
              if (err instanceof DuplicateNodeRunError) {
                row = await store.findNodeRun(runId, nodeId, null);
              } else {
                throw err;
              }
            }
          }
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'skipped',
              skip_reason: reason,
            });
          }
          break;
        }

        case 'loop_iteration_started': {
          const { runId, nodeId, iteration } = event;
          if (!nodeId) break;
          try {
            await store.createNodeRun({
              workflow_run_id: runId,
              dag_node_id: nodeId,
              node_type: 'prompt',
              loop_iteration: iteration,
            });
          } catch (err) {
            if (!(err instanceof DuplicateNodeRunError)) {
              throw err;
            }
            // Row already exists — reuse it (no-op).
          }
          break;
        }

        case 'loop_iteration_completed': {
          const { runId, nodeId, iteration } = event;
          if (!nodeId) break;
          const row = await store.findNodeRun(runId, nodeId, iteration);
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'completed',
              completed_at: Date.now(),
            });
          }
          break;
        }

        case 'loop_iteration_failed': {
          const { runId, nodeId, iteration, error } = event;
          if (!nodeId) break;
          const row = await store.findNodeRun(runId, nodeId, iteration);
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'failed',
              completed_at: Date.now(),
              error,
            });
          }
          break;
        }

        case 'subgraph_started': {
          const { runId, nodeId, nodeRunId, subgraphRef, childCount } = event;
          try {
            await store.createNodeRun({
              workflow_run_id: runId,
              dag_node_id: nodeId,
              node_type: 'subgraph',
              ...(nodeRunId ? { id: nodeRunId } : {}),
              metadata: { subgraphRef, childCount },
            });
          } catch (err) {
            if (err instanceof DuplicateNodeRunError) {
              // Already exists — mark it running.
              const existing = await store.findNodeRun(runId, nodeId, null);
              if (existing) {
                await store.updateNodeRun(existing.id, {
                  status: 'running',
                  started_at: Date.now(),
                });
              }
            } else {
              throw err;
            }
          }
          break;
        }

        case 'subgraph_completed': {
          const { runId, nodeId, outputs } = event;
          const row = await store.findNodeRun(runId, nodeId, null);
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'completed',
              completed_at: Date.now(),
              ...(outputs != null ? { summary: JSON.stringify(outputs) } : {}),
            });
          }
          break;
        }

        case 'subgraph_failed': {
          const { runId, nodeId, error } = event;
          const row = await store.findNodeRun(runId, nodeId, null);
          if (row) {
            await store.updateNodeRun(row.id, {
              status: 'failed',
              completed_at: Date.now(),
              error,
            });
            // Cascade-cancel any child node_runs whose parent is this placeholder.
            const allRows = store.listNodeRuns(runId) as Array<{
              id: string;
              parent_subgraph_node_run_id: string | null;
              status: string;
            }>;
            const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'skipped']);
            const children = allRows.filter(
              (r) =>
                r.parent_subgraph_node_run_id === row.id &&
                !TERMINAL.has(r.status),
            );
            for (const child of children) {
              await store.updateNodeRun(child.id, {
                status: 'cancelled',
                completed_at: Date.now(),
              });
            }
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      log.error({ err, eventType: event.type }, 'projector_error');
    }
  });

  return { stop: unsubscribe };
}
