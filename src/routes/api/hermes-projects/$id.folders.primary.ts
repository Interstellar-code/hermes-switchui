import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  projectsErrorStatus,
  setPrimaryProjectFolder,
} from '../../../server/projects-client'

export const Route = createFileRoute(
  '/api/hermes-projects/$id/folders/primary',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        let body: { path?: string }
        try {
          body = (await request.json()) as { path?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          return Response.json(
            await setPrimaryProjectFolder(params.id, body.path ?? ''),
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Set primary failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
