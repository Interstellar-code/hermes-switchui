import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  detectByteroverIntegration,
  detectHonchoIntegration,
} from '../../server/integration-detection'

export const Route = createFileRoute('/api/integrations')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        return Response.json({
          ok: true,
          checkedAt: Date.now(),
          integrations: {
            honcho: detectHonchoIntegration(),
            byterover: detectByteroverIntegration(),
          },
        })
      },
    },
  },
})
