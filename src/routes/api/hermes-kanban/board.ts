import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanBoard } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/board')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const tenant = url.searchParams.get('tenant') ?? undefined
        const includeArchived = url.searchParams.get('include_archived') === 'true'
        try {
          const board = await getKanbanBoard({ tenant, includeArchived })
          return json({ board })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Dashboard unavailable'
          return json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },
    },
  },
})
