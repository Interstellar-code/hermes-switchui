import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  CLAUDE_API,
  CLAUDE_DASHBOARD_URL,
  ensureGatewayProbed,
  getCapabilities,
  getGatewayMode,
} from '../../server/gateway-capabilities'
// `profile-scope`'s `getGatewayMode` is multiplex TOPOLOGY (single|multiplex +
// servedProfiles) — a different concept from `gateway-capabilities`'s
// `getGatewayMode` above (chat transport mode). Aliased so the two can never
// be confused at a glance; nested under `scope` in the response, never
// merged into the existing `mode` key.
import { getGatewayMode as getGatewayScopeMode } from '../../server/profile-scope'
import { getActiveProfileName } from '../../server/profiles-browser'
import { listProfileSessions } from '../../server/claude-dashboard-api'

export const Route = createFileRoute('/api/gateway-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const capabilities = await ensureGatewayProbed()
        const scopeTopology = await getGatewayScopeMode()
        let sessionCounts: Record<string, number> = {}
        try {
          const probeProfile = getActiveProfileName() || 'default'
          const result = await listProfileSessions(probeProfile, 1, 0)
          sessionCounts = result.profile_totals ?? {}
        } catch {
          // ponytail: best-effort — an empty map just means the picker shows
          // no counts, not an error. Upgrade if a profile-agnostic totals
          // endpoint ever exists.
        }

        return Response.json({
          capabilities,
          mode: getGatewayMode(),
          claudeUrl: CLAUDE_API,
          dashboardUrl: CLAUDE_DASHBOARD_URL,
          gateway: {
            // A 401 from `/health` means this workspace's own bearer token
            // doesn't match what the gateway expects — the gateway IS
            // running, but nothing authenticated will work. That is not
            // "available"; see gateway-capabilities.ts's probeHealth() (W3
            // audit item 5).
            available:
              (capabilities.health || capabilities.chatCompletions) &&
              !capabilities.authError,
            authError: capabilities.authError,
            url: CLAUDE_API,
          },
          dashboard: capabilities.dashboard,
          // Composer profile-scope picker payload — see comment above on the
          // aliased import. Do not read/write `mode` above for this purpose.
          scope: {
            mode: scopeTopology.mode,
            servedProfiles: scopeTopology.servedProfiles,
            // The gateway's own active profile in `single` mode — computed
            // above via `scopeTopology` but previously dropped before this
            // response went out (W3 audit item 1: "Selected ≠ Serving, and
            // the UI shows one fact"). `null` for `multiplex` (meaningless —
            // a bare URL resolves to `default`, not to any "active" profile)
            // and for `unknown` (topology couldn't be established).
            servingProfile: scopeTopology.activeProfile,
            sessionCounts,
          },
        })
      },
    },
  },
})
