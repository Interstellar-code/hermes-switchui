import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanConfig } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const data = await getKanbanConfig()
          return Response.json(data)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Config unavailable'
          return Response.json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
