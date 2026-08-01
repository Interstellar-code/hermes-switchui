import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../../server/rate-limit'
import { applyWorkspaceUpdate } from '../../../server/update-system'

export const Route = createFileRoute('/api/update/workspace')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`update-workspace:${getClientIp(request)}`, 3, 60_000)) {
          return rateLimitResponse()
        }
        let body: {
          expectedCurrentHead?: unknown
          expectedTargetHead?: unknown
        }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }
        if (
          typeof body.expectedCurrentHead !== 'string' ||
          typeof body.expectedTargetHead !== 'string' ||
          !body.expectedCurrentHead ||
          !body.expectedTargetHead
        ) {
          return Response.json(
            {
              ok: false,
              error: 'expectedCurrentHead and expectedTargetHead are required.',
            },
            { status: 400 },
          )
        }
        try {
          const result = applyWorkspaceUpdate({
            expectedCurrentHead: body.expectedCurrentHead,
            expectedTargetHead: body.expectedTargetHead,
          })
          return Response.json(result, { status: result.ok ? 200 : 409 })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
