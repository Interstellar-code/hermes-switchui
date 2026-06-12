/**
 * GET /api/hermes-plugin — returns the current HermesPluginSnapshot.
 * POST /api/hermes-plugin/settings — forwards allowlisted settings to the backend plugin.
 *
 * Always returns HTTP 200 for GET (degraded states are represented in the
 * response body, not via error status codes).
 *
 * POST settings target URL is never accepted from the request body.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getPluginSnapshot } from '../../server/hermes-plugin-sync'

export const Route = createFileRoute('/api/hermes-plugin')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const snapshot = await getPluginSnapshot()
        return Response.json(snapshot)
      },
    },
  },
})
