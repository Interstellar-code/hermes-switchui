import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { exportProfile } from '../../../server/profiles-export'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/export')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const name = (url.searchParams.get('name') || '').trim()
          if (!name) {
            return Response.json({ error: 'Profile name is required' }, { status: 400 })
          }
          return Response.json(exportProfile(name))
        } catch (error) {
          return errorResponse(error, 'Failed to export profile')
        }
      },
    },
  },
})
