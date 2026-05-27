/**
 * POST /api/workflow-runs/:runId/approve
 *
 * Captures the user's decision on a paused approval node and delegates to
 * the plugin engine, which handles all approval logic server-side.
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getEngine } from '../../server/workflow-engine/factory';

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
      },
    },
  },
});
