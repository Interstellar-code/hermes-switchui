/**
 * GET    /api/workflow-definitions/:id  — fetch one
 * DELETE /api/workflow-definitions/:id  — delete (project/user only; bundled is read-only)
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

export const Route = createFileRoute('/api/workflow-definitions/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const { store } = await getWorkflowEngine();
        const def = store.getWorkflowDefinition(params.id);
        if (!def) return json({ error: 'not found' }, 404);
        return json({ definition: def });
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const { store } = await getWorkflowEngine();
        const existing = store.getWorkflowDefinition(params.id);
        if (!existing) return json({ error: 'not found' }, 404);
        if (existing.source === 'bundled') {
          return json({ error: 'bundled definitions are read-only' }, 403);
        }
        // No store helper yet — direct delete via the SwitchUiWorkflowStore would
        // require exposing a method. v1 path: surface a TODO and refuse for now.
        return json({ error: 'delete not yet supported in v1' }, 501);
      },
    },
  },
});
