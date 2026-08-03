import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
} from '../../../server/hermes-api'
import { gatewayFetch } from '../../../server/gateway-capabilities'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../../server/profile-scope'

export const Route = createFileRoute('/api/sessions/$sessionKey/clarify')({
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
        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        let body: { clarify_id?: string; answer?: string; profile?: string }
        try {
          body = (await request.json()) as {
            clarify_id?: string
            answer?: string
            profile?: string
          }
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const { clarify_id, answer } = body
        if (!clarify_id) {
          return Response.json(
            { ok: false, error: 'clarify_id_required' },
            { status: 400 },
          )
        }

        // Fail closed before resolving the session — the raw ID below is only
        // meaningful inside the profile it came from.
        const profile = readProfile(body.profile)
        try {
          if (profile) await assertProfileServed(profile)
        } catch (err) {
          if (!isProfileScopeError(err)) throw err
          return Response.json(
            { ok: false, error: (err as Error).message },
            { status: profileErrorStatus(err) },
          )
        }

        try {
          const session = await getSession(sessionKey, profile)
          const sessionId = session.id

          // POST to gateway to resume the blocked turn. gatewayFetch() reads
          // the live CLAUDE_API and the single listener key — the previous
          // env-only resolution here hardcoded :8642 and missed runtime port
          // discovery.
          const res = await gatewayFetch(
            await scopedPath(
              `/api/sessions/${sessionId}/chat/clarify`,
              profile,
            ),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clarify_id, answer }),
              signal: AbortSignal.timeout(15_000),
            },
          )

          const json = await res.json()
          return Response.json(json, { status: res.ok ? 200 : res.status })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, error: (err as Error).message },
              { status: profileErrorStatus(err) },
            )
          }
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
