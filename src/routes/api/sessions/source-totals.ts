import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { ensureGatewayProbed } from '../../../server/hermes-api'
import {
  listSessions as listDashboardSessions,
  listProfileSessions,
} from '../../../server/claude-dashboard-api'
import { readProfile } from '../../../server/profile-scope'
import { isValidProfileName } from '../../../lib/profile-name'

/**
 * Server `source` values the sidebar has a chip for. Anything else (local,
 * unknown adapters) is `total - sum(bySource)` and lands in the CHAT chip.
 */
export const COUNTED_SESSION_SOURCES = [
  'cron',
  'api_server',
  'telegram',
  'a2a_fleet',
  'cli',
  'recovered',
  'kanban',
] as const

/**
 * GET /api/sessions/source-totals?profile=X
 *
 * Real per-source session counts for the sidebar chips — the list only loads
 * a window, so counting loaded rows undercounts every older source. One
 * `limit=1` read per source, fanned out here so the browser makes one request.
 * Needs the dashboard (it is the only listing that returns `total`); without
 * it answers `totals: null` and the chips keep counting loaded rows.
 */
export const Route = createFileRoute('/api/sessions/source-totals')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.dashboard.available) {
          return Response.json({ ok: true, totals: null })
        }
        const profile = readProfile(
          new URL(request.url).searchParams.get('profile'),
        )
        if (profile && !isValidProfileName(profile)) {
          return Response.json(
            { ok: false, error: 'Invalid profile' },
            { status: 400 },
          )
        }
        // A degraded profile (drifted state.db) reports `errors[]` with a
        // meaningless total — null it so chips never claim a fake count.
        const count = async (source?: string): Promise<number | null> => {
          const filter = source ? { source } : undefined
          const result = profile
            ? await listProfileSessions(profile, 1, 0, filter)
            : await listDashboardSessions(1, 0, filter)
          const { errors } = result as { errors?: Array<unknown> }
          if (errors?.length) return null
          return Number(result.total) || 0
        }
        try {
          const [total, ...counts] = await Promise.all([
            count(),
            ...COUNTED_SESSION_SOURCES.map((source) => count(source)),
          ])
          if (total === null || counts.includes(null)) {
            return Response.json({ ok: true, totals: null })
          }
          const bySource = Object.fromEntries(
            COUNTED_SESSION_SOURCES.map((source, i) => [source, counts[i]]),
          )
          return Response.json({ ok: true, totals: { total, bySource } })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 502 },
          )
        }
      },
    },
  },
})
