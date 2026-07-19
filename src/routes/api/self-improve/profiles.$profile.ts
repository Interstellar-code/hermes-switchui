import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getProfileStatus } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/profiles/$profile')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (!params.profile) {
          return Response.json(
            { error: 'profile param required' },
            { status: 400 },
          )
        }
        try {
          return Response.json(await getProfileStatus(params.profile))
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Self-Improve plugin unavailable'
          return Response.json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
