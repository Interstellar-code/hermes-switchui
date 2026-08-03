import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  createProject,
  explicitProjectProfile,
  listProjects,
  projectsErrorStatus,
} from '../../../server/projects-client'
import type { CreateProjectInput } from '@/lib/projects-types'

export const Route = createFileRoute('/api/hermes-projects/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const includeArchived =
          url.searchParams.get('include_archived') === 'true'
        const profile = explicitProjectProfile(request)
        try {
          const result = await listProjects(includeArchived, profile)
          return Response.json(result)
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : 'Dashboard unavailable'
          return Response.json(
            { error: msg, mode: 'dashboard-unavailable' },
            { status: 503 },
          )
        }
      },
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: CreateProjectInput
        try {
          body = (await request.json()) as CreateProjectInput
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          return Response.json(await createProject(body, explicitProjectProfile(request)))
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Create failed'
          return Response.json(
            { error: msg },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
