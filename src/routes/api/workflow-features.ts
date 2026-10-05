/**
 * GET /api/workflow-features
 *
 * Backend feature detection for the workflow-engine plugin. Missing or
 * unreachable plugin degrades to `features: []` so the UI can gate on it.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'

export const Route = createFileRoute('/api/workflow-features')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const health = await getEngine()
          .health()
          .catch(() => null)
        return Response.json({
          features: Array.isArray(health?.features) ? health.features : [],
          schedulerAlive: health?.scheduler_alive === true,
          profile: typeof health?.profile === 'string' ? health.profile : null,
        })
      },
    },
  },
})
