/**
 * Minimal WorkflowConfig loader for Switch UI (A.8).
 *
 * v1: returns hard-coded defaults. v1.1 will read
 * ~/.hermes/switchui-workflows.config.yaml if present.
 */
import type { WorkflowConfig } from '../wiring/deps.js';

export async function loadWorkflowConfig(_cwd: string): Promise<WorkflowConfig> {
  return {
    assistant: 'hermes-kanban',
    commands: { folder: undefined },
    defaults: { loadDefaultWorkflows: true, loadDefaultCommands: true },
    envVars: {},
    baseBranch: undefined,
    docsPath: undefined,
    assistants: {
      claude: { model: undefined },
      codex: { model: undefined },
    } as WorkflowConfig['assistants'],
  };
}
