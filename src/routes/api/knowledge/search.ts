import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { searchKnowledgePages } from '../../../server/knowledge-browser'
import { isMemoryProfile } from '../../../server/memory-profile'

export const Route = createFileRoute('/api/knowledge/search')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const query = url.searchParams.get('q') || ''
        if (query.length > 500) {
          return Response.json(
            { error: 'q too long (max 500)' },
            { status: 400 },
          )
        }
        const profile = url.searchParams.get('profile') ?? undefined
        if (profile !== undefined && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        try {
          return Response.json({
            results: searchKnowledgePages(query, profile),
          })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to search knowledge pages',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
