import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  readKnowledgeBaseConfig,
  writeKnowledgeBaseConfig,
  type KnowledgeBaseConfig,
} from '../../../server/knowledge-config'

export const Route = createFileRoute('/api/knowledge/config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return Response.json({ config: readKnowledgeBaseConfig() })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to read knowledge base config',
            },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as Partial<KnowledgeBaseConfig>
          const current = readKnowledgeBaseConfig()
          const next: KnowledgeBaseConfig = {
            source: body.source ?? current.source,
          }
          writeKnowledgeBaseConfig(next)
          return Response.json({ config: next })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to save knowledge base config',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
