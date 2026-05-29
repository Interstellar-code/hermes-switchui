import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  dashboardFetch,
  ensureGatewayProbed,
  getCapabilities,
  getGatewayMode,
} from '../../../server/gateway-capabilities'
import {
  deriveFallbackModelInfoFromGateway,
  normalizeModelInfoResponse,
} from '@/lib/model-info'

export const Route = createFileRoute('/api/model/info')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        await ensureGatewayProbed()
        const gatewayMode = getGatewayMode()

        let rawPayload: unknown = null
        try {
          const response = await dashboardFetch('/api/model/info')
          if (response.ok) {
            rawPayload = await response.json()
          }
        } catch {
          rawPayload = null
        }

        const normalized = normalizeModelInfoResponse(rawPayload)
        const shouldUseFallback =
          normalized.supportsRuntimeSwitching === null &&
          normalized.vanillaAgent === null
        const resolved = shouldUseFallback
          ? {
              ...deriveFallbackModelInfoFromGateway(
                gatewayMode,
                getCapabilities(),
              ),
              // Keep the gateway's live active model/provider from the dashboard
              // payload even when runtime-switching flags fall back to gateway
              // capabilities — otherwise the composer can't show what the agent
              // actually uses (e.g. manifest/auto) and reverts to config.yaml.
              activeModel: normalized.activeModel,
              activeProvider: normalized.activeProvider,
            }
          : normalized

        if (shouldUseFallback) {
          console.log(
            `[model-info] falling back to gateway capabilities (source=gateway-capabilities mode=${gatewayMode})`,
          )
        }

        return Response.json({
          ...resolved,
          gatewayMode,
        })
      },
    },
  },
})
