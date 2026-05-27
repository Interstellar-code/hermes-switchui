/**
 * GET    /api/workflow-runs/:runId              — run + node_runs + recent events
 * POST   /api/workflow-runs/:runId?action=...   — cancel | resume | advance
 *   advance: ?action=advance&to=<phase>   — manual phase advance (decidedBy='user')
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getEngine } from '../../server/workflow-engine/factory';
import { VALID_TRANSITIONS } from '../../server/workflow-engine/interface';
import type { Phase } from '../../server/workflow-engine/interface';

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
        const engine = getEngine(request);

        const run = await engine.getRun(params.runId);
        if (!run) return json({ error: 'not found' }, 404);

        // Codex Bundle 5 Q7 — cap unbounded arrays at the route layer so
        // long-running workflows don't ship 10k node_runs / 1k phase
        // transitions in a single response.
        const RUN_DETAIL_LIMIT = 500;
        const allNodeRuns = await engine.listNodeRuns(params.runId);
        const allPhaseTransitions = await engine.listPhaseTransitions(params.runId);
        const nodeRuns = allNodeRuns.slice(-RUN_DETAIL_LIMIT);
        const phaseTransitions = allPhaseTransitions.slice(-RUN_DETAIL_LIMIT);
        const events = await engine.listRecentWorkflowEvents(params.runId);
        return json({
          run,
          nodeRuns,
          events,
          phaseTransitions,
          truncated: {
            nodeRuns: allNodeRuns.length > nodeRuns.length,
            phaseTransitions: allPhaseTransitions.length > phaseTransitions.length,
          },
        });
      },
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const engine = getEngine(request);
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        switch (action) {
          case 'cancel':
            await engine.cancelRun(params.runId);
            return json({ ok: true });
          case 'resume': {
            await engine.resumeWorkflowRun(params.runId);
            return json({ ok: true });
          }
          case 'advance': {
            const toPhase = url.searchParams.get('to') as Phase | null;
            if (!toPhase || !Object.keys(VALID_TRANSITIONS).includes(toPhase)) {
              return json(
                { error: `?to must be one of: ${Object.keys(VALID_TRANSITIONS).join(', ')}` },
                400,
              );
            }
            try {
              const transition = await engine.recordPhaseTransition({
                runId: params.runId,
                toPhase,
                decidedBy: 'user',
              });
              return json({ ok: true, transition });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              // Plugin returns 409 for invalid phase transitions; surface it.
              if (msg.includes(': 409 ') || msg.toLowerCase().includes('invalid phase transition')) {
                return json({ error: msg }, 409);
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
