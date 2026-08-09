import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { deleteProfile } from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as { name?: string }
          const name = (body.name || '').trim()
          if (name === 'default') {
            return Response.json({ error: 'Default profile cannot be deleted' }, { status: 403 })
          }
          deleteProfile(name)
          return Response.json({ ok: true })
        } catch (error) {
          return errorResponse(error, 'Failed to delete profile')
        }
      },
    },
  },
})
