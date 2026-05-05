import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanStats } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/stats')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const stats = await getKanbanStats()
          return json({ stats })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stats unavailable'
          return json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },
    },
  },
})
