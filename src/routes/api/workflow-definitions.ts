/**
 * GET  /api/workflow-definitions      — list (optional ?source=bundled|user|project)
 * POST /api/workflow-definitions      — upsert a definition
 */
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { getWorkflowEngine } from '../../server/workflow-engine';
import { writeWorkflowsManifest } from '../../server/workflow-engine/runtime/manifest';
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
          id?: unknown;
          name?: unknown;
          description?: unknown;
          source?: unknown;
          scope_path?: unknown;
          yaml?: unknown;
          version?: unknown;
          tags?: unknown;
        };

        // Codex Bundle 5 Q3 — Input validation.
        // id: slug-only (letters, digits, dash, underscore, colon). Max 128 chars.
        // yaml: max 1 MiB.
        // source: enum.
        // scope_path: must be absolute + no '..' segments.
        // tags: array of strings if provided.
        if (typeof body.id !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(body.id)) {
          return json({ error: 'id must be 1-128 chars of [A-Za-z0-9_:.-]' }, 400);
        }
        if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 256) {
          return json({ error: 'name must be a string 1-256 chars' }, 400);
        }
        if (typeof body.yaml !== 'string' || body.yaml.length === 0) {
          return json({ error: 'yaml must be a non-empty string' }, 400);
        }
        const MAX_YAML_BYTES = 1024 * 1024;
        if (Buffer.byteLength(body.yaml, 'utf8') > MAX_YAML_BYTES) {
          return json({ error: `yaml exceeds ${MAX_YAML_BYTES} bytes` }, 413);
        }
        const source = body.source ?? 'project';
        if (source !== 'project' && source !== 'user' && source !== 'bundled') {
          return json({ error: "source must be 'project' | 'user' | 'bundled'" }, 400);
        }
        if (source === 'bundled') {
          return json({ error: "source='bundled' is read-only" }, 403);
        }
        if (body.scope_path !== undefined) {
          if (typeof body.scope_path !== 'string' || !body.scope_path.startsWith('/') || body.scope_path.includes('..')) {
            return json({ error: 'scope_path must be absolute and contain no .. segments' }, 400);
          }
        }
        if (body.description !== undefined && typeof body.description !== 'string') {
          return json({ error: 'description must be a string when provided' }, 400);
        }
        if (body.version !== undefined && typeof body.version !== 'string') {
          return json({ error: 'version must be a string when provided' }, 400);
        }
        let tags: string[] | undefined;
        if (body.tags !== undefined) {
          if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
            return json({ error: 'tags must be a string[] when provided' }, 400);
          }
          tags = body.tags as string[];
        }

        const checksum = createHash('sha256').update(body.yaml.replace(/\r\n/g, '\n')).digest('hex');
        store.upsertWorkflowDefinition({
          id: body.id,
          name: body.name,
          description: body.description as string | undefined,
          source: source as 'user' | 'project',
          scope_path: body.scope_path as string | undefined,
          yaml: body.yaml,
          checksum,
          version: body.version as string | undefined,
          tags,
        });
        const def = store.getWorkflowDefinition(body.id);

        // A.10 Q1 — refresh manifest after upsert so it stays current.
        try {
          writeWorkflowsManifest({ store });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[workflow-definitions] manifest refresh failed after upsert:', err);
        }

        return json({ definition: def });
      },
    },
  },
});
