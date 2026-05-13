import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { createAgent, listAgents } from '../../../server/operations-store'

export const Route = createFileRoute('/api/operations/agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const agents = await listAgents()
          return json(agents)
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : 'Failed to list agents' },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const body = (await request.json()) as { name?: string; role?: string; task?: string }
          const name = (body.name ?? '').trim()
          if (!name) return json({ error: 'name is required' }, { status: 400 })
          const role = body.role === 'orchestrator' ? 'orchestrator' : 'worker'
          const agent = await createAgent({ name, role, task: (body.task ?? '').trim() })
          return json(agent)
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : 'Failed to create agent' },
            { status: 500 },
          )
        }
      },
    },
  },
})
