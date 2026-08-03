/**
 * Backup Create API — proxy to dashboard /api/ops/backup
 *
 * Accepts JSON body { output?: string } and forwards to the Hermes Agent
 * dashboard backup endpoint. Requires authentication and CSRF check.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import { requireJsonContentType } from '@/server/rate-limit'
import { dashboardFetch } from '@/server/gateway-capabilities'
import { getActiveProfileName } from '@/server/profiles-browser'

export const Route = createFileRoute('/api/backups/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // CSRF check (rejects non-JSON content types on POST)
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // Auth check
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }

        // Parse JSON body
        const body = (await request.json()) as { output?: string }

        // Proxy to dashboard
        const upstream = await dashboardFetch(
          `/api/ops/backup?profile=${encodeURIComponent(getActiveProfileName())}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
        )

        // Forward response
        const responseBody = await upstream.text()
        return new Response(responseBody, {
          status: upstream.status,
          headers: {
            'content-type':
              upstream.headers.get('content-type') || 'application/json',
          },
        })
      },
    },
  },
})
