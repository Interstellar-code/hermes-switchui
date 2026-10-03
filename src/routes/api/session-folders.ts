import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  explicitProjectProfile,
  getSessionProjectMap,
  projectsErrorStatus,
} from '../../server/projects-client'
import { isValidProfileName } from '../../lib/profile-name'

export const Route = createFileRoute('/api/session-folders')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const profile = explicitProjectProfile(request)
        if (profile && !isValidProfileName(profile)) {
          return Response.json(
            { ok: false, error: 'Invalid profile' },
            { status: 400 },
          )
        }
        try {
          const result = await getSessionProjectMap(
            profile,
            request.headers.get('if-none-match') ?? undefined,
          )
          const headers: Record<string, string> = {
            'Cache-Control': 'no-cache',
          }
          if (result.etag) headers.ETag = result.etag
          if (result.notModified)
            return new Response(null, { status: 304, headers })
          return Response.json({ ok: true, ...result.map }, { headers })
        } catch (err) {
          const status = projectsErrorStatus(err)
          return Response.json(
            {
              ok: false,
              error:
                err instanceof Error ? err.message : 'Dashboard unavailable',
            },
            { status: status === 400 || status === 404 ? status : 503 },
          )
        }
      },
    },
  },
})
