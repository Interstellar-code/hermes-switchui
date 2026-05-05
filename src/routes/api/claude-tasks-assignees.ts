/**
 * DEPRECATED: /api/claude-tasks-assignees
 *
 * This route now redirects to /api/hermes-kanban/assignees which is the
 * canonical source of normalized Agent Kanban assignee data.
 *
 * Kept as a 308 redirect for one release cycle so any external callers
 * are forwarded to the correct endpoint without breaking.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

export const Route = createFileRoute('/api/claude-tasks-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }
        // 308 Permanent Redirect — external callers follow and update their bookmarks
        return new Response(null, {
          status: 308,
          headers: { Location: '/api/hermes-kanban/assignees' },
        })
      },
    },
  },
})
