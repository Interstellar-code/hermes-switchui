import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  DEFAULT_MEMORY_PROFILE,
  listMemoryProfiles,
} from '../../../server/memory-profile'
import { getMnemosyneDbPath } from '../../../server/mnemosyne-browser'

// Profiles the /memory page can switch between, with matrix-memory presence.
export const Route = createFileRoute('/api/memory/profiles')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return Response.json(
            {
              defaultProfile: DEFAULT_MEMORY_PROFILE,
              profiles: listMemoryProfiles((p) =>
                getMnemosyneDbPath(undefined, p),
              ),
            },
            { headers: { 'Cache-Control': 'private, no-store' } },
          )
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to list profiles'
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
