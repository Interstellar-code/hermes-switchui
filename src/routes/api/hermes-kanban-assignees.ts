import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getKanbanAssignees,
} from '../../server/hermes-kanban-client'
import { normalizeKanbanAssignee } from '../../lib/hermes-kanban-types'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/hermes-kanban-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }
        try {
          const payload = await getKanbanAssignees()
          const raw = Array.isArray(payload.assignees) ? payload.assignees : []
          const assignees = raw
            .filter(
              (value): value is Parameters<typeof normalizeKanbanAssignee>[0] =>
                Boolean(
                  value &&
                    typeof value === 'object' &&
                    typeof (value as { name?: unknown }).name === 'string',
                ),
            )
            .map(normalizeKanbanAssignee)
          return jsonResponse({ assignees })
        } catch (error) {
          return jsonResponse(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to fetch kanban assignees',
            },
            502,
          )
        }
      },
    },
  },
})
