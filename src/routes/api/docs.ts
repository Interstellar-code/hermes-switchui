import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getAdjacentPages,
  loadDocPage,
  scanDocsTree,
} from '../../server/docs-content'
import { renderMarkdown } from '../../server/docs-render'

export const Route = createFileRoute('/api/docs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const slug = url.searchParams.get('slug')
        const tree = scanDocsTree()

        if (!slug) {
          return Response.json({ ok: true, tree })
        }

        const page = loadDocPage(slug)
        if (!page) {
          return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
        }
        const html = await renderMarkdown(page.content, { slug: page.slug })
        const adj = getAdjacentPages(slug)

        return Response.json({
          ok: true,
          tree,
          page: {
            slug: page.slug,
            title: page.title,
            description: page.description,
            content: page.content,
          },
          html,
          prev: adj.prev,
          next: adj.next,
        })
      },
    },
  },
})
