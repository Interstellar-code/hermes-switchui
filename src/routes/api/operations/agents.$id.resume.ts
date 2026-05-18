import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { CapabilityUnavailableError, resumeAgent } from '../../../server/operations-store'

export const Route = createFileRoute('/api/operations/agents/$id/resume')({
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
          await resumeAgent(id)
          return json({ ok: true })
        } catch (error) {
          if (error instanceof CapabilityUnavailableError) {
            return json({ available: false, error: error.message }, { status: 501 })
          }
          const msg = error instanceof Error ? error.message : String(error)
          const status = msg.includes('not found') ? 404 : 500
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
