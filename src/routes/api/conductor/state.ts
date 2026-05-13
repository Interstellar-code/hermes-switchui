import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getConductorState } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/state')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const state = await getConductorState()
          return json(state)
        } catch (error) {
          return json(
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
