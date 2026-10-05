/**
 * PATCH  /api/workflow-schedules/:id — { enabled: boolean }
 * DELETE /api/workflow-schedules/:id — cancel the schedule
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { dashboardFetch } from '../../server/gateway-capabilities'

const PLUGIN_BASE = '/api/plugins/workflow-engine'
const ID_RE = /^[A-Za-z0-9_:.-]{1,128}$/
const PASS = new Set([400, 404, 409, 501])

async function forward(id: string, init: RequestInit): Promise<Response> {
  try {
    const res = await dashboardFetch(
      `${PLUGIN_BASE}/schedules/${encodeURIComponent(id)}`,
      { ...init, signal: AbortSignal.timeout(8000) },
    )
    if (res.ok) return Response.json(await res.json())
    // Generic bodies only: never relay upstream error text.
    return Response.json(
      { error: 'Schedule request failed' },
      { status: PASS.has(res.status) ? res.status : 502 },
    )
  } catch {
    return Response.json({ error: 'Schedule request failed' }, { status: 502 })
  }
}

export const Route = createFileRoute('/api/workflow-schedules/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (!ID_RE.test(params.id)) {
          return Response.json(
            { error: 'Invalid schedule id' },
            { status: 400 },
          )
        }
        let body: { enabled?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (typeof body.enabled !== 'boolean') {
          return Response.json(
            { error: 'enabled must be a boolean' },
            { status: 400 },
          )
        }
        return forward(params.id, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: body.enabled }),
        })
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        if (!ID_RE.test(params.id)) {
          return Response.json(
            { error: 'Invalid schedule id' },
            { status: 400 },
          )
        }
        return forward(params.id, { method: 'DELETE' })
      },
    },
  },
})
