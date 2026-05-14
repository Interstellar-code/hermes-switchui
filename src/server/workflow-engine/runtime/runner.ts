/**
 * launchWorkflowRun — entry point called by POST /api/workflow-runs (A.8).
 *
 * Advances plan → route → execute phases synchronously, marks the run as
 * 'running', then kicks off the DAG executor fire-and-forget. The HTTP
 * response returns immediately; the DAG resolves the run later via
 * completeWorkflowRun or failWorkflowRun.
 */
import { parseWorkflow } from '../discovery/loader.js';
import { executeWorkflow } from '../core/executor.js';
import type { WorkflowEngine } from '../wiring/engine.js';
import type { WorkflowRun as SchemaWorkflowRun } from '../schemas/index.js';

export interface LaunchInput {
  /** Already-created workflow_runs row id. */
  runId: string;
  /** Raw YAML string from workflow_definitions.yaml. */
  workflowYaml: string;
  /** Workflow definition id (for logging). */
  workflowId: string;
  /** Platform conversation id. */
  conversationId: string;
  /** Working directory for command execution. */
  cwd: string;
  /** The user's trigger message. */
  userMessage: string;
  /** DB conversation id (may differ from conversationId). */
  conversationDbId: string;
  /** Optional codebase id. */
  codebaseId?: string;
  /** Optional parent conversation id. */
  parentConversationId?: string;
}

/**
 * Launch a workflow run.
 *
 * Returns immediately after recording plan→route→execute transitions and
 * marking the run 'running'. The actual DAG executes async.
 */
export async function launchWorkflowRun(
  engine: WorkflowEngine,
  input: LaunchInput,
): Promise<void> {
  const { store, deps, platform } = engine;

  // 1. plan → route (system — launch wizard pre-collected all route info)
  await store.recordPhaseTransition({
    runId: input.runId,
    toPhase: 'route',
    decidedBy: 'system',
    decisionData: { reason: 'launch-wizard-precollected' },
  });

  // 2. route → execute (engine — no human routing needed for v1)
  await store.recordPhaseTransition({
    runId: input.runId,
    toPhase: 'execute',
    decidedBy: 'engine',
    decisionData: { workflow_id: input.workflowId },
  });

  // 3. Parse and validate the YAML.
  const parsed = parseWorkflow(input.workflowYaml, `${input.workflowId}.yaml`);
  if (parsed.error) {
    await store.failWorkflowRun(input.runId, parsed.error.error);
    return;
  }
  const workflow = parsed.workflow;

  // 4. Mark run as running.
  await store.updateWorkflowRun(input.runId, { status: 'running' });

  // 5. Kick off DAG — fire-and-forget. HTTP response returns before this
  //    resolves. The DAG calls completeWorkflowRun / failWorkflowRun when done.
  void (async () => {
    // Fetch the already-created WorkflowRun row for preCreatedRun.
    // Cast: store/types.ts::WorkflowRun lacks last_activity_at (a schemas field
    // the executor never reads). Structurally compatible at runtime.
    const preCreatedRun = (await store.getWorkflowRun(input.runId)) as unknown as SchemaWorkflowRun | undefined;

    try {
      const result = await executeWorkflow(
        deps,
        platform,
        input.conversationId,
        input.cwd,
        workflow,
        input.userMessage,
        input.conversationDbId,
        input.codebaseId,
        undefined,          // issueContext
        undefined,          // isolationContext
        input.parentConversationId,
        preCreatedRun ?? undefined,
      );

      // 6a. execute → report on success.
      await store.recordPhaseTransition({
        runId: input.runId,
        toPhase: 'report',
        decidedBy: 'engine',
        decisionData: { result: result as unknown as Record<string, unknown> },
      });
      await store.completeWorkflowRun(input.runId);
    } catch (err) {
      // 6b. Failure — mark run failed; phase stays in execute (terminal-failed).
      await store.failWorkflowRun(input.runId, (err as Error).message);
    }
  })();
}
