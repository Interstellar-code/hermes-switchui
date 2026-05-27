import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanStats } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/stats')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const stats = await getKanbanStats()
          return Response.json({ stats })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stats unavailable'
          return Response.json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },
    },
  },
})
