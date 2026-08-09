import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { setActiveProfile } from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'
import { errorResponse } from './-error-response'

export const Route = createFileRoute('/api/profiles/activate')({
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
          const result = setActiveProfile(body.name || '')
          return Response.json({
            ok: true,
            profile: result.profile,
            needsGatewayRestart: result.needsGatewayRestart,
          })
        } catch (error) {
          return errorResponse(error, 'Failed to activate profile')
        }
      },
    },
  },
})
