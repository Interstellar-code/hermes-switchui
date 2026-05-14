export { KanbanDispatcher } from './kanban-dispatcher.js';
export type { KanbanDispatcherOpts, CreateKanbanTaskFn } from './kanban-dispatcher.js';

import { KanbanDispatcher } from './kanban-dispatcher.js';
import type { KanbanDispatcherOpts } from './kanban-dispatcher.js';

/**
 * Factory for the single execute-phase provider.
 * The orchestrator wires onTaskCreated from the engine store.
 */
export function createKanbanDispatcher(opts?: KanbanDispatcherOpts): KanbanDispatcher {
  return new KanbanDispatcher(opts);
}
