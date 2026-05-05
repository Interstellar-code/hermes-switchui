/**
 * DEPRECATED: /api/claude-tasks/$taskId
 *
 * Redirects to the canonical Hermes Kanban route:
 *   GET / PATCH / DELETE → 308 → /api/hermes-kanban/tasks/$taskId
 *
 * Kept for one release cycle. External callers should update to /api/hermes-kanban/*.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

export const Route = createFileRoute('/api/claude-tasks/$taskId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        return new Response(null, { status: 308, headers: { Location: `/api/hermes-kanban/tasks/${params.taskId}` } })
      },
      PATCH: async ({ request, params }) => {
        if (!isAuthenticated(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        return new Response(null, { status: 308, headers: { Location: `/api/hermes-kanban/tasks/${params.taskId}` } })
      },
      DELETE: async ({ request, params }) => {
        if (!isAuthenticated(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        // DELETE is mapped to archive. Return 410 with migration instructions.
        return new Response(
          JSON.stringify({
            error: 'Hard-delete is not supported. Use PATCH status:archived or POST /api/hermes-kanban/bulk to archive.',
            successor: `/api/hermes-kanban/tasks/${params.taskId}`,
          }),
          { status: 410, headers: { 'Content-Type': 'application/json' } },
        )
      },
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        return new Response(null, { status: 308, headers: { Location: `/api/hermes-kanban/tasks/${params.taskId}` } })
      },
    },
  },
})
