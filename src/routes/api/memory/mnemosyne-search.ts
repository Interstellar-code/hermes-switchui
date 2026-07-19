import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { searchMnemosyne } from '../../../server/mnemosyne-browser'

// Read-only keyword search over the profile's mnemosyne memory (gists, facts,
// episodic). Grounds the Memory chat. Missing DB → empty results (not a 500).
export const Route = createFileRoute('/api/memory/mnemosyne-search')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const query = url.searchParams.get('q') ?? ''
        const rawLimit = url.searchParams.get('limit')
        let limit = 8
        if (rawLimit !== null) {
          const n = Number(rawLimit)
          if (!Number.isInteger(n) || n < 1) {
            return Response.json({ error: 'limit must be a positive integer' }, { status: 400 })
          }
          limit = Math.min(n, 25)
        }
        try {
          return Response.json(
            { results: searchMnemosyne(query, limit) },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : 'Failed to search mnemosyne memory',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
