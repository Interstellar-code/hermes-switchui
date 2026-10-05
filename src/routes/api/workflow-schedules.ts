/**
 * GET /api/workflow-schedules — list engine schedules (?workflow_id optional).
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { dashboardFetch } from '../../server/gateway-capabilities'

const PLUGIN_BASE = '/api/plugins/workflow-engine'

export const Route = createFileRoute('/api/workflow-schedules')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const wid = new URL(request.url).searchParams.get('workflow_id')
        const qs = wid ? `?workflow_id=${encodeURIComponent(wid)}` : ''
        try {
          const res = await dashboardFetch(`${PLUGIN_BASE}/schedules${qs}`, {
            signal: AbortSignal.timeout(8000),
          })
          if (!res.ok) {
            return Response.json(
              { error: 'Schedules unavailable' },
              {
                status:
                  res.status === 404 || res.status === 501 ? res.status : 502,
              },
            )
          }
          return Response.json(await res.json())
        } catch {
          return Response.json(
            { error: 'Schedules unavailable' },
            { status: 502 },
          )
        }
      },
    },
  },
})
