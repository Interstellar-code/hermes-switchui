import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { ensureGatewayProbed } from '../../../server/gateway-capabilities'
import { classifySlashFailure } from '../../../server/hermes-slash-exec'
import { compressChatSession } from '../../../server/session-compress'

/**
 * `POST /api/sessions/:sessionKey/compress` — compress this chat's context.
 *
 * The one place bare `/compress` runs: the general exec route refuses it
 * because it can rotate the session. This route owns that consequence by
 * reporting the continuation so the client can follow it.
 *
 * Response: `{ ok: true, output, continuationKey: string | null }`.
 */
export const Route = createFileRoute('/api/sessions/$sessionKey/compress')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const sessionKey = params.sessionKey.trim()
        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.agentCommands) {
          return Response.json(
            { ok: false, error: 'Agent commands unavailable' },
            { status: 503 },
          )
        }

        try {
          const result = await compressChatSession(sessionKey)
          return Response.json({ ok: true, ...result })
        } catch (error) {
          const failure = classifySlashFailure(error)
          return Response.json(
            { ok: false, error: failure.message, kind: failure.kind },
            { status: failure.status },
          )
        }
      },
    },
  },
})
