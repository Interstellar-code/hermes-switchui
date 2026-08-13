import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  CLAUDE_DASHBOARD_URL,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import {
  getHermesCommandCatalog,
  hermesCommandCatalogCachedAt,
} from '../../server/hermes-commands'

/**
 * `GET /api/hermes-commands` — the live Hermes agent command catalog.
 *
 * Backed by the `commands.catalog` JSON-RPC method over
 * `${CLAUDE_DASHBOARD_URL}/api/ws` (see `server/hermes-rpc.ts`). That method
 * needs no tui_gateway session — it only reads the command registry — so this
 * route owns no session lifecycle.
 *
 * Every entry carries a `tier` computed server-side from
 * `server/hermes-command-tiers.ts`, which is the single home for that policy
 * (`docs/plans/hermes-slash-commands-in-switchui.md` §4). Results are TTL-cached
 * for 60s in `server/hermes-commands.ts`.
 *
 * Strictly additive: when the dashboard is absent the `agentCommands`
 * capability is false and this route answers 503 with a machine-readable
 * `mode`, so callers fall back to today's hardcoded menu.
 */

function unavailable(reason: string): Response {
  return Response.json(
    {
      ok: false,
      error: 'Agent commands unavailable',
      mode: 'agent-commands-unavailable',
      reason,
      dashboardUrl: CLAUDE_DASHBOARD_URL,
    },
    { status: 503 },
  )
}

export const Route = createFileRoute('/api/hermes-commands')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.agentCommands) {
          return unavailable(
            capabilities.dashboard.available
              ? 'commands-catalog-unavailable'
              : 'dashboard-unavailable',
          )
        }

        try {
          const catalog = await getHermesCommandCatalog()
          return Response.json({
            ok: true,
            commands: catalog.commands,
            categories: catalog.categories,
            aliases: catalog.aliases,
            skillCount: catalog.skillCount,
            bundleCount: catalog.bundleCount,
            warning: catalog.warning,
            cachedAt: hermesCommandCatalogCachedAt(),
          })
        } catch (error) {
          // The capability probe passed but the RPC failed since — the
          // dashboard went away mid-flight, or the socket dropped. Same
          // degraded shape so the client has one branch to handle.
          return unavailable(
            error instanceof Error ? error.message : 'commands-catalog-failed',
          )
        }
      },
    },
  },
})
