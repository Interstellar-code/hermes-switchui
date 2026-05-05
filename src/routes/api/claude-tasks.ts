/**
 * DEPRECATED: /api/claude-tasks
 *
 * Redirects to the canonical Hermes Kanban routes:
 *   GET  → 308 → /api/hermes-kanban/board
 *   POST → 308 → /api/hermes-kanban/tasks
 *
 * Kept for one release cycle. External callers should update to /api/hermes-kanban/*.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

export const Route = createFileRoute('/api/claude-tasks')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }
        return new Response(null, { status: 308, headers: { Location: '/api/hermes-kanban/board' } })
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }
        return new Response(null, { status: 308, headers: { Location: '/api/hermes-kanban/tasks' } })
      },
    },
  },
})
