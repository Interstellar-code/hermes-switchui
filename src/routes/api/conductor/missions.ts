import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getConductorSnapshot } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/missions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return Response.json(await getConductorSnapshot())
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list missions',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
