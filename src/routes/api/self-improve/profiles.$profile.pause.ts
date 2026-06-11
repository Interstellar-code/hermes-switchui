import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { pauseProfile } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/profiles/$profile/pause')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const profile = params.profile
        if (!profile) {
          return Response.json({ error: 'profile param required' }, { status: 400 })
        }
        try {
          const result = await pauseProfile(profile)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          const status = msg.includes('404') || msg.includes('not found') ? 404 : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
