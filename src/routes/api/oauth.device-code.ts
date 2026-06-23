import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isAuthenticated } from '../../server/auth-middleware'
import { getClientIp, rateLimit, rateLimitResponse, requireJsonContentType } from '../../server/rate-limit'

const BodySchema = z.object({
  provider: z.string(),
})

export const Route = createFileRoute('/api/oauth/device-code')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const ip = getClientIp(request)
        if (!rateLimit(`oauth-device-code:${ip}`, 10, 60_000)) {
          return rateLimitResponse()
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 })
        }

        const parsed = BodySchema.safeParse(body)
        if (!parsed.success) {
          return Response.json({ error: 'Missing provider' }, { status: 400 })
        }

        const { provider } = parsed.data

        if (provider === 'nous') {
          try {
            const res = await fetch(
              'https://portal.nousresearch.com/api/oauth/device/code',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'client_id=claude-cli',
              },
            )
            const data = await res.json()
            if (!res.ok) {
              return Response.json(
                { error: data.error || 'Device code request failed' },
                { status: res.status },
              )
            }
            return Response.json(data)
          } catch (err) {
            return Response.json(
              { error: err instanceof Error ? err.message : 'Network error' },
              { status: 500 },
            )
          }
        }

        return Response.json(
          {
            error: `OAuth device flow not supported for provider: ${provider}`,
          },
          { status: 400 },
        )
      },
    },
  },
})
