import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { writeKnowledgePage, deleteKnowledgePage } from '../../../server/knowledge-browser'

export const Route = createFileRoute('/api/knowledge/write')({
  server: {
    handlers: {
      // POST { path, content } → create or overwrite a page
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        let body: { path?: string; content?: string }
        try {
          body = (await request.json()) as { path?: string; content?: string }
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { path: pagePath, content } = body
        if (!pagePath || typeof content !== 'string') {
          return json({ error: 'path and content are required' }, { status: 400 })
        }
        try {
          const meta = writeKnowledgePage(pagePath, content)
          return json({ page: meta })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to write page'
          const status = /not allowed|outside knowledge root|required|traversal|github/i.test(message)
            ? 400
            : 500
          return json({ error: message }, { status })
        }
      },

      // DELETE { path } → delete a page
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: { path?: string }
        try {
          body = (await request.json()) as { path?: string }
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { path: pagePath } = body
        if (!pagePath) {
          return json({ error: 'path is required' }, { status: 400 })
        }
        try {
          deleteKnowledgePage(pagePath)
          return json({ ok: true })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to delete page'
          const status = /not allowed|outside knowledge root|required|traversal|github/i.test(message)
            ? 400
            : /ENOENT/.test(message)
              ? 404
              : 500
          return json({ error: message }, { status })
        }
      },
    },
  },
})
