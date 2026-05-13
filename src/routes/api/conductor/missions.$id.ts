import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getMission } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/missions/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const { id } = params
        if (!id) {
          return json({ error: 'id required' }, { status: 400 })
        }
        try {
          const mission = await getMission(id)
          if (!mission) {
            return json({ error: 'Mission not found' }, { status: 404 })
          }
          return json(mission)
        } catch (error) {
          return json(
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
