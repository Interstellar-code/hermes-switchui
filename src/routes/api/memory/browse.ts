import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  browseMnemosyne,
  decodeCursor,
  isMnemosyneBrowseType,
} from '../../../server/mnemosyne-browser'
import { isMemoryProfile } from '../../../server/memory-profile'

// Read-only, paginated, recent-first list of mnemosyne rows for the Browse tab.
// ?type=gist|fact|entity|episodic|working &q= &since=ISO &until=ISO &fold=0|1 &junk=0|1 &limit= &cursor=<nextCursor>
export const Route = createFileRoute('/api/memory/browse')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const type = url.searchParams.get('type') || null
        if (type && !isMnemosyneBrowseType(type)) {
          return Response.json({ error: 'invalid type' }, { status: 400 })
        }
        const rawLimit = url.searchParams.get('limit')
        const limit = rawLimit === null ? 50 : Number(rawLimit)
        if (!Number.isInteger(limit) || limit < 1) {
          return Response.json(
            { error: 'limit must be a positive integer' },
            { status: 400 },
          )
        }
        const cursor = url.searchParams.get('cursor')
        if (cursor && !decodeCursor(cursor)) {
          return Response.json({ error: 'invalid cursor' }, { status: 400 })
        }
        const since = url.searchParams.get('since')
        if (since && Number.isNaN(Date.parse(since))) {
          return Response.json(
            { error: 'since must be an ISO date' },
            { status: 400 },
          )
        }
        const until = url.searchParams.get('until')
        if (until && Number.isNaN(Date.parse(until))) {
          return Response.json(
            { error: 'until must be an ISO date' },
            { status: 400 },
          )
        }
        const profile = url.searchParams.get('profile')
        if (profile !== null && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }
        try {
          return Response.json(
            browseMnemosyne({
              type: type && isMnemosyneBrowseType(type) ? type : null,
              q: url.searchParams.get('q') ?? '',
              since,
              until,
              fold: url.searchParams.get('fold') !== '0',
              junk: url.searchParams.get('junk') !== '0',
              limit,
              cursor,
              profile: profile ?? undefined,
            }),
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to browse mnemosyne memory',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
