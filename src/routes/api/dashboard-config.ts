/**
 * Dashboard Config API — thin proxy to the hermes-agent dashboard /api/config.
 * Used by useOrchestratorIdentity and any other client code that needs to
 * read/write dashboard config without bundling Node.js-only server modules.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed, getCapabilities } from '../../server/gateway-capabilities'
import { getConfig, saveConfig } from '../../server/claude-dashboard-api'

type AuthResult = Response | true

export const Route = createFileRoute('/api/dashboard-config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        await ensureGatewayProbed()
        if (!getCapabilities().config) {
          return Response.json({ ok: false, unavailable: true, config: {} })
        }
        try {
          const cfg = await getConfig()
          return Response.json({ ok: true, config: cfg })
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err) },
            { status: 502 },
          )
        }
      },

      PUT: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        await ensureGatewayProbed()
        if (!getCapabilities().config) {
          return Response.json(
            { ok: false, unavailable: true },
            { status: 503 },
          )
        }
        try {
          const body = (await request.json()) as { patch: Record<string, unknown> }
          const result = await saveConfig(body.patch)
          return Response.json(result)
        } catch (err) {
          return Response.json(
            { ok: false, error: String(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
