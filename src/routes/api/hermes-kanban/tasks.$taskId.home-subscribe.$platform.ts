import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { subscribeKanbanHomeChannel, unsubscribeKanbanHomeChannel } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute(
  '/api/hermes-kanban/tasks/$taskId/home-subscribe/$platform',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await subscribeKanbanHomeChannel(params.taskId, params.platform)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Subscribe failed'
          const status = msg.includes('404') || msg.includes('not found') ? 404 : 503
          return json({ error: msg }, { status })
        }
      },

      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await unsubscribeKanbanHomeChannel(params.taskId, params.platform)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unsubscribe failed'
          const status = msg.includes('404') || msg.includes('not found') ? 404 : 503
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
