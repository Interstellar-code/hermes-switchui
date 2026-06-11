import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { createScenario, listScenarios } from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/scenarios')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile') ?? ''
        if (!profile) {
          return Response.json({ error: 'profile query param required' }, { status: 400 })
        }
        const includeHoldout = url.searchParams.get('include_holdout') === '1'
        try {
          const scenarios = await listScenarios(profile, includeHoldout)
          return Response.json({ scenarios })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          const status = msg.includes('404') || msg.includes('not found') ? 404 : 503
          return Response.json({ error: msg }, { status })
        }
      },

      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { profile?: string; name?: string; input?: string; checks?: unknown; holdout?: boolean }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.profile || !body.name) {
          return Response.json({ error: 'profile and name are required' }, { status: 400 })
        }
        // Normalise checks: accept string[] or raw string
        let checks: Array<string> | string | undefined = undefined
        if (body.checks !== undefined) {
          if (Array.isArray(body.checks)) {
            checks = body.checks as Array<string>
          } else if (typeof body.checks === 'string') {
            checks = body.checks
          }
        }
        try {
          const result = await createScenario({
            profile: body.profile,
            name: body.name,
            input: body.input,
            checks,
            holdout: body.holdout,
          })
          return Response.json(result, { status: 201 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          const status = msg.includes('422') ? 422 : msg.includes('400') ? 400 : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
