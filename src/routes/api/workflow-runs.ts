/**
 * GET  /api/workflow-runs   — list runs (filter via ?workflow_id, ?status comma-list, ?limit)
 * POST /api/workflow-runs   — launch a run (Launch Wizard target)
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { requireJsonContentType } from '../../server/rate-limit';
import { WORKFLOW_ID_RE } from '../../server/workflow-id';
import { getEngine } from '../../server/workflow-engine/factory';
import { WORKFLOW_RUN_STATUS } from '../../server/workflow-engine/interface';


export const Route = createFileRoute('/api/workflow-runs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const engine = getEngine();
        const url = new URL(request.url);
        const workflowId = url.searchParams.get('workflow_id');
        const rawLimit = Number(url.searchParams.get('limit'));
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 500) || undefined : undefined;
        const rawStatus = url.searchParams.get('status');
        let status: string | undefined;
        if (rawStatus !== null) {
          const valid = rawStatus
            .split(',')
            .map((s) => s.trim())
            .filter((s) => (WORKFLOW_RUN_STATUS as ReadonlyArray<string>).includes(s));
          if (valid.length === 0) {
            return Response.json(
              { error: `status must be a comma list of: ${WORKFLOW_RUN_STATUS.join(',')}` },
              { status: 400 },
            );
          }
          status = valid.join(',');
        }

        // Phase 2: always plugin path.
        try {
          const runs = await engine.listRuns({ workflowId: workflowId ?? undefined, limit, status });
          return Response.json({ runs });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[workflow-runs] engine unavailable, returning empty list: ${message}`);
          return Response.json({ runs: [] });
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const csrfCheck = requireJsonContentType(request);
        if (csrfCheck) return csrfCheck;
        const engine = getEngine();
        let body: {
          workflow_id: string;
          conversation_id: string;
          working_path?: string;
          user_message: string;
          variables?: Record<string, unknown>;
          parent_conversation_id?: string;
          codebase_id?: string;
          schedule?: { type: 'now' | 'at' | 'cron'; at?: string; cron?: string };
          priority?: number;
          maxRuntimeSeconds?: number;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        if (!body.workflow_id || !body.conversation_id || !body.user_message) {
          return Response.json({ error: 'workflow_id, conversation_id, user_message required' }, { status: 400 });
        }
        // Codex Bundle 5 Q4 — Input validation.
        if (typeof body.workflow_id !== 'string' || !WORKFLOW_ID_RE.test(body.workflow_id)) {
          return Response.json({ error: 'workflow_id must be 1-128 chars of [A-Za-z0-9_:.-]' }, { status: 400 });
        }
        if (typeof body.conversation_id !== 'string' || body.conversation_id.length < 1 || body.conversation_id.length > 256) {
          return Response.json({ error: 'conversation_id must be 1-256 chars' }, { status: 400 });
        }
        if (typeof body.user_message !== 'string' || body.user_message.length === 0) {
          return Response.json({ error: 'user_message must be a non-empty string' }, { status: 400 });
        }
        if (body.working_path !== undefined) {
          if (typeof body.working_path !== 'string' || !body.working_path.startsWith('/') || body.working_path.includes('..')) {
            return Response.json({ error: 'working_path must be an absolute path with no .. segments' }, { status: 400 });
          }
        }

        // Phase 2: always plugin path.
        const run = await engine.startRun(
          body.workflow_id,
          body.variables ?? {},
          {
            kind: 'manual',
            conversation_id: body.conversation_id,
            working_path: body.working_path,
            user_message: body.user_message,
            parent_conversation_id: body.parent_conversation_id,
            codebase_id: body.codebase_id,
            schedule: body.schedule,
            priority: body.priority,
            maxRuntimeSeconds: body.maxRuntimeSeconds,
          },
        );
        return Response.json({ run }, { status: 201 });
      },
    },
  },
});
