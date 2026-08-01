import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readUpdateStatus } from '../../../server/update-system'

export const Route = createFileRoute('/api/update/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        return Response.json(await readUpdateStatus())
      },
    },
  },
})
