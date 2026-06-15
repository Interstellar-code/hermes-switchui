import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
  SESSIONS_API_UNAVAILABLE_MESSAGE,
} from '../../../server/hermes-api'

export const Route = createFileRoute('/api/sessions/$sessionKey/clarify')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
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

        const sessionKey = params.sessionKey?.trim()
        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        let body: { clarify_id?: string; answer?: string }
        try {
          body = (await request.json()) as { clarify_id?: string; answer?: string }
        } catch {
          return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
        }

        const { clarify_id, answer } = body
        if (!clarify_id) {
          return Response.json(
            { ok: false, error: 'clarify_id_required' },
            { status: 400 },
          )
        }

        try {
          const session = await getSession(sessionKey)
          const sessionId = session.id

          // POST to gateway to resume the blocked turn
          const gatewayUrl =
            process.env.HERMES_API_URL ||
            process.env.CLAUDE_API_URL ||
            'http://127.0.0.1:8642'
          const gatewayToken =
            process.env.HERMES_API_TOKEN || process.env.CLAUDE_API_TOKEN || ''

          const res = await fetch(
            `${gatewayUrl}/api/sessions/${sessionId}/chat/clarify`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {}),
              },
              body: JSON.stringify({ clarify_id, answer }),
              signal: AbortSignal.timeout(15_000),
            },
          )

          const json = await res.json()
          return Response.json(json, { status: res.ok ? 200 : res.status })
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
