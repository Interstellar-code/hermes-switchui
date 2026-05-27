import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { startClaudeAgent } from '../../server/claude-agent'

export const Route = createFileRoute('/api/start-agent')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const result = await startClaudeAgent()
        return Response.json(result, { status: result.ok ? 200 : 500 })
      },
    },
  },
})
