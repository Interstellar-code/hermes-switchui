import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { listTemplates, saveTemplate } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/templates')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const result = await listTemplates()
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Dashboard unavailable'
          return Response.json({ error: msg, mode: 'dashboard-unavailable' }, { status: 503 })
        }
      },

      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { yaml: string; slug?: string }
        try {
          body = (await request.json()) as { yaml: string; slug?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.yaml || typeof body.yaml !== 'string') {
          return Response.json({ error: 'yaml is required' }, { status: 422 })
        }
        try {
          const result = await saveTemplate(body.yaml, body.slug)
          return Response.json(result, { status: 201 })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create template'
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
