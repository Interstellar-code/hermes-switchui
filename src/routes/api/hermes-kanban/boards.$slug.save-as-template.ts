import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { saveBoardAsTemplate } from '../../../server/hermes-kanban-client'
import type { SaveAsTemplateInput } from '../../../lib/hermes-kanban-types'

export const Route = createFileRoute('/api/hermes-kanban/boards/$slug/save-as-template')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: SaveAsTemplateInput
        try {
          body = (await request.json()) as SaveAsTemplateInput
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        if (!body.template_slug || typeof body.template_slug !== 'string') {
          return Response.json({ error: 'template_slug is required' }, { status: 422 })
        }
        try {
          const result = await saveBoardAsTemplate(params.slug, body)
          return Response.json(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Save as template failed'
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
