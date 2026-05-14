/**
 * GET    /api/workflow-runs/:runId              — run + node_runs + recent events
 * POST   /api/workflow-runs/:runId?action=...   — cancel | resume | advance
 *   advance: ?action=advance&to=<phase>   — manual phase advance (decidedBy='user')
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getWorkflowEngine } from '../../server/workflow-engine';
import { VALID_TRANSITIONS, InvalidPhaseTransitionError } from '../../server/workflow-engine/phases';
import type { Phase } from '../../server/workflow-engine/phases';

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
        const phaseTransitions = store.listPhaseTransitions(params.runId);
        return json({ run, nodeRuns, events, phaseTransitions });
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
          case 'advance': {
            const toPhase = url.searchParams.get('to') as Phase | null;
            if (!toPhase || !Object.keys(VALID_TRANSITIONS).includes(toPhase)) {
              return json(
                { error: `?to must be one of: ${Object.keys(VALID_TRANSITIONS).join(', ')}` },
                400,
              );
            }
            try {
              const transition = await store.recordPhaseTransition({
                runId: params.runId,
                toPhase,
                decidedBy: 'user',
              });
              return json({ ok: true, transition });
            } catch (err) {
              if (err instanceof InvalidPhaseTransitionError) {
                return json({ error: err.message }, 409);
              }
              throw err;
            }
          }
          default:
            return json({ error: `unknown action '${action ?? ''}'` }, 400);
        }
      },
    },
  },
});
