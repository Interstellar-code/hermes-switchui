import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { createDispatch } from '../../../server/operations-store'

export const Route = createFileRoute('/api/operations/dispatch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as {
            prompt: string
            mode?: string
            priority?: string
            budget?: string
            deadline?: string
            tags?: Array<string>
          }
          if (!body.prompt) {
            return json({ error: 'prompt required' }, { status: 400 })
          }
          const dispatch = await createDispatch(body)
          return json({ ok: true, dispatchId: dispatch.id })
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : 'Failed to dispatch' },
            { status: 500 },
          )
        }
      },
    },
  },
})
