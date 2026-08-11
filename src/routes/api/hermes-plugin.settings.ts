/**
 * POST /api/hermes-plugin/settings — forwards allowlisted frontend settings
 * to the Hermes dashboard plugin. Never accepts a target URL from the request.
 *
 * CSRF-guarded via requireJsonContentType. Auth-gated via isAuthenticated.
 *
 * NOTE: this route currently has no in-app caller. The Settings saver used to
 * mirror six `hermes.*` localStorage keys here after every save; that mirror was
 * removed because five of the six keys were dead controls and the sixth sent a
 * font *family* into a field named `fontSize`. The route and `forwardSettings`
 * are kept (both are tested) pending re-homing onto the studio-settings store.
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
