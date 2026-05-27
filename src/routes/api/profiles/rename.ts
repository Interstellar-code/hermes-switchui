import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { renameProfile } from '../../../server/profiles-browser'
import { requireJsonContentType } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/profiles/rename')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            oldName?: string
            newName?: string
          }
          return Response.json({
            ok: true,
            profile: renameProfile(body.oldName || '', body.newName || ''),
          })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to rename profile',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
