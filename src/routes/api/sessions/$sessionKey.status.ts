import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
  toSessionSummary,
} from '../../../server/hermes-api'

export const Route = createFileRoute('/api/sessions/$sessionKey/status')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return Response.json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const { sessionKey } = params

        if (!sessionKey || sessionKey.trim().length === 0) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        try {
          const session = await getSession(sessionKey)
          const result = toSessionSummary(session)
          return Response.json({
            ok: true,
            status: result.status ?? 'idle',
            ...result,
          })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
