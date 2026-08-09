import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readProfile } from '../../../server/profiles-browser'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/read')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const name = (url.searchParams.get('name') || '').trim() || 'default'
          return Response.json({ profile: readProfile(name) })
        } catch (error) {
          return errorResponse(error, 'Failed to read profile')
        }
      },
    },
  },
})
