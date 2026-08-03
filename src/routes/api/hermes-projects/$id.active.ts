import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  explicitProjectProfile,
  projectsErrorStatus,
  setActiveProject,
} from '../../../server/projects-client'

export const Route = createFileRoute('/api/hermes-projects/$id/active')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        try {
          return Response.json(await setActiveProject(params.id, explicitProjectProfile(request)))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Set active failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
