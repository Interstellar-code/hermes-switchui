import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  DelegationProfileUnavailableError,
  readDelegationsForParent,
} from '../../../server/delegations'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
} from '../../../server/hermes-api'
import {
  isProfileScopeError,
  profileErrorStatus,
} from '../../../server/profile-scope'

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
        if (!sessionKey || sessionKey === 'new') {
          return Response.json({ ok: true, delegations: [] })
        }

        const profile = new URL(request.url).searchParams.get('profile')?.trim() || null

        try {
          // Resolve the UI session key to its gateway session id (the value stored
          // as parent_session_id on delegated child sessions).
          const session = await getSession(sessionKey, profile)
          const delegations = readDelegationsForParent(session.id, profile)
          return Response.json({ ok: true, delegations })
        } catch (err) {
          if (err instanceof DelegationProfileUnavailableError) {
            return Response.json(
              { ok: false, unavailable: true, error: err.message, profile: err.profile },
              { status: 409 },
            )
          }
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, unavailable: true, error: (err as Error).message, profile },
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
