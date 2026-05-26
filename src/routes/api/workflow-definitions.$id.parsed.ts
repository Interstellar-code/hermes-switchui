/**
 * GET /api/workflow-definitions/:id/parsed
 *
 * Thin pass-through to the plugin's parsed endpoint. The plugin owns YAML
 * parsing and DAG projection; this route just adds ETag caching.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/workflow-definitions/$id/parsed')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return json({ error: 'Unauthorized' }, 401)

        const engine = getEngine(request)
        const def = await engine.getDefinition(params.id)
        if (!def) return json({ error: 'not found' }, 404)

        const etag = `"${def.checksum}"`
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch && ifNoneMatch === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': 'private, max-age=30' },
          })
        }

        const parsed = await engine.parseDefinition(params.id)
        if (!parsed) return json({ error: 'parse failed' }, 422)

        return new Response(
          JSON.stringify({ definition: def, parsed }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ETag: etag,
              'Cache-Control': 'private, max-age=30',
            },
          },
        )
      },
    },
  },
})
