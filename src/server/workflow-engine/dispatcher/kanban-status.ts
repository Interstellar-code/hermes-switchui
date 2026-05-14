/**
 * Canonical mapping from Hermes Kanban task statuses to node_runs terminal
 * statuses. Used by BOTH the inline dispatcher (live execution) and the
 * cold-start TaskEventConsumer so the two paths can never diverge.
 *
 * Audit note (Codex Bundle 2 Q4): prior to this module the two paths
 * disagreed — consumer said blocked→paused, dispatcher threw on blocked which
 * the dag-executor mapped to node_failed. Canonical now: blocked→failed.
 */
import type { HermesKanbanStatus } from '../../../lib/hermes-kanban-types';

export type TerminalNodeStatus = 'completed' | 'failed' | 'cancelled';

/**
 * Return the corresponding node_runs terminal status, or null if the Kanban
 * status is still in flight (triage/todo/ready/running).
 */
export function kanbanStatusToNodeRunStatus(
  status: HermesKanbanStatus,
): TerminalNodeStatus | null {
  switch (status) {
    case 'done':
      return 'completed';
    case 'blocked':
      return 'failed';
    case 'archived':
      return 'cancelled';
    case 'triage':
    case 'todo':
    case 'ready':
    case 'running':
      return null;
    default:
      return null;
  }
}

export const TERMINAL_KANBAN_STATUSES = new Set<HermesKanbanStatus>([
  'done',
  'blocked',
  'archived',
]);
