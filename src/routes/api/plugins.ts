import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { listWorkspacePlugins } from '../../server/plugins-browser'

export const Route = createFileRoute('/api/plugins')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return Response.json({ ok: true, plugins: listWorkspacePlugins() })
      },
    },
  },
})
