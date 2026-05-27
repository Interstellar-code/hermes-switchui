import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readKnowledgePage } from '../../../server/knowledge-browser'

export const Route = createFileRoute('/api/knowledge/read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const pathParam = url.searchParams.get('path') || ''

        try {
          const { meta, content, backlinks } = readKnowledgePage(pathParam)
          return Response.json({ page: meta, content, backlinks })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to read knowledge page'
          const status =
            /not allowed|outside knowledge root|required|traversal/i.test(
              message,
            )
              ? 400
              : /ENOENT/.test(message)
                ? 404
                : 500
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
