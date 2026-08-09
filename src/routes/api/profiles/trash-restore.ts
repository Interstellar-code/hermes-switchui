import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { restoreTrashedProfile } from '../../../server/profiles-trash'
import { requireJsonContentType } from '../../../server/rate-limit'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/trash-restore')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as { id?: string }
          const result = restoreTrashedProfile(body.id || '')
          return Response.json({ ok: true, name: result.name })
        } catch (error) {
          return errorResponse(error, 'Failed to restore profile')
        }
      },
    },
  },
})
