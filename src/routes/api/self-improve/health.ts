import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getHealth } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const health = await getHealth()
          return Response.json(health)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          return Response.json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },
    },
  },
})
