/**
 * GET    /api/workflow-runs/:runId              — run + node_runs + recent events
 * POST   /api/workflow-runs/:runId?action=...   — cancel | resume | advance
 *   advance: ?action=advance&to=<phase>   — manual phase advance (decidedBy='user')
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { requireJsonContentType } from '../../server/rate-limit';
import { getEngine } from '../../server/workflow-engine/factory';
import { VALID_TRANSITIONS } from '../../server/workflow-engine/interface';
import type { Phase } from '../../server/workflow-engine/interface';


export const Route = createFileRoute('/api/workflow-runs/$runId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const engine = getEngine();

        const run = await engine.getRun(params.runId);
        if (!run) return Response.json({ error: 'not found' }, { status: 404 });

        // Codex Bundle 5 Q7 — cap unbounded arrays at the route layer so
        // long-running workflows don't ship 10k node_runs / 1k phase
        // transitions in a single response.
        const RUN_DETAIL_LIMIT = 500;
        const allNodeRuns = await engine.listNodeRuns(params.runId);
        const allPhaseTransitions = await engine.listPhaseTransitions(params.runId);
        const nodeRuns = allNodeRuns.slice(-RUN_DETAIL_LIMIT);
        const phaseTransitions = allPhaseTransitions.slice(-RUN_DETAIL_LIMIT);
        const events = await engine.listRecentWorkflowEvents(params.runId);
        return Response.json({
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
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const csrfCheck = requireJsonContentType(request);
        if (csrfCheck) return csrfCheck;
        const engine = getEngine();
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        switch (action) {
          case 'cancel':
            try {
              await engine.cancelRun(params.runId);
              return Response.json({ ok: true });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return Response.json({ error: msg }, { status: 500 });
            }
          case 'resume': {
            try {
              await engine.resumeWorkflowRun(params.runId);
              return Response.json({ ok: true });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return Response.json({ error: msg }, { status: 500 });
            }
          }
          case 'advance': {
            const toPhase = url.searchParams.get('to') as Phase | null;
            if (!toPhase || !Object.keys(VALID_TRANSITIONS).includes(toPhase)) {
              return Response.json(
                { error: `?to must be one of: ${Object.keys(VALID_TRANSITIONS).join(', ')}` },
                { status: 400 },
              );
            }
            try {
              const transition = await engine.recordPhaseTransition({
                runId: params.runId,
                toPhase,
                decidedBy: 'user',
              });
              return Response.json({ ok: true, transition });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              // Plugin returns 409 for invalid phase transitions; surface it.
              if (msg.includes(': 409 ') || msg.toLowerCase().includes('invalid phase transition')) {
                return Response.json({ error: msg }, { status: 409 });
              }
              throw err;
            }
          }
          default:
            return Response.json({ error: `unknown action '${action ?? ''}'` }, { status: 400 });
        }
      },
    },
  },
});
