import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listGatewayToolsets } from '../../../server/hermes-api'
import {
  DESTRUCTIVE_TOOLSETS,
  PLUGINS_GROUP,
  TOOLSET_GROUP_BY_KEY,
  buildStaticToolsetCatalog,
} from '../../../lib/toolsets'
import type { NormalizedToolset } from '../../../lib/toolsets'

/**
 * Strip a leading 🔌 (and any other leading non-alphanumeric tokens) from a
 * gateway toolset label, returning the cleaned label and whether the marker
 * was present (→ plugin-registered toolset).
 */
function cleanLabel(raw: string): { label: string; hadPlugin: boolean } {
  const trimmed = raw.trim()
  const hadPlugin = /^[^\p{L}\p{N}]*\u{1F50C}/u.test(trimmed) || trimmed.startsWith('🔌')
  // Drop leading run of non-alphanumeric chars (emoji, separators, spaces).
  const label = trimmed.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  return { label: label || trimmed, hadPlugin }
}

export const Route = createFileRoute('/api/profiles/toolsets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const res = await listGatewayToolsets()
          const rows = Array.isArray(res.data) ? res.data : []
          if (rows.length === 0) {
            // Treat an empty live list as a failure → static fallback.
            throw new Error('empty toolset list')
          }

          const toolsets: Array<NormalizedToolset> = rows.map((t) => {
            const key = t.name
            const { label, hadPlugin } = cleanLabel(t.label || key)
            const known = Object.prototype.hasOwnProperty.call(
              TOOLSET_GROUP_BY_KEY,
              key,
            )
            const plugin = hadPlugin || !known
            return {
              key,
              label,
              group: known ? TOOLSET_GROUP_BY_KEY[key] : PLUGINS_GROUP,
              destructive: DESTRUCTIVE_TOOLSETS.has(key),
              plugin,
              // `t.enabled` reflects the gateway's live resolution for this
              // toolset (platform_toolsets + agent.disabled_toolsets applied
              // last) — see isToolsetSuppressed() in lib/toolsets.ts.
              gatewayEnabled: t.enabled,
            }
          })

          return Response.json({ toolsets, source: 'gateway' as const })
        } catch {
          // Gateway unreachable / auth fail / non-200 / empty — never hard-fail
          // the wizard: fall back to the static catalog.
          return Response.json({
            toolsets: buildStaticToolsetCatalog(),
            source: 'static' as const,
          })
        }
      },
    },
  },
})
