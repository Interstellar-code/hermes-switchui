import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { purgeTrashedProfile } from '../../../server/profiles-trash'
import { requireJsonContentType } from '../../../server/rate-limit'
import { errorResponse } from './-error-response'

/**
 * DESTRUCTIVE — PERMANENT. This removes a trashed profile's directory from
 * disk (`fs.rmSync(..., { recursive: true, force: true })`) with no undo:
 * once this returns `{ ok: true }`, the profile's config, SOUL.md, memories
 * and sessions are gone for good. Only wire this up to a UI action that has
 * already gotten explicit user confirmation.
 */
export const Route = createFileRoute('/api/profiles/trash-purge')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as { id?: string }
          purgeTrashedProfile(body.id || '')
          return Response.json({ ok: true })
        } catch (error) {
          return errorResponse(error, 'Failed to permanently delete profile')
        }
      },
    },
  },
})
