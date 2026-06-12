/**
 * POST /api/hermes-plugin/settings — forwards allowlisted frontend settings
 * to the Hermes dashboard plugin. Never accepts a target URL from the request.
 *
 * CSRF-guarded via requireJsonContentType. Auth-gated via isAuthenticated.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { forwardSettings } from '../../server/hermes-plugin-sync'

export const Route = createFileRoute('/api/hermes-plugin/settings')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const result = await forwardSettings(body)
        return Response.json(result)
      },
    },
  },
})
