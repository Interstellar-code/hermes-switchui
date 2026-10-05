/**
 * POST /api/workflow-runs/:runId/approve
 *
 * Captures the user's decision on a paused approval node and delegates to
 * the plugin engine, which handles all approval logic server-side.
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { requireJsonContentType } from '../../server/rate-limit';
import { getEngine } from '../../server/workflow-engine/factory';


export const Route = createFileRoute('/api/workflow-runs/$runId/approve')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const csrfCheck = requireJsonContentType(request);
        if (csrfCheck) return csrfCheck;

        const engine = getEngine();
        const runId = params.runId;

        // 2. Parse + validate body.
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { node_run_id, decision, response } = body as {
          node_run_id?: unknown;
          decision?: unknown;
          response?: unknown;
        };

        if (typeof node_run_id !== 'string' || !node_run_id) {
          return Response.json({ error: 'node_run_id is required' }, { status: 400 });
        }
        if (decision !== 'approved' && decision !== 'rejected') {
          return Response.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
        }
        const approvalResponse = typeof response === 'string' ? response : '';

        // Phase 2: always plugin path — plugin handles all approval logic server-side.
        const ifaceDecision = decision === 'approved' ? 'approve' : 'reject';
        // approved_by is server-set (self-reported, no per-user identity); any client value is ignored.
        await engine.approve(runId, node_run_id, ifaceDecision, approvalResponse || undefined, 'switchui');
        return Response.json({ ok: true, decision, resumedRunId: runId });
      },
    },
  },
});
