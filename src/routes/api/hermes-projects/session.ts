import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  bindSessionProject,
  projectsErrorStatus,
  resolveSessionProject,
  unbindSessionProject,
} from '../../../server/projects-client'

function sessionKeyFrom(request: Request): string {
  return new URL(request.url).searchParams.get('sessionKey')?.trim() ?? ''
}

function invalidSessionKey() {
  return Response.json({ error: 'sessionKey is required' }, { status: 400 })
}

export const Route = createFileRoute('/api/hermes-projects/session')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const sessionKey = sessionKeyFrom(request)
        if (!sessionKey) return invalidSessionKey()
        try {
          return Response.json(await resolveSessionProject(sessionKey))
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Resolve failed' },
            { status: projectsErrorStatus(err) },
          )
        }
      },
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const sessionKey = sessionKeyFrom(request)
        if (!sessionKey) return invalidSessionKey()
        let projectSlug = ''
        try {
          const body = (await request.json()) as { project_slug?: unknown }
          projectSlug =
            typeof body.project_slug === 'string'
              ? body.project_slug.trim()
              : ''
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!projectSlug) {
          return Response.json(
            { error: 'project_slug is required' },
            { status: 400 },
          )
        }
        try {
          return Response.json(
            await bindSessionProject(sessionKey, projectSlug),
          )
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Bind failed' },
            { status: projectsErrorStatus(err) },
          )
        }
      },
      DELETE: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const sessionKey = sessionKeyFrom(request)
        if (!sessionKey) return invalidSessionKey()
        try {
          return Response.json(await unbindSessionProject(sessionKey))
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Unbind failed' },
            { status: projectsErrorStatus(err) },
          )
        }
      },
    },
  },
})
