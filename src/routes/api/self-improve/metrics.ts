import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  collectMetrics,
  listMetrics,
} from '../../../server/self-improve-client'

export const Route = createFileRoute('/api/self-improve/metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile') ?? undefined
        const limitRaw = url.searchParams.get('limit')
        const limit = limitRaw ? Number(limitRaw) : undefined
        try {
          const metrics = await listMetrics({ profile, limit })
          return Response.json({ metrics })
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Self-Improve plugin unavailable'
          return Response.json(
            { error: msg, mode: 'dashboard-unavailable' },
            { status: 503 },
          )
        }
      },

      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { profile?: unknown }
        try {
          body = (await request.json()) as { profile?: unknown }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const profile =
          typeof body.profile === 'string' ? body.profile.trim() : ''
        if (!profile) {
          return Response.json(
            { error: 'profile is required' },
            { status: 400 },
          )
        }
        try {
          const result = await collectMetrics(profile)
          return Response.json(result)
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Self-Improve plugin unavailable'
          return Response.json(
            { error: msg, mode: 'dashboard-unavailable' },
            { status: 503 },
          )
        }
      },
    },
  },
})
