/**
 * Backup Download API — binary stream proxy to dashboard /api/ops/backup/download
 *
 * Streams the backup archive directly from the dashboard without buffering.
 * Accepts `archive` query parameter specifying the backup file path.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import {
  dashboardFetch,
  ensureGatewayProbed,
} from '@/server/gateway-capabilities'
import { getActiveProfileName } from '@/server/profiles-browser'

export const Route = createFileRoute('/api/backups/download')({
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

        // Read archive parameter from query string
        const url = new URL(request.url)
        const archive = url.searchParams.get('archive')
        if (!archive) {
          return Response.json(
            { ok: false, error: 'Missing required parameter: archive' },
            { status: 400, headers: { 'content-type': 'application/json' } },
          )
        }

        try {
          // Proxy to dashboard with streaming response
          const upstream = await dashboardFetch(
            `/api/ops/backup/download?archive=${encodeURIComponent(archive)}&profile=${encodeURIComponent(getActiveProfileName())}`,
          )

          if (!upstream.ok) {
            return Response.json(
              { ok: false, error: 'Failed to download backup' },
              { status: 502, headers: { 'content-type': 'application/json' } },
            )
          }

          // Pass upstream.body directly without buffering
          const responseHeaders = new Headers()
          const contentType = upstream.headers.get('content-type')
          if (contentType) responseHeaders.set('content-type', contentType)
          const contentDisposition = upstream.headers.get('content-disposition')
          if (contentDisposition)
            responseHeaders.set('content-disposition', contentDisposition)

          return new Response(upstream.body, {
            status: upstream.status,
            headers: responseHeaders,
          })
        } catch (err) {
          return Response.json(
            { ok: false, error: 'Failed to download backup' },
            { status: 502, headers: { 'content-type': 'application/json' } },
          )
        }
      },
    },
  },
})
