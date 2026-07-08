import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readPersona } from '../../../server/personas-browser'

export const Route = createFileRoute('/api/personas/read')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const id = url.searchParams.get('id')
          if (!id) {
            return Response.json({ error: 'id query param is required' }, { status: 400 })
          }
          const persona = readPersona(id)
          if (!persona) {
            return Response.json({ error: 'Persona not found' }, { status: 404 })
          }
          return Response.json({ persona })
        } catch (error) {
          return Response.json(
            {
              error: error instanceof Error ? error.message : 'Failed to read persona',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
