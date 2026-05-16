/**
 * POST /api/workflow-runs/:runId/approve
 *
 * A.5 approval endpoint — captures the user's decision on a paused approval
 * node, updates the node_run, emits an approval_received event, resumes the
 * workflow_run, and re-enters the DAG executor fire-and-forget via
 * launchWorkflowRun({ resumeMode: true }).
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getWorkflowEngine } from '../../server/workflow-engine';
import { launchWorkflowRun } from '../../server/workflow-engine/runtime';
import type { ApprovalReceivedEvent } from '../../server/workflow-engine/emitter/event-emitter';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const Route = createFileRoute('/api/workflow-runs/$runId/approve')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);

        const engine = await getWorkflowEngine();
        const { store } = engine;
        const runId = params.runId;

        // 1. Validate the run exists.
        const run = await store.getWorkflowRun(runId);
        if (!run) return json({ error: 'workflow_run not found' }, 404);

        // 2. Parse + validate body.
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'Invalid JSON body' }, 400);
        }

        const { node_run_id, decision, response } = body as {
          node_run_id?: unknown;
          decision?: unknown;
          response?: unknown;
        };

        if (typeof node_run_id !== 'string' || !node_run_id) {
          return json({ error: 'node_run_id is required' }, 400);
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          return json({ error: "decision must be 'approved' or 'rejected'" }, 400);
        }
        const approvalResponse = typeof response === 'string' ? response : '';

        // 3. Validate the node_run belongs to this run and is paused.
        const nodeRun = store.findNodeRunById(node_run_id);
        if (!nodeRun) return json({ error: 'node_run not found' }, 404);
        if (nodeRun.workflow_run_id !== runId) {
          return json({ error: 'node_run does not belong to this workflow_run' }, 400);
        }
        // 3b. Atomic compare-and-swap: UPDATE WHERE status='paused'.
        //     Prevents double-click race: only one caller can claim the row.
        const claim = store.tryClaimApprovalForResume(node_run_id, decision, approvalResponse);
        if (!claim.claimed) {
          return json({ error: 'approval already processed' }, 409);
        }

        // 4. Emit approval_received event to DB (audit trail).
        await store.appendWorkflowEvent({
          workflow_run_id: runId,
          node_run_id,
          event_type: 'approval_received',
          data: { decision, response: approvalResponse },
        });

        // 5. Forward to in-memory SSE emitter so subscribers see it in real time.
        //    (appendWorkflowEvent is DB-only; the emitter is the live broadcast bus.)
        const approvalEvent: ApprovalReceivedEvent = {
          type: 'approval_received',
          runId,
          conversationId: run.conversation_id,
          nodeRunId: node_run_id,
          decision,
          response: approvalResponse,
        };
        engine.emitter.emit(approvalEvent);

        // 6. Flip run back to running.
        await store.resumeWorkflowRun(runId);

        // 7. Re-enter DAG fire-and-forget with resumeMode=true.
        //    The executor's preCreatedRun path picks up the existing run state
        //    and getCompletedDagNodeOutputs to skip already-completed nodes.
        const workflowDef = store.getWorkflowDefinition(run.workflow_id);
        if (workflowDef) {
          void launchWorkflowRun(engine, {
            runId,
            workflowYaml: workflowDef.yaml,
            workflowId: workflowDef.id,
            conversationId: run.conversation_id,
            cwd: run.working_path ?? process.cwd(),
            userMessage: run.user_message ?? '',
            conversationDbId: run.conversation_id,
            codebaseId: run.codebase_id ?? undefined,
            resumeMode: true,
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn(`[approve] workflow definition not found for run ${runId} (workflow_id=${run.workflow_id}); DAG not re-entered`);
        }

        return json({ ok: true, decision, resumedRunId: runId });
      },
    },
  },
});
