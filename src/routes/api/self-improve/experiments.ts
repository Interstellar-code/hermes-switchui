import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { createExperiment, listExperiments } from '../../../server/self-improve-client'
import type { CreateExperimentBody } from '../../../lib/self-improve-types'

export const Route = createFileRoute('/api/self-improve/experiments')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile') ?? undefined
        const state = url.searchParams.get('state') ?? undefined
        try {
          const experiments = await listExperiments({ profile, state })
          return Response.json({ experiments })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Self-Improve plugin unavailable'
          return Response.json({ error: msg }, { status: 503 })
        }
      },

      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: CreateExperimentBody
        try {
          body = (await request.json()) as CreateExperimentBody
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.profile || typeof body.profile !== 'string') {
          return Response.json({ error: 'profile is required' }, { status: 400 })
        }
        try {
          const result = await createExperiment(body)
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
