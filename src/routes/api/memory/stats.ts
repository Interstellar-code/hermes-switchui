import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getMnemosyneStats } from '../../../server/mnemosyne-browser'
import { isMemoryProfile } from '../../../server/memory-profile'

export const Route = createFileRoute('/api/memory/stats')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile')
        if (profile !== null && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        try {
          return Response.json(
            getMnemosyneStats(undefined, profile ?? undefined),
          )
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to read Mnemosyne stats'
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
