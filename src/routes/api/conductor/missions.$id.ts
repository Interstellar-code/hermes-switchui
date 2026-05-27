import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getMission } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/missions/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const { id } = params
        if (!id) {
          return Response.json({ error: 'id required' }, { status: 400 })
        }
        try {
          const mission = await getMission(request, id)
          if (!mission) {
            return Response.json({ error: 'Mission not found' }, { status: 404 })
          }
          return Response.json(mission)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to get mission',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
