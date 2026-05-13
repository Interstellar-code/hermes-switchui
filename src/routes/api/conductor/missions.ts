import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { createMission, listMissions } from '../../../server/conductor-store'

export const Route = createFileRoute('/api/conductor/missions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const missions = await listMissions()
          return json(missions)
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list missions',
            },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const title =
            typeof body.title === 'string' ? body.title.trim() : ''
          if (!title) {
            return json({ error: 'title required' }, { status: 400 })
          }
          const subtitle =
            typeof body.subtitle === 'string' ? body.subtitle.trim() : undefined
          const mission = await createMission({ title, subtitle })
          return json(mission, { status: 201 })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to create mission',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
