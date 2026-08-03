import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  sendChat,
} from '../../../server/hermes-api'
import { resolveSessionKey } from '../../../server/session-utils'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
} from '../../../server/profile-scope'

export const Route = createFileRoute('/api/sessions/send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.enhancedChat) {
          return Response.json(
            {
              ok: false,
              error: capabilities.dashboard.available
                ? 'Legacy session send is not supported in zero-fork mode. Use /api/send-stream.'
                : SESSIONS_API_UNAVAILABLE_MESSAGE,
            },
            { status: 503 },
          )
        }

        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const friendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const message = String(body.message ?? '').trim()

          if (!message) {
            return Response.json(
              { ok: false, error: 'message required' },
              { status: 400 },
            )
          }

          // Fail closed BEFORE the session is resolved or anything is sent —
          // same ordering as sessions.ts PATCH/DELETE and send-stream.ts:320.
          // `sendChat` already accepts a profile; without reading it here the
          // caller's scope was silently dropped and the message landed in
          // whatever profile the gateway runs on.
          const profile = readProfile(body.profile)
          if (profile) {
            try {
              await assertProfileServed(profile)
            } catch (err) {
              if (!isProfileScopeError(err)) throw err
              return Response.json(
                { ok: false, error: (err as Error).message },
                { status: profileErrorStatus(err) },
              )
            }
          }

          const { sessionKey } = await resolveSessionKey({
            rawSessionKey,
            friendlyId,
            defaultKey: 'main',
          })

          const idempotencyKey =
            typeof body.idempotencyKey === 'string' &&
            body.idempotencyKey.trim().length > 0
              ? body.idempotencyKey.trim()
              : randomUUID()

          const result = await sendChat(sessionKey, { message }, undefined, {
            profile,
          })

          return Response.json({
            ok: true,
            sessionKey,
            runId: result.run_id ?? idempotencyKey,
          })
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
