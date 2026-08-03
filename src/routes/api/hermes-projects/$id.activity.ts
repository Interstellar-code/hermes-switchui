import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  explicitProjectProfile,
  getProjectActivity,
  projectsErrorStatus,
} from '../../../server/projects-client'

export const Route = createFileRoute('/api/hermes-projects/$id/activity')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const limitParam = url.searchParams.get('limit')
          const cursor = url.searchParams.get('cursor')
          const result = await getProjectActivity(params.id, {
            limit: limitParam != null ? Number(limitParam) : undefined,
            cursor,
          }, explicitProjectProfile(request))
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Not found'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
