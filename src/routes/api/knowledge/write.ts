import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  KnowledgeConflictError,
  deleteKnowledgePage,
  writeKnowledgePage,
} from '../../../server/knowledge-browser'
import { isMemoryProfile } from '../../../server/memory-profile'

export const Route = createFileRoute('/api/knowledge/write')({
  server: {
    handlers: {
      // POST { path, content, expectedModified?, createOnly?, profile? } → create
      // or overwrite a page. 409 if the file changed since `expectedModified`
      // (the `modified` the editor loaded), or if `createOnly` and it exists.
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        type WriteBody = {
          path?: string
          content?: string
          expectedModified?: unknown
          createOnly?: unknown
          profile?: unknown
        }
        let body: WriteBody
        try {
          body = (await request.json()) as WriteBody
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { path: pagePath, content } = body
        if (!pagePath || typeof content !== 'string') {
          return Response.json(
            { error: 'path and content are required' },
            { status: 400 },
          )
        }
        if (body.profile !== undefined && !isMemoryProfile(body.profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }
        try {
          const meta = writeKnowledgePage(pagePath, content, {
            expectedModified:
              typeof body.expectedModified === 'string'
                ? body.expectedModified
                : undefined,
            createOnly: body.createOnly === true,
            profile: body.profile,
          })
          return Response.json({ page: meta })
        } catch (error) {
          if (error instanceof KnowledgeConflictError) {
            return Response.json(
              { error: error.message, conflict: true, current: error.current },
              { status: 409 },
            )
          }
          const message =
            error instanceof Error ? error.message : 'Failed to write page'
          const status =
            /not allowed|outside knowledge root|required|traversal|github/i.test(
              message,
            )
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
        let body: { path?: string; profile?: unknown }
        try {
          body = (await request.json()) as { path?: string; profile?: unknown }
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { path: pagePath } = body
        if (!pagePath) {
          return Response.json({ error: 'path is required' }, { status: 400 })
        }
        if (body.profile !== undefined && !isMemoryProfile(body.profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }
        try {
          deleteKnowledgePage(pagePath, body.profile)
          return Response.json({ ok: true })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to delete page'
          const status =
            /not allowed|outside knowledge root|required|traversal|github/i.test(
              message,
            )
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
