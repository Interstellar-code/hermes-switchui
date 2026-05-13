import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { abortMission } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/missions/$id/abort')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const { id } = params
        if (!id) {
          return json({ error: 'id required' }, { status: 400 })
        }
        try {
          const mission = await abortMission(id)
          return json({ ok: true, mission })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          const status = msg.includes('not found') ? 404 : 500
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
