import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { deleteKnowledgePage, writeKnowledgePage } from '../../../server/knowledge-browser'

export const Route = createFileRoute('/api/knowledge/write')({
  server: {
    handlers: {
      // POST { path, content } → create or overwrite a page
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        let body: { path?: string; content?: string }
        try {
          body = (await request.json()) as { path?: string; content?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { path: pagePath, content } = body
        if (!pagePath || typeof content !== 'string') {
          return Response.json({ error: 'path and content are required' }, { status: 400 })
        }
        try {
          const meta = writeKnowledgePage(pagePath, content)
          return Response.json({ page: meta })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to write page'
          const status = /not allowed|outside knowledge root|required|traversal|github/i.test(message)
            ? 400
            : 500
          return Response.json({ error: message }, { status })
        }
      },

      // DELETE { path } → delete a page
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        let body: { path?: string }
        try {
          body = (await request.json()) as { path?: string }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { path: pagePath } = body
        if (!pagePath) {
          return Response.json({ error: 'path is required' }, { status: 400 })
        }
        try {
          deleteKnowledgePage(pagePath)
          return Response.json({ ok: true })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete page'
          const status = /not allowed|outside knowledge root|required|traversal|github/i.test(message)
            ? 400
            : /ENOENT/.test(message)
              ? 404
              : 500
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
