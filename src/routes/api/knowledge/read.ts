import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readKnowledgePage } from '../../../server/knowledge-browser'
import { isMemoryProfile } from '../../../server/memory-profile'

export const Route = createFileRoute('/api/knowledge/read')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const pathParam = url.searchParams.get('path') || ''
        const profile = url.searchParams.get('profile') ?? undefined
        if (profile !== undefined && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        try {
          const { meta, content, raw, backlinks, links } = readKnowledgePage(
            pathParam,
            profile,
          )
          return Response.json({ page: meta, content, raw, backlinks, links })
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
