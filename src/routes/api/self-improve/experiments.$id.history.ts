import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getExperimentHistory } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/experiments/$id/history')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const id = Number(params.id)
        if (!Number.isInteger(id) || id <= 0) {
          return Response.json({ error: 'Invalid experiment id' }, { status: 400 })
        }
        try {
          const history = await getExperimentHistory(id)
          return Response.json(history)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          const status =
            msg.includes('404') || msg.includes('not found') ? 404 : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
