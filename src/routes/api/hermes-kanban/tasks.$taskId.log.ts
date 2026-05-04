import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanTaskLog } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/tasks/$taskId/log')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const tail = url.searchParams.has('tail')
          ? Number(url.searchParams.get('tail'))
          : undefined
        try {
          const log = await getKanbanTaskLog(params.taskId, tail)
          return json({ log })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Log unavailable'
          const status = msg.includes('404') ? 404 : 503
          return json({ error: msg }, { status })
        }
      },
    },
  },
})
