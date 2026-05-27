import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { deleteBoard, updateBoard } from '../../../server/hermes-kanban-client'
import type { UpdateBoardInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/boards/$slug')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: UpdateBoardInput
        try {
          body = (await request.json()) as UpdateBoardInput
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          const result = await updateBoard(params.slug, body)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Update failed'
          const status = msg.includes('400')
            ? 400
            : msg.includes('404')
              ? 404
              : msg.includes('422')
                ? 422
                : 503
          return Response.json({ error: msg }, { status })
        }
      },

      DELETE: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const hardDelete = url.searchParams.get('delete') === 'true'
        try {
          const result = await deleteBoard(params.slug, hardDelete)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Delete failed'
          const status = msg.includes('400')
            ? 400
            : msg.includes('404')
              ? 404
              : msg.includes('422')
                ? 422
                : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
