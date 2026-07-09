/**
 * Backup Restore API — proxy to dashboard /api/ops/import
 *
 * Accepts JSON body { archive: string } and forwards to the Hermes Agent
 * dashboard import endpoint with force:true injected server-side.
 * The client cannot override the force parameter.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import { requireJsonContentType } from '@/server/rate-limit'
import { dashboardFetch } from '@/server/gateway-capabilities'

export const Route = createFileRoute('/api/backups/restore')({
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
        const body = (await request.json()) as { archive: string }

        // Server-side force injection - client cannot override this
        const payload = {
          archive: body.archive,
          force: true,
        }

        // Proxy to dashboard with force:true injected
        const upstream = await dashboardFetch('/api/ops/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })

        // Forward response
        const responseBody = await upstream.text()
        return new Response(responseBody, {
          status: upstream.status,
          headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
        })
      },
    },
  },
})