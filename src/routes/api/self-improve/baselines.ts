import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listBaselines } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/baselines')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile') ?? undefined
        try {
          const baselines = await listBaselines({ profile })
          return Response.json({ baselines })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          return Response.json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },
    },
  },
})
