import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { deleteScenario } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/scenarios/$id')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const id = Number(params.id)
        if (!Number.isInteger(id) || id <= 0) {
          return Response.json(
            { error: 'Invalid scenario id' },
            { status: 400 },
          )
        }
        try {
          const result = await deleteScenario(id)
          return Response.json(result)
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Self-Improve plugin unavailable'
          const status =
            msg.includes('404') || msg.includes('not found') ? 404 : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
