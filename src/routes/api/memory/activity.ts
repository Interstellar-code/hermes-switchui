import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getMnemosyneActivity } from '../../../server/mnemosyne-browser'
import { isMemoryProfile } from '../../../server/memory-profile'

// Per-day write counts + per-kind totals for the Browse sparkline.
// ?days=30 &tz=<minutes east of UTC> &profile=
export const Route = createFileRoute('/api/memory/activity')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const rawDays = url.searchParams.get('days')
        const days = rawDays === null ? 30 : Number(rawDays)
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          return Response.json(
            { error: 'days must be an integer 1-365' },
            { status: 400 },
          )
        }
        const rawTz = url.searchParams.get('tz')
        const tz = rawTz === null ? 0 : Number(rawTz)
        if (!Number.isInteger(tz) || Math.abs(tz) > 840) {
          return Response.json(
            { error: 'tz must be integer minutes within ±840' },
            { status: 400 },
          )
        }
        const profile = url.searchParams.get('profile')
        if (profile !== null && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        try {
          return Response.json(
            getMnemosyneActivity(days, undefined, profile ?? undefined, tz),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to read Mnemosyne activity'
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
