import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  archiveProject,
  projectsErrorStatus,
} from '../../../server/projects-client'

export const Route = createFileRoute('/api/hermes-projects/$id/archive')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        try {
          return Response.json(await archiveProject(params.id))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Archive failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
