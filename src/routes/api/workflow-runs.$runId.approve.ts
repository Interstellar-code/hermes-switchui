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
import { getEngine } from '../../server/workflow-engine/factory';
// Phase 3 delete: import { launchWorkflowRun } from '../../server/workflow-engine/runtime';
// Phase 3 delete: import type { ApprovalReceivedEvent } from '../../server/workflow-engine/emitter/event-emitter';

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

        const engine = getEngine(request);
        const runId = params.runId;

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

        // Phase 2: always plugin path — plugin handles all approval logic server-side.
        const ifaceDecision = decision === 'approved' ? 'approve' : 'reject';
        await engine.approve(runId, node_run_id, ifaceDecision, approvalResponse || undefined);
        return json({ ok: true, decision, resumedRunId: runId });

        /* Phase 3 delete — native approval path:
        // Native path: full approval orchestration with store + emitter + launchWorkflowRun.
        // See git history for full implementation.
        */
      },
    },
  },
});
