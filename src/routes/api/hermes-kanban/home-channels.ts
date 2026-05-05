import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getKanbanHomeChannels } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/home-channels')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const taskId = url.searchParams.get('task_id') ?? undefined
          const data = await getKanbanHomeChannels(taskId)
          return json(data)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Home channels unavailable'
          return json({ error: msg, channels: [] }, { status: 503 })
        }
      },
    },
  },
})
