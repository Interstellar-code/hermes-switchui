import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  getActiveProfileName,
  listProfiles,
} from '../../../server/profiles-browser'
import { ensureBuiltinProfiles } from '../../../server/profiles-bootstrap'

export const Route = createFileRoute('/api/profiles/list')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          ensureBuiltinProfiles()
          return Response.json({
            profiles: listProfiles(),
            activeProfile: getActiveProfileName(),
          })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list profiles',
              profiles: [],
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
