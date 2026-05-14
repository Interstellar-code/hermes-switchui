/**
 * GET  /api/workflow-definitions      — list (optional ?source=bundled|user|project)
 * POST /api/workflow-definitions      — upsert a definition
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getWorkflowEngine } from '../../server/workflow-engine';
import { createHash } from 'node:crypto';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const Route = createFileRoute('/api/workflow-definitions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const { store } = await getWorkflowEngine();
        const url = new URL(request.url);
        const source = url.searchParams.get('source') as
          | 'bundled' | 'user' | 'project' | null;
        const defs = store.listWorkflowDefinitions(source ? { source } : undefined);
        return json({ definitions: defs });
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return json({ error: 'Unauthorized' }, 401);
        const { store } = await getWorkflowEngine();
        const body = (await request.json()) as {
          id: string;
          name: string;
          description?: string;
          source?: 'bundled' | 'user' | 'project';
          scope_path?: string;
          yaml: string;
          version?: string;
          tags?: string[];
        };
        if (!body?.id || !body?.name || !body?.yaml) {
          return json({ error: 'id, name, yaml required' }, 400);
        }
        const checksum = createHash('sha256').update(body.yaml).digest('hex');
        store.upsertWorkflowDefinition({
          id: body.id,
          name: body.name,
          description: body.description,
          source: body.source ?? 'project',
          scope_path: body.scope_path,
          yaml: body.yaml,
          checksum,
          version: body.version,
          tags: body.tags,
        });
        const def = store.getWorkflowDefinition(body.id);
        return json({ definition: def });
      },
    },
  },
});
