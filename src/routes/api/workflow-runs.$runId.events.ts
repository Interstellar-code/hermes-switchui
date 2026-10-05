/**
 * GET /api/workflow-runs/:runId/events
 *
 * Thin proxy for the plugin's filtered events query. Passes through
 * node_run_id, type and after; limit is clamped to 1000. A plugin without
 * the endpoint (or an unknown run) surfaces as 404.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'

const MAX_LIMIT = 1000

export const Route = createFileRoute('/api/workflow-runs/$runId/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const rawLimit = Number(url.searchParams.get('limit'))
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
            : undefined
        try {
          const page = await getEngine().listRunEvents(params.runId, {
            limit,
            node_run_id: url.searchParams.get('node_run_id') || undefined,
            type: url.searchParams.get('type') || undefined,
            after: url.searchParams.get('after') || undefined,
          })
          return Response.json(page)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return Response.json(
            { error: msg },
            { status: msg.includes('404') ? 404 : 500 },
          )
        }
      },
    },
  },
})
