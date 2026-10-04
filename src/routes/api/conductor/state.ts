import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getConductorSnapshot } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/state')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          // 1s memo: the top bar polls alongside the missions query.
          const { stats } = await getConductorSnapshot(1000)
          return Response.json(stats)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : 'Failed to get state',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
