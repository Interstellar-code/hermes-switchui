/**
 * GET    /api/workflow-definitions/:id  — fetch one
 * DELETE /api/workflow-definitions/:id  — delete (project/user only; bundled is read-only)
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

export const Route = createFileRoute('/api/workflow-definitions/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const engine = getEngine(request);
        const def = await engine.getDefinition(params.id);
        if (!def) return json({ error: 'not found' }, 404);
        return json({ definition: def });
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const engine = getEngine(request);
        const existing = await engine.getDefinition(params.id);
        if (!existing) return json({ error: 'not found' }, 404);
        if (existing.source === 'bundled') {
          return json({ error: 'bundled definitions are read-only' }, 403);
        }
        const rowsAffected = await engine.deleteWorkflowDefinition(params.id);
        if (rowsAffected === 0) return json({ error: 'not found' }, 404);
        // Phase 2: always plugin path — plugin manages its own manifest state.
return json({ ok: true });
      },
    },
  },
});
