/**
 * `GET /api/approvals/pending` — catch-up for blocking command approvals.
 *
 * Proxies the gateway's `GET /v1/approvals/pending` (approval contract v1 §3).
 * An approval is delivered exactly once on the chat stream and is never
 * re-emitted, so a browser refresh mid-approval would otherwise orphan it
 * until it auto-denied. This is the only way the UI recovers one, and the only
 * way a pending approval is visible from outside the blocked chat.
 *
 * A gateway that predates the endpoint answers `404`. That is not an error
 * worth showing anybody — it means "this build has no catch-up" — so it
 * degrades to an empty list with `unsupported: true` rather than lighting up
 * the UI on every poll.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { gatewayFetch } from '../../server/gateway-capabilities'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../server/profile-scope'

export const Route = createFileRoute('/api/approvals/pending')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }

        const profile = readProfile(
          new URL(request.url).searchParams.get('profile'),
        )
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
          const res = await gatewayFetch(
            await scopedPath('/v1/approvals/pending', profile),
            { signal: AbortSignal.timeout(10_000) },
          )

          if (res.status === 404) {
            return Response.json(
              { ok: true, approvals: [], unsupported: true },
              { status: 200 },
            )
          }

          const json = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          if (!res.ok) {
            return Response.json(
              { ok: false, approvals: [], error: errorMessage(json) },
              { status: res.status },
            )
          }

          const approvals = Array.isArray(json.approvals) ? json.approvals : []
          return Response.json({ ok: true, approvals }, { status: 200 })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, approvals: [], error: (err as Error).message },
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              ok: false,
              approvals: [],
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})

function errorMessage(json: Record<string, unknown>): string {
  const error = json.error
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Failed to list pending approvals'
}
