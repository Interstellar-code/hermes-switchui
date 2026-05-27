import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { dispatchKanban } from '../../../server/hermes-kanban-client'

export const Route = createFileRoute('/api/hermes-kanban/dispatch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const max = url.searchParams.has('max')
          ? Number(url.searchParams.get('max'))
          : undefined
        const dryRun = url.searchParams.get('dry_run') === 'true'
        try {
          const result = await dispatchKanban(max, dryRun)
          return Response.json({ result })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Dispatch failed'
          return Response.json({ error: msg }, { status: 503 })
        }
      },
    },
  },
})
