import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { latestMetrics } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/metrics/latest')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const metrics = await latestMetrics()
          return Response.json({ metrics })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          return Response.json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },
    },
  },
})
