import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanTask, updateKanbanTask } from '../../../server/hermes-kanban-client'
import { hardDeleteKanbanTask } from '../../../server/kanban-backend'
import type { UpdateKanbanTaskInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/tasks/$taskId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const detail = await getKanbanTask(params.taskId)
          return json(detail)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Not found'
          const status = msg.includes('404') || msg.includes('not found') ? 404 : 503
          return json({ error: msg }, { status })
        }
      },

      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: UpdateKanbanTaskInput
        try {
          body = (await request.json()) as UpdateKanbanTaskInput
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          const result = await updateKanbanTask(params.taskId, body)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Update failed'
          const status = msg.includes('404') || msg.includes('not found') ? 404 : 503
          return json({ error: msg }, { status })
        }
      },

      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        // Gateway REST API has no DELETE — go directly to the kanban SQLite DB.
        const result = hardDeleteKanbanTask(params.taskId)
        if (!result.ok) {
          const status = result.error?.includes('not found') ? 404
            : result.error?.includes('Only archived') ? 422
              : 503
          return json({ error: result.error ?? 'Delete failed' }, { status })
        }
        return json({ ok: true })
      },
    },
  },
})
