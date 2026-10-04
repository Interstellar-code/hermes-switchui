import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listScheduledWorkflows } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/scheduled')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        // listScheduledWorkflows degrades internally; never 500.
        return Response.json(await listScheduledWorkflows())
      },
    },
  },
})
