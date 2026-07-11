/**
 * Backup Restore Upload API — multipart proxy to dashboard /api/ops/import-upload
 *
 * Accepts multipart/form-data upload and forwards to the dashboard import-upload
 * endpoint. Preserves multipart boundaries by passing request.body directly.
 * Uses duplex:'half' required by Node fetch for streaming bodies.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '@/server/auth-middleware'
import { dashboardFetch } from '@/server/gateway-capabilities'

export const Route = createFileRoute('/api/backups/restore-upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth check
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401, headers: { 'content-type': 'application/json' } },
          )
        }

        // Check content-type is multipart/form-data
        const contentType = request.headers.get('content-type')
        if (!contentType || !contentType.includes('multipart/form-data')) {
          return Response.json(
            { ok: false, error: 'Content-Type must be multipart/form-data' },
            { status: 415, headers: { 'content-type': 'application/json' } },
          )
        }

        try {
          const init: RequestInit & { duplex: 'half' } = {
            method: 'POST',
            headers: { 'content-type': contentType },
            body: request.body,
            duplex: 'half',
          }

          // Proxy to dashboard with streaming multipart body
          const upstream = await dashboardFetch('/api/ops/import-upload', init)

          // Forward response
          const responseBody = await upstream.text()
          return new Response(responseBody, {
            status: upstream.status,
            headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
          })
        } catch (err) {
          return Response.json(
            { ok: false, error: 'Failed to restore backup' },
            { status: 502, headers: { 'content-type': 'application/json' } },
          )
        }
      },
    },
  },
})
