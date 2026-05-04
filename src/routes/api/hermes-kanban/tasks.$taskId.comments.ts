import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { addKanbanComment } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/tasks/$taskId/comments')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { body?: string; author?: string }
        try {
          body = (await request.json()) as { body?: string; author?: string }
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.body || typeof body.body !== 'string' || !body.body.trim()) {
          return json({ error: 'Comment body must not be empty' }, { status: 400 })
        }
        try {
          const result = await addKanbanComment(params.taskId, {
            body: body.body.trim(),
            author: body.author ?? 'SwitchUI',
          })
          return json(result, { status: 201 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add comment'
          return json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
