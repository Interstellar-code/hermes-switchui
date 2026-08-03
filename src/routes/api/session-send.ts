/**
 * ControlSuite-compatible session-send adapter.
 *
 * Operations sends { sessionKey, message } and expects { ok: true } quickly.
 * We forward to the local /api/send-stream endpoint and discard the body
 * (the Operations chat panel polls /api/history at 5s intervals to pick up
 * the reply, so we don't need to hold the stream open here).
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
} from '../../server/profile-scope'

export const Route = createFileRoute('/api/session-send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            sessionKey?: string
            message?: string
            profile?: string
          }
          const sessionKey = (body.sessionKey || '').trim()
          // Forward the profile or this whole panel sends unscoped. The check
          // also runs here, not just downstream: the fetch below is
          // fire-and-forget, so a scope rejection from /api/send-stream would
          // otherwise be discarded and reported to the caller as queued.
          const profile = readProfile(body.profile)
          const message = (body.message || '').trim()
          if (!sessionKey) {
            return Response.json(
              { ok: false, error: 'sessionKey is required' },
              { status: 400 },
            )
          }
          if (!message) {
            return Response.json(
              { ok: false, error: 'message is required' },
              { status: 400 },
            )
          }
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
          // Fire-and-forget: kick off the stream, then return. Operations
          // chat panel polls /api/session-history for new assistant turns.
          const url = new URL('/api/send-stream', request.url)
          const cookie = request.headers.get('cookie') || ''
          fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({
              sessionKey,
              message,
              ...(profile ? { profile } : {}),
            }),
          }).catch(() => {
            // swallow; UI discovers failures via next /api/session-history poll
          })
          return Response.json({ ok: true, sessionKey, queued: true })
        } catch (error) {
          return Response.json(
            {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to queue message',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
