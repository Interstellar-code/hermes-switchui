/**
 * GET  /api/workflow-definitions      — list (optional ?source=bundled|user|project)
 * POST /api/workflow-definitions      — upsert a definition
 */
import { createHash } from 'node:crypto';
import { createFileRoute } from '@tanstack/react-router';
import { isAuthenticated } from '../../server/auth-middleware';
import { requireJsonContentType } from '../../server/rate-limit';
import { getEngine } from '../../server/workflow-engine/factory';
import { summariseWorkflowYaml } from '../../server/workflow-yaml-summary';

// Simple in-process memoization keyed by sha256 of the yaml string.
// Avoids re-parsing the same YAML on every list request.
const SUMMARY_CACHE_MAX = 256;
const _summaryCache = new Map<string, ReturnType<typeof summariseWorkflowYaml>>();
function summariseWorkflowYamlCached(yaml: string): ReturnType<typeof summariseWorkflowYaml> {
  const key = createHash('sha256').update(yaml).digest('hex');
  const cached = _summaryCache.get(key);
  if (cached) return cached;
  const result = summariseWorkflowYaml(yaml);
  if (_summaryCache.size >= SUMMARY_CACHE_MAX) {
    // Evict oldest inserted entry (Map iteration order is insertion order).
    const oldest = _summaryCache.keys().next().value;
    if (oldest !== undefined) _summaryCache.delete(oldest);
  }
  _summaryCache.set(key, result);
  return result;
}


export const Route = createFileRoute('/api/workflow-definitions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        // Phase 2: always plugin path via getEngine().
        const engine = getEngine();
        const url = new URL(request.url);
        const source = url.searchParams.get('source') as
          | 'bundled' | 'user' | 'project' | null;
        const defs = await engine.listDefinitions(source ? { source } : undefined);
        const enriched = defs.map((def) => ({
          ...def,
          // Only enrich when yaml is present; omit summary fields when plugin omits yaml.
          ...(def.yaml ? summariseWorkflowYamlCached(def.yaml) : {}),
        }));
        return Response.json({ definitions: enriched });
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const csrfCheck = requireJsonContentType(request);
        if (csrfCheck) return csrfCheck;
        const engine = getEngine();
        const body = (await request.json()) as {
          id?: unknown;
          name?: unknown;
          description?: unknown;
          source?: unknown;
          scope_path?: unknown;
          yaml?: unknown;
          version?: unknown;
          tags?: unknown;
          expected_checksum?: unknown;
        };

        // Codex Bundle 5 Q3 — Input validation.
        // id: slug-only (letters, digits, dash, underscore, colon). Max 128 chars.
        // yaml: max 1 MiB.
        // source: enum.
        // scope_path: must be absolute + no '..' segments.
        // tags: array of strings if provided.
        if (typeof body.id !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(body.id)) {
          return Response.json({ error: 'id must be 1-128 chars of [A-Za-z0-9_:.-]' }, { status: 400 });
        }
        if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 256) {
          return Response.json({ error: 'name must be a string 1-256 chars' }, { status: 400 });
        }
        if (typeof body.yaml !== 'string' || body.yaml.length === 0) {
          return Response.json({ error: 'yaml must be a non-empty string' }, { status: 400 });
        }
        const MAX_YAML_BYTES = 1024 * 1024;
        if (Buffer.byteLength(body.yaml, 'utf8') > MAX_YAML_BYTES) {
          return Response.json({ error: `yaml exceeds ${MAX_YAML_BYTES} bytes` }, { status: 413 });
        }
        const source = body.source ?? 'project';
        if (source !== 'project' && source !== 'user' && source !== 'bundled') {
          return Response.json({ error: "source must be 'project' | 'user' | 'bundled'" }, { status: 400 });
        }
        if (body.scope_path !== undefined) {
          if (typeof body.scope_path !== 'string' || !body.scope_path.startsWith('/') || body.scope_path.includes('..')) {
            return Response.json({ error: 'scope_path must be absolute and contain no .. segments' }, { status: 400 });
          }
        }
        if (body.description !== undefined && typeof body.description !== 'string') {
          return Response.json({ error: 'description must be a string when provided' }, { status: 400 });
        }
        if (body.version !== undefined && typeof body.version !== 'string') {
          return Response.json({ error: 'version must be a string when provided' }, { status: 400 });
        }
        if (body.tags !== undefined) {
          if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
            return Response.json({ error: 'tags must be a string[] when provided' }, { status: 400 });
          }
        }

        if (body.expected_checksum !== undefined && typeof body.expected_checksum !== 'string') {
          return Response.json({ error: 'expected_checksum must be a string when provided' }, { status: 400 });
        }

        // Plugin parses and validates YAML server-side; surfaces 409/422 errors.
        try {
          const def = await engine.upsertDefinition(
            body.yaml as string,
            typeof body.scope_path === 'string' ? body.scope_path : undefined,
            {
              id: body.id as string,
              name: body.name as string,
              ...(typeof body.expected_checksum === 'string' ? { expected_checksum: body.expected_checksum } : {}),
            },
          );
          return Response.json({ definition: def });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as { status?: number }).status;
          if (status === 409) return Response.json({ error: msg }, { status: 409 });
          return Response.json({ error: msg }, { status: 422 });
        }
},
    },
  },
});
