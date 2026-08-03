/**
 * Backup List API — proxy to dashboard /api/ops/backup/list
 *
 * Lists available backups. The endpoint may not exist in all dashboard versions,
 * so this route gracefully degrades to { ok: false, pending: true, backups: [] }
 * with status 200 when the upstream returns 404.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  dashboardFetch,
  ensureGatewayProbed,
} from '@/server/gateway-capabilities'
import { getActiveProfileName } from '@/server/profiles-browser'

export const Route = createFileRoute('/api/backups/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Auth check
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }

        // Ensure gateway is probed
        await ensureGatewayProbed()

        try {
          // Proxy to dashboard
          const upstream = await dashboardFetch(
            `/api/ops/backup/list?profile=${encodeURIComponent(getActiveProfileName())}`,
          )

          // Graceful 404: endpoint doesn't exist yet in some dashboard versions
          if (upstream.status === 404) {
            return Response.json(
              { ok: false, pending: true, backups: [] },
              { status: 200, headers: { 'content-type': 'application/json' } },
            )
          }

          // Forward successful response
          const body = await upstream.json()
          return Response.json(body, {
            status: upstream.status,
            headers: {
              'content-type':
                upstream.headers.get('content-type') || 'application/json',
            },
          })
        } catch (err) {
          // Graceful degradation on any error
          return Response.json(
            { ok: false, pending: true, backups: [] },
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
      },
    },
  },
})
