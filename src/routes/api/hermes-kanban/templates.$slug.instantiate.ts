import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { instantiateTemplate } from '../../../server/hermes-kanban-client'
import type { InstantiateInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/templates/$slug/instantiate')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: InstantiateInput
        try {
          body = (await request.json()) as InstantiateInput
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        try {
          const result = await instantiateTemplate(params.slug, body)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Instantiate failed'
          const status = msg.includes('413')
            ? 413
            : msg.includes('409')
              ? 409
              : msg.includes('422')
                ? 422
                : msg.includes('404')
                  ? 404
                  : msg.includes('400')
                    ? 400
                    : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
