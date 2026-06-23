/**
 * POST /api/workflow-definitions/:id/reset-factory
 *
 * Restores a bundled workflow definition to its factory yaml and clears
 * user_modified. Returns 404 if not a known factory id, 403 if not bundled.
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { requireJsonContentType } from '../../server/rate-limit';
import { getEngine } from '../../server/workflow-engine/factory';


export const Route = createFileRoute('/api/workflow-definitions/$id/reset-factory')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const csrfCheck = requireJsonContentType(request);
        if (csrfCheck) return csrfCheck;
        const engine = getEngine();
        try {
          const def = await engine.resetFactoryDefinition(params.id);
          return Response.json({ definition: def });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as { status?: number }).status;
          if (status === 404) return Response.json({ error: msg }, { status: 404 });
          if (status === 403) return Response.json({ error: msg }, { status: 403 });
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
