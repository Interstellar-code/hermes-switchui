import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { proposeExperiment } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/propose')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { profile?: string }
        try {
          body = (await request.json()) as { profile?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.profile || typeof body.profile !== 'string') {
          return Response.json({ error: 'profile is required' }, { status: 400 })
        }
        try {
          const result = await proposeExperiment(body.profile)
          // 200 = skipped, 202 = new experiment queued — mirror the plugin contract
          const status = 'skipped' in result ? 200 : 202
          return Response.json(result, { status })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          return Response.json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
