import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  bindSessionProject,
  explicitProjectProfile,
  projectsErrorStatus,
  resolveSessionProject,
  unbindSessionProject,
} from '../../../server/projects-client'
import { isPlaceholderSessionKey } from '../../../lib/projects-types'

/** '' when missing or a placeholder (`new`) — callers answer 400. */
function sessionKeyFrom(request: Request): string {
  const key = new URL(request.url).searchParams.get('sessionKey')?.trim() ?? ''
  return isPlaceholderSessionKey(key) ? '' : key
}

function invalidSessionKey() {
  return Response.json(
    { error: 'sessionKey is required (not a placeholder)' },
    { status: 400 },
  )
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
          return Response.json(
            await resolveSessionProject(
              sessionKey,
              explicitProjectProfile(request),
            ),
          )
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
            await bindSessionProject(
              sessionKey,
              projectSlug,
              explicitProjectProfile(request),
            ),
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
          return Response.json(
            await unbindSessionProject(
              sessionKey,
              explicitProjectProfile(request),
            ),
          )
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
