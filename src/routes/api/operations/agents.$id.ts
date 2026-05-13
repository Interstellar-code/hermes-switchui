import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getAgent } from '../../../server/operations-store'

export const Route = createFileRoute('/api/operations/agents/$id')({
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
          const focus = await getAgent(id)
          if (!focus) {
            return json({ error: `Agent ${id} not found` }, { status: 404 })
          }
          return json(focus)
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : 'Failed to get agent' },
            { status: 500 },
          )
        }
      },
    },
  },
})
