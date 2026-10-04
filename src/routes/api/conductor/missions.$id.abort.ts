import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { abortMission } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/missions/$id/abort')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const { id } = params
        if (!id) {
          return Response.json({ error: 'id required' }, { status: 400 })
        }
        try {
          await abortMission(id)
          return Response.json({ ok: true })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          // PluginClient errors read "PluginClient POST /path: <status> <body>"
          const upstream = Number(/: (\d{3})\b/.exec(msg)?.[1])
          let status = upstream >= 400 && upstream < 600 ? upstream : 500
          // Upstream auth failures are a gateway problem, not the caller's.
          if (status === 401 || status === 403) status = 502
          console.error('[conductor] abort failed:', msg)
          return Response.json({ error: 'Failed to abort mission' }, { status })
        }
      },
    },
  },
})
