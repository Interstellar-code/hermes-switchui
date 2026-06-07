import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  deleteUserCommand,
  isCommandStoreError,
  updateUserCommand,
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

export const Route = createFileRoute('/api/commands/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const body = (await request.json()) as Record<string, unknown>
          const command = updateUserCommand(params.id, body)
          return Response.json({ command })
        } catch (error) {
          return errorResponse(error, 'Failed to update command')
        }
      },

      DELETE: ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const deleted = deleteUserCommand(params.id)
          if (!deleted) {
            return Response.json(
              { error: 'Command not found' },
              { status: 404 },
            )
          }
          return Response.json({ ok: true })
        } catch (error) {
          return errorResponse(error, 'Failed to delete command')
        }
      },
    },
  },
})
