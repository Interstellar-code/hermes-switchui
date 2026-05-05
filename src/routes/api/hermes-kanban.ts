import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  createKanbanTask,
  getKanbanBoard,
} from '../../server/hermes-kanban-client'

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/hermes-kanban')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }
        try {
          const url = new URL(request.url)
          const tenant = url.searchParams.get('tenant') || undefined
          const includeArchived =
            url.searchParams.get('include_archived') === 'true'
          const board = await getKanbanBoard({ tenant, includeArchived })
          return jsonResponse({ board })
        } catch (error) {
          return jsonResponse(
            {
              error:
                error instanceof Error ? error.message : 'Failed to fetch kanban',
            },
            502,
          )
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }
        try {
          const body = (await request.json()) as Record<string, unknown>
          if (!body.title || typeof body.title !== 'string') {
            return jsonResponse({ error: 'title is required' }, 400)
          }
          const result = await createKanbanTask({
            title: body.title,
            body: typeof body.body === 'string' ? body.body : null,
            assignee:
              body.assignee === null || typeof body.assignee === 'string'
                ? body.assignee
                : null,
            tenant: typeof body.tenant === 'string' ? body.tenant : null,
            priority: typeof body.priority === 'number' ? body.priority : undefined,
            workspace_kind:
              typeof body.workspace_kind === 'string'
                ? body.workspace_kind
                : null,
            workspace_path:
              typeof body.workspace_path === 'string'
                ? body.workspace_path
                : null,
            triage: body.triage === true,
            idempotency_key:
              typeof body.idempotency_key === 'string'
                ? body.idempotency_key
                : undefined,
          })
          return jsonResponse(result, 201)
        } catch {
          return jsonResponse({ error: 'Invalid request body' }, 400)
        }
      },
    },
  },
})
