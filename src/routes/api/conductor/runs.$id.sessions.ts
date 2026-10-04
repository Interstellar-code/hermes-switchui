import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getEngine } from '../../../server/workflow-engine/factory'

/** `available: false` = the backend lacks the run-sessions endpoint (404). */
export const Route = createFileRoute('/api/conductor/runs/$id/sessions')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const data = await getEngine().getRunSessions(params.id)
          return Response.json({ available: data != null, data })
        } catch (error) {
          return Response.json(
            {
              available: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to get run sessions',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})
