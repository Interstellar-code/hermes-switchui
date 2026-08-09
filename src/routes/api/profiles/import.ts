import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { importProfile } from '../../../server/profiles-export'
import { requireJsonContentType } from '../../../server/rate-limit'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as { bundle?: unknown; name?: string }
          if (body.bundle === undefined) {
            return Response.json({ error: 'bundle is required' }, { status: 400 })
          }
          const profile = importProfile(body.bundle, { name: body.name })
          return Response.json({ ok: true, profile })
        } catch (error) {
          return errorResponse(error, 'Failed to import profile')
        }
      },
    },
  },
})
