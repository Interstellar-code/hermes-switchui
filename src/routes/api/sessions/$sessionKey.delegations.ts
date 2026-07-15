import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readDelegationsForParent } from '../../../server/delegations'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
} from '../../../server/hermes-api'

export const Route = createFileRoute('/api/sessions/$sessionKey/delegations')({
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

        const sessionKey = params.sessionKey.trim()
        if (!sessionKey) {
          return Response.json({ ok: false, error: 'sessionKey required' }, { status: 400 })
        }

        try {
          // Resolve the UI session key to its gateway session id (the value stored
          // as parent_session_id on delegated child sessions).
          const session = await getSession(sessionKey)
          const delegations = readDelegationsForParent(session.id)
          return Response.json({ ok: true, delegations })
        } catch (err) {
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
