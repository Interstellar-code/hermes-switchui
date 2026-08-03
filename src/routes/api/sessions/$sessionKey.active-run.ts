import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getActiveRunForSession } from '../../../server/run-store'
import { readProfile } from '../../../server/profile-scope'
import { scopeKey } from '@/lib/session-scope'

export const Route = createFileRoute('/api/sessions/$sessionKey/active-run')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const sessionKey = params.sessionKey.trim()
        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        try {
          // Runs are stored under the composite `profile::sessionId`, because
          // the same session id exists in every profile and would otherwise
          // share one run record. `scopeKey` returns the bare id when unscoped,
          // so single-profile run paths are unchanged.
          const profile = readProfile(
            new URL(request.url).searchParams.get('profile'),
          )
          const run = await getActiveRunForSession(scopeKey(profile, sessionKey))
          return Response.json({ ok: true, run })
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
