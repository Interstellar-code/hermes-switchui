import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getMnemosyneStats } from '../../../server/mnemosyne-browser'

export const Route = createFileRoute('/api/memory/stats')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          return Response.json(getMnemosyneStats())
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
