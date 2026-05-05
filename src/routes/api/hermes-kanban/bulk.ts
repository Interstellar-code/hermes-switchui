import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { bulkUpdateKanbanTasks } from '../../../server/hermes-kanban-client'
import type { BulkKanbanInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/bulk')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: BulkKanbanInput
        try {
          body = (await request.json()) as BulkKanbanInput
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!Array.isArray(body.ids) || body.ids.length === 0) {
          return json({ error: 'ids must be a non-empty array' }, { status: 400 })
        }
        try {
          const result = await bulkUpdateKanbanTasks(body)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Bulk update failed'
          return json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
