/**
 * GET  /api/workflow-runs   — list runs (filter via ?workflow_id, ?status comma-list)
 * POST /api/workflow-runs   — launch a run (Launch Wizard target)
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getEngine } from '../../server/workflow-engine/factory';
// Phase 3 delete: import { launchWorkflowRun } from '../../server/workflow-engine/runtime';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const Route = createFileRoute('/api/workflow-runs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const engine = getEngine(request);
        const url = new URL(request.url);
        const workflowId = url.searchParams.get('workflow_id');

        // Phase 2: always plugin path.
        const runs = await engine.listRuns({ workflowId: workflowId ?? undefined });
        return json({ runs });

        /* Phase 3 delete — native path kept compilable:
        const { getWorkflowEngine } = await import('../../server/workflow-engine/index.js');
        const { store } = await getWorkflowEngine();
        const statusCsv = url.searchParams.get('status');
        const statuses = statusCsv ? statusCsv.split(',') : null;
        const rows = store.listWorkflowRuns({
          workflowId: workflowId ?? undefined,
          statuses: statuses ?? undefined,
        });
        return json({ runs: rows });
        */
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const engine = getEngine(request);
        const body = (await request.json()) as {
          workflow_id: string;
          conversation_id: string;
          working_path?: string;
          user_message: string;
          variables?: Record<string, unknown>;
          parent_conversation_id?: string;
          codebase_id?: string;
        };
        if (!body?.workflow_id || !body?.conversation_id || !body?.user_message) {
          return json({ error: 'workflow_id, conversation_id, user_message required' }, 400);
        }
        // Codex Bundle 5 Q4 — Input validation.
        if (typeof body.workflow_id !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(body.workflow_id)) {
          return json({ error: 'workflow_id must be 1-128 chars of [A-Za-z0-9_:.-]' }, 400);
        }
        if (typeof body.conversation_id !== 'string' || body.conversation_id.length < 1 || body.conversation_id.length > 256) {
          return json({ error: 'conversation_id must be 1-256 chars' }, 400);
        }
        if (typeof body.user_message !== 'string' || body.user_message.length === 0) {
          return json({ error: 'user_message must be a non-empty string' }, 400);
        }
        if (body.working_path !== undefined) {
          if (typeof body.working_path !== 'string' || !body.working_path.startsWith('/') || body.working_path.includes('..')) {
            return json({ error: 'working_path must be an absolute path with no .. segments' }, 400);
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
          },
        );
        return json({ run }, 201);

        /* Phase 3 delete — native path kept for reference:
        // Native path: full orchestration with store + launchWorkflowRun.
        // const { getWorkflowEngine } = await import('../../server/workflow-engine/index.js');
        // const nativeEngine = await getWorkflowEngine();
        // const { store } = nativeEngine;
        // const def = store.getWorkflowDefinition(body.workflow_id);
        // if (!def) return json({ error: `unknown workflow_id '${body.workflow_id}'` }, 404);
        // if (store.findRunByConversationId?.(body.conversation_id)) {
        //   return json({ error: 'a workflow run with this conversation_id already exists' }, 409);
        // }
        // if (body.working_path) {
        //   const active = await store.getActiveWorkflowRunByPath(body.working_path);
        //   if (active) {
        //     return json({ error: 'an active workflow run already exists for this working_path', activeRunId: active.id }, 409);
        //   }
        // }
        // const nativeRun = await store.createWorkflowRun({ ... });
        // void launchWorkflowRun(nativeEngine, { runId: nativeRun.id, ... });
        // return json({ run: nativeRun }, 201);
        */
      },
    },
  },
});
