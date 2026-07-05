import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
} from '@/server/hermes-api'

export const Route = createFileRoute(
  '/api/sessions/$sessionKey/chat/interactions/$interactionId/respond',
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }

        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return Response.json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const sessionKey = params.sessionKey.trim()
        const interactionId = params.interactionId.trim()
        if (!sessionKey || !interactionId) {
          return Response.json(
            { ok: false, error: 'sessionKey and interactionId required' },
            { status: 400 },
          )
        }

        let body: { answer?: string; response?: string }
        try {
          body = (await request.json()) as { answer?: string; response?: string }
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        try {
          const session = await getSession(sessionKey)
          const gatewayUrl =
            process.env.HERMES_API_URL ||
            process.env.CLAUDE_API_URL ||
            'http://127.0.0.1:8642'
          const gatewayToken =
            process.env.HERMES_API_TOKEN || process.env.CLAUDE_API_TOKEN || ''

          const res = await fetch(
            `${gatewayUrl}/api/sessions/${session.id}/chat/interactions/${encodeURIComponent(interactionId)}/respond`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(gatewayToken
                  ? { Authorization: `Bearer ${gatewayToken}` }
                  : {}),
              },
              body: JSON.stringify({
                answer: body.answer ?? body.response ?? '',
              }),
              signal: AbortSignal.timeout(15_000),
            },
          )

          const json = await res.json().catch(() => ({ ok: res.ok }))
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
