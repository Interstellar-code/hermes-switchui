export { SwitchUiWorkflowStore } from "./workflow-store.js";
export { DuplicateNodeRunError } from "./types.js";
export type {
  WorkflowRun,
  NodeRun,
  WorkflowRunStatus,
  NodeRunStatus,
  CurrentPhase,
  WorkflowDefinitionRow,
  ApprovalContext,
  ListWorkflowDefinitionsFilter,
} from "./types.js";

import { SwitchUiWorkflowStore } from "./workflow-store.js";
import { runMigrations } from "../db/migrate.js";
import { openDb } from "../db/client.js";

export function createWorkflowStore(options: { dbPath?: string } = {}): SwitchUiWorkflowStore {
  const db = options.dbPath ? openDb(options.dbPath) : openDb();
  runMigrations(db);
  return new SwitchUiWorkflowStore(db);
}
