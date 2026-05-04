import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanAssignees } from '../../../server/hermes-kanban-client'
import {
  normalizeKanbanAssignee,
  type HermesKanbanAssigneeRaw,
} from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const raw = await getKanbanAssignees()
          const assignees = (raw.assignees as HermesKanbanAssigneeRaw[]).map(
            normalizeKanbanAssignee,
          )
          return json({ assignees })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Assignees unavailable'
          return json({ error: msg, assignees: [] }, { status: 503 })
        }
      },
    },
  },
})
