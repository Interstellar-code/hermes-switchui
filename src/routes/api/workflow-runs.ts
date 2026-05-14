/**
 * GET  /api/workflow-runs   — list runs (filter via ?workflow_id, ?status comma-list)
 * POST /api/workflow-runs   — launch a run (Launch Wizard target)
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getWorkflowEngine } from '../../server/workflow-engine';
import { launchWorkflowRun } from '../../server/workflow-engine/runtime';

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
        const { store } = await getWorkflowEngine();
        const url = new URL(request.url);
        const workflowId = url.searchParams.get('workflow_id');
        const statusCsv = url.searchParams.get('status');
        const statuses = statusCsv ? statusCsv.split(',') : null;

        const rows = store.listWorkflowRuns({
          workflowId: workflowId ?? undefined,
          statuses: statuses ?? undefined,
        });
        return json({ runs: rows });
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const engine = await getWorkflowEngine();
        const { store } = engine;
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

        // Definition must exist (FK on workflow_runs.workflow_id).
        const def = store.getWorkflowDefinition(body.workflow_id);
        if (!def) return json({ error: `unknown workflow_id '${body.workflow_id}'` }, 404);

        // Conversation-id collision guard (Bundle 5 Q4 + Bundle 4 cron dedup).
        if (store.findRunByConversationId?.(body.conversation_id)) {
          return json(
            { error: 'a workflow run with this conversation_id already exists' },
            409,
          );
        }

        // Split-brain guard: refuse if an active run already owns this working_path.
        if (body.working_path) {
          const active = await store.getActiveWorkflowRunByPath(body.working_path);
          if (active) {
            return json(
              { error: 'an active workflow run already exists for this working_path', activeRunId: active.id },
              409,
            );
          }
        }

        const run = await store.createWorkflowRun({
          workflow_name: body.workflow_id,
          conversation_id: body.conversation_id,
          working_path: body.working_path,
          user_message: body.user_message,
          metadata: body.variables ? { variables: body.variables } : undefined,
          parent_conversation_id: body.parent_conversation_id,
          codebase_id: body.codebase_id,
        });

        // A.8: kick off the 5-phase orchestration wrapper (fire-and-forget).
        // launchWorkflowRun returns immediately; the DAG runs async.
        void launchWorkflowRun(engine, {
          runId: run.id,
          workflowYaml: def.yaml,
          workflowId: body.workflow_id,
          conversationId: body.conversation_id,
          cwd: body.working_path ?? process.cwd(),
          userMessage: body.user_message,
          conversationDbId: body.conversation_id,
          codebaseId: body.codebase_id,
          parentConversationId: body.parent_conversation_id,
        });

        return json({ run }, 201);
      },
    },
  },
});
