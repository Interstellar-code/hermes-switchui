import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listTrashedProfiles } from '../../../server/profiles-trash'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/trash-list')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return Response.json({ trashed: listTrashedProfiles() })
        } catch (error) {
          return errorResponse(error, 'Failed to list trashed profiles')
        }
      },
    },
  },
})
