import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readPersona } from '../../../server/personas-browser'

export const Route = createFileRoute('/api/personas/read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const id = url.searchParams.get('id')
          if (!id) {
            return json({ error: 'id query param is required' }, { status: 400 })
          }
          const persona = readPersona(id)
          if (!persona) {
            return json({ error: 'Persona not found' }, { status: 404 })
          }
          return json({ persona })
        } catch (error) {
          return json(
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
