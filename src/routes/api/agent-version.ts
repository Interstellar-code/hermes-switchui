import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { CLAUDE_DASHBOARD_URL } from '../../server/gateway-capabilities'

let cached: { version: string | null; ts: number } = { version: null, ts: 0 }
const TTL_MS = 60_000

export const Route = createFileRoute('/api/agent-version')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const now = Date.now()
        // Guard against backward clock skew (NTP correction, sleep/wake, DST):
        // if now < cached.ts, "now - cached.ts" is negative and would keep
        // returning stale data forever. Require monotonic forward progress
        // before applying the TTL.
        if (cached.version && now >= cached.ts && now - cached.ts < TTL_MS) {
          return json({ version: cached.version })
        }
        try {
          const res = await fetch(`${CLAUDE_DASHBOARD_URL}/api/status`, {
            signal: AbortSignal.timeout(3000),
          })
          if (!res.ok) return json({ version: null })
          const body = (await res.json()) as { version?: string }
          const version = body.version || null
          cached = { version, ts: now }
          return json({ version })
        } catch {
          return json({ version: null })
        }
      },
    },
  },
})
