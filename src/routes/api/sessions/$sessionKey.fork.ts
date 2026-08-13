import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  forkSession,
  toSessionSummary,
} from '../../../server/hermes-api'
import { getLocalSession } from '../../../server/local-session-store'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
} from '../../../server/profile-scope'

/**
 * POST /api/sessions/:sessionKey/fork — branch a session.
 *
 * Thin wrapper over the gateway's `POST /api/sessions/{id}/fork`. The gateway
 * does the whole job: it ends the source session with `end_reason: "branched"`,
 * creates a child with `parent_session_id` pointing back at it, copies the
 * transcript, inherits any project binding, and auto-numbers the title within
 * the lineage. Nothing here needs to replicate that.
 */
export const Route = createFileRoute('/api/sessions/$sessionKey/fork')({
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

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
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

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >

        // Fail closed before anything is written. A fork is a create AND an
        // end_session on the source, so a profile that cannot be proven
        // routable must never reach the gateway — a `/p/` prefix on a
        // non-multiplexing gateway returns 200 while branching whatever
        // session shares that ID in the active profile's state.db.
        // (Same ordering as sessions.ts POST/PATCH/DELETE.)
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

        // Local sessions live in the workspace portable store and have no
        // gateway row to branch from.
        if (getLocalSession(sessionKey)) {
          return Response.json(
            {
              ok: false,
              error: 'Local sessions cannot be branched.',
            },
            { status: 400 },
          )
        }

        try {
          // The key goes to the gateway as-is, exactly like DELETE
          // /api/sessions — SwitchUI's session keys ARE gateway session ids
          // (toSessionSummary sets `key: session.id`). A getSession() hop to
          // "resolve" it first would route through the unscoped dashboard,
          // which 404s for gateway-owned rows it does not carry — verified
          // live: a session the gateway had just created was invisible to
          // :9119, so pre-resolving would have failed the fork before trying.
          const result = await forkSession(sessionKey, profile)
          const forked = result.session

          return Response.json({
            ok: true,
            sessionKey: forked.id,
            friendlyId: forked.id,
            forkedFrom: forked.parent_session_id ?? sessionKey,
            entry: toSessionSummary(forked),
          })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, error: (err as Error).message },
              { status: profileErrorStatus(err) },
            )
          }
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes(': 404')) {
            return Response.json(
              { ok: false, error: `Session not found: ${sessionKey}` },
              { status: 404 },
            )
          }
          return Response.json({ ok: false, error: msg }, { status: 500 })
        }
      },
    },
  },
})
