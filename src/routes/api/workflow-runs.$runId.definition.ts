/**
 * GET /api/workflow-runs/:runId/definition
 *
 * Thin proxy for the plugin's pinned-definition endpoint (feature `definition_pin`).
 * A plugin without it (or an unknown run) answers 404 → `{ available: false }`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { dashboardFetch } from '../../server/gateway-capabilities'

export const Route = createFileRoute('/api/workflow-runs/$runId/definition')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const res = await dashboardFetch(
            `/api/plugins/workflow-engine/runs/${encodeURIComponent(params.runId)}/definition`,
          )
          if (res.status === 404) return Response.json({ available: false })
          if (!res.ok) {
            return Response.json(
              { error: 'Failed to load definition' },
              { status: 502 },
            )
          }
          return Response.json({ available: true, ...(await res.json()) })
        } catch {
          return Response.json(
            { error: 'Failed to load definition' },
            { status: 502 },
          )
        }
      },
    },
  },
})
