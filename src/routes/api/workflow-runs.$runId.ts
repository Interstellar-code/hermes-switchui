/**
 * GET    /api/workflow-runs/:runId         — run + node_runs + recent events
 * POST   /api/workflow-runs/:runId/cancel  — cancel a run (action via ?action=cancel|pause|resume)
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getWorkflowEngine } from '../../server/workflow-engine';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const Route = createFileRoute('/api/workflow-runs/$runId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const { store } = await getWorkflowEngine();

        const run = await store.getWorkflowRun(params.runId);
        if (!run) return json({ error: 'not found' }, 404);

        const nodeRuns = store.listNodeRuns(params.runId);
        const events = store.listRecentWorkflowEvents(params.runId);
        return json({ run, nodeRuns, events });
      },
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const { store } = await getWorkflowEngine();
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        switch (action) {
          case 'cancel':
            await store.cancelWorkflowRun(params.runId);
            return json({ ok: true });
          case 'resume':
            await store.resumeWorkflowRun(params.runId);
            return json({ ok: true });
          default:
            return json({ error: `unknown action '${action ?? ''}'` }, 400);
        }
      },
    },
  },
});
