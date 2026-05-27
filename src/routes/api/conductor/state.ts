import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getConductorState } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/state')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const state = await getConductorState(request)
          return Response.json(state)
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
