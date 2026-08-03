import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  deleteProject,
  explicitProjectProfile,
  getProject,
  projectsErrorStatus,
  updateProject,
} from '../../../server/projects-client'
import type { UpdateProjectInput } from '@/lib/projects-types'

export const Route = createFileRoute('/api/hermes-projects/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await getProject(params.id, explicitProjectProfile(request))
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Not found'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        let body: UpdateProjectInput
        try {
          body = (await request.json()) as UpdateProjectInput
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          return Response.json(await updateProject(params.id, body, explicitProjectProfile(request)))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Update failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
      DELETE: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        try {
          return Response.json(await deleteProject(params.id, explicitProjectProfile(request)))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Delete failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
