import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  knowledgeRootExists,
  listKnowledgePages,
} from '../../../server/knowledge-browser'
import { readKnowledgeBaseConfig } from '../../../server/knowledge-config'
import { isMemoryProfile } from '../../../server/memory-profile'

export const Route = createFileRoute('/api/knowledge/list')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const profile =
          new URL(request.url).searchParams.get('profile') ?? undefined
        if (profile !== undefined && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        try {
          const config = readKnowledgeBaseConfig()
          const source = config.source
          const exists = knowledgeRootExists(profile)
          return Response.json({
            pages: exists ? listKnowledgePages(profile) : [],
            exists,
            source,
          })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list knowledge pages',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
