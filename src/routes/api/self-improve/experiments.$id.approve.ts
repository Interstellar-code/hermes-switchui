import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { approveExperiment } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/experiments/$id/approve')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const id = Number(params.id)
        if (!Number.isInteger(id) || id <= 0) {
          return Response.json({ error: 'Invalid experiment id' }, { status: 400 })
        }
        let body: { actor?: string }
        try {
          body = (await request.json()) as { actor?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const actor = body.actor ?? 'switchui-user'
        try {
          const result = await approveExperiment(id, actor)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          const status = msg.includes('422') ? 422 : msg.includes('404') || msg.includes('not found') ? 404 : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
