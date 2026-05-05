import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { createKanbanTask } from '../../../server/hermes-kanban-client'
import type { CreateKanbanTaskInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/tasks')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: CreateKanbanTaskInput
        try {
          body = (await request.json()) as CreateKanbanTaskInput
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.title || typeof body.title !== 'string') {
          return json({ error: 'title is required' }, { status: 400 })
        }
        try {
          const result = await createKanbanTask(body)
          return json(result, { status: 201 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create task'
          const status = msg.includes('422') ? 422 : msg.includes('400') ? 400 : 503
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
