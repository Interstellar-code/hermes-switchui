import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { switchBoard } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/boards/$slug/switch')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await switchBoard(params.slug)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Switch failed'
          const status = msg.includes('400')
            ? 400
            : msg.includes('404')
              ? 404
              : 503
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
