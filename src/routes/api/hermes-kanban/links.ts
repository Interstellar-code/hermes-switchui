import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { addKanbanLink, deleteKanbanLink } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/links')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { parent_id?: string; child_id?: string }
        try {
          body = (await request.json()) as { parent_id?: string; child_id?: string }
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (typeof body.parent_id !== 'string' || typeof body.child_id !== 'string') {
          return json({ error: 'parent_id and child_id are required' }, { status: 400 })
        }
        try {
          const result = await addKanbanLink(body.parent_id, body.child_id)
          return json(result, { status: 201 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to add link'
          const status = msg.includes('400') || msg.includes('cycle') ? 400 : 503
          return json({ error: msg }, { status })
        }
      },

      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const parentId = url.searchParams.get('parent_id')
        const childId = url.searchParams.get('child_id')
        if (!parentId || !childId) {
          return json({ error: 'parent_id and child_id query params are required' }, { status: 400 })
        }
        try {
          const result = await deleteKanbanLink(parentId, childId)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to delete link'
          return json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
