import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listOutputs } from '../../../server/operations-store'

export const Route = createFileRoute('/api/operations/outputs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const outputs = await listOutputs()
          return Response.json(outputs)
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to list outputs' },
            { status: 500 },
          )
        }
      },
    },
  },
})
