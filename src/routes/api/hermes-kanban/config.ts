import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanConfig } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const data = await getKanbanConfig()
          return json(data)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Config unavailable'
          return json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
