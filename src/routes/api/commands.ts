import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  createUserCommand,
  isCommandStoreError,
  listUserCommands,
} from '../../server/commands-store'

function errorResponse(error: unknown, fallback: string): Response {
  if (isCommandStoreError(error)) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  )
}

export const Route = createFileRoute('/api/commands')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return Response.json({ commands: listUserCommands() })
        } catch (error) {
          return errorResponse(error, 'Failed to list commands')
        }
      },

      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const body = (await request.json()) as Record<string, unknown>
          const command = createUserCommand(body)
          return Response.json({ command }, { status: 201 })
        } catch (error) {
          return errorResponse(error, 'Failed to create command')
        }
      },
    },
  },
})
