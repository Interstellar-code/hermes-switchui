import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { createBoard, listBoards } from '../../../server/hermes-kanban-client'
import type { CreateBoardInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/boards')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const includeArchived = url.searchParams.get('include_archived') === 'true'
        try {
          const result = await listBoards(includeArchived)
          return json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Dashboard unavailable'
          return json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: CreateBoardInput
        try {
          body = (await request.json()) as CreateBoardInput
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.slug || typeof body.slug !== 'string') {
          return json({ error: 'slug is required' }, { status: 400 })
        }
        try {
          const result = await createBoard(body)
          return json(result, { status: 201 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create board'
          const status = msg.includes('422') ? 422 : msg.includes('400') ? 400 : 503
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
