import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { deleteTemplate, getTemplate, updateTemplate } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/templates/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await getTemplate(params.slug)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Dashboard unavailable'
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

      PUT: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { yaml: string }
        try {
          body = (await request.json()) as { yaml: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.yaml || typeof body.yaml !== 'string') {
          return Response.json({ error: 'yaml is required' }, { status: 422 })
        }
        try {
          const result = await updateTemplate(params.slug, body.yaml)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Update failed'
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

      DELETE: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await deleteTemplate(params.slug)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Delete failed'
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
