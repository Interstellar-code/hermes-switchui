import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { createAgent, listAgents } from '../../../server/operations-store'

export const Route = createFileRoute('/api/operations/agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const agents = await listAgents()
          return Response.json(agents)
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to list agents' },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as { name?: string; role?: string; task?: string }
          const name = (body.name ?? '').trim()
          if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
          const role = body.role === 'orchestrator' ? 'orchestrator' : 'worker'
          const agent = await createAgent({ name, role, task: (body.task ?? '').trim() })
          return Response.json(agent)
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to create agent' },
            { status: 500 },
          )
        }
      },
    },
  },
})
