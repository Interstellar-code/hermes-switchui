/**
 * GET /api/dashboard/social
 *
 * Builds the social dashboard payload (C1 `DashboardSocial`): profile
 * card with derived XP/level/streak (C2), agents, hot topics, counts,
 * Needs You queue, recent activity and badges — all derived from
 * existing sources, nothing new stored.
 *
 * Auth matches `/api/dashboard/overview`; each slice nulls itself out
 * when its upstream fails, so a single missing endpoint hides one card,
 * never the whole response.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  dashboardFetch,
  gatewayFetch,
} from '../../../server/gateway-capabilities'
import { readProfile } from '../../../server/profile-scope'
import { buildDashboardSocial } from '../../../server/dashboard-social'
import { getMnemosyneActivity } from '../../../server/mnemosyne-browser'
import type { DashboardFetcher } from '../../../server/dashboard-aggregator'

// Memory activity is the one source that lives in SwitchUI's own
// mnemosyne SQLite rather than behind the Hermes dashboard — intercept
// it here so the builder stays fetcher-only (and unit-testable with a
// plain `(path) => Response` stub).
const socialFetcher: DashboardFetcher = async (path) => {
  if (path.startsWith('/api/memory/activity')) {
    const url = new URL(path, 'http://switchui.local')
    const days = Number(url.searchParams.get('days') ?? '30')
    const tz = Number(url.searchParams.get('tz') ?? '0')
    const profile = url.searchParams.get('profile')
    try {
      const activity = getMnemosyneActivity(
        Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30,
        undefined,
        profile ?? undefined,
        Number.isFinite(tz) ? tz : 0,
      )
      return Response.json(activity)
    } catch {
      return Response.json({ error: 'memory unavailable' }, { status: 500 })
    }
  }
  return dashboardFetch(path)
}

// Gateway fetcher hits the gateway URL, where `/health/detailed` lives.
const socialGatewayFetcher: DashboardFetcher = (path) => gatewayFetch(path)

export const Route = createFileRoute('/api/dashboard/social')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const social = await buildDashboardSocial({
            fetcher: socialFetcher,
            gatewayFetcher: socialGatewayFetcher,
            profile: readProfile(url.searchParams.get('profile')),
          })
          return Response.json(social, {
            headers: {
              'Cache-Control': 'private, max-age=5, stale-while-revalidate=20',
            },
          })
        } catch (err) {
          return Response.json(
            {
              error: err instanceof Error ? err.message : 'social build failed',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
