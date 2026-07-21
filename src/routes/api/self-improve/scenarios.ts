import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  createScenario,
  listScenarios,
} from '../../../server/self-improve-client'
import type { ScenarioCheck } from '../../../lib/self-improve-types'

const CHECK_TYPES = new Set([
  'must_contain',
  'must_not_contain',
  'max_tokens',
  'tool_used',
  'judge',
])

function isScenarioCheck(value: unknown): value is ScenarioCheck {
  if (!value || typeof value !== 'object') return false
  const check = value as Record<string, unknown>
  if (typeof check.type !== 'string' || !CHECK_TYPES.has(check.type))
    return false
  if (check.type === 'max_tokens') {
    return Number.isInteger(check.value) && Number(check.value) > 0
  }
  if (check.type === 'judge') {
    return typeof check.rubric === 'string' && check.rubric.trim().length > 0
  }
  return typeof check.value === 'string' && check.value.trim().length > 0
}

export const Route = createFileRoute('/api/self-improve/scenarios')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile') ?? ''
        if (!profile) {
          return Response.json(
            { error: 'profile query param required' },
            { status: 400 },
          )
        }
        const includeHoldout = url.searchParams.get('include_holdout') === '1'
        try {
          const scenarios = await listScenarios(profile, includeHoldout)
          return Response.json({ scenarios })
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Self-Improve plugin unavailable'
          const status =
            msg.includes('404') || msg.includes('not found') ? 404 : 503
          return Response.json({ error: msg }, { status })
        }
      },

      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        let body: {
          profile?: string
          name?: string
          input?: string
          checks?: unknown
          holdout?: boolean
        }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const profile =
          typeof body.profile === 'string' ? body.profile.trim() : ''
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!profile || !name) {
          return Response.json(
            { error: 'profile and name are required' },
            { status: 400 },
          )
        }
        if (body.input !== undefined && typeof body.input !== 'string') {
          return Response.json(
            { error: 'input must be a string' },
            { status: 400 },
          )
        }
        if (
          !Array.isArray(body.checks) ||
          body.checks.length === 0 ||
          !body.checks.every(isScenarioCheck)
        ) {
          return Response.json(
            {
              error: 'checks must contain at least one valid structured check',
            },
            { status: 400 },
          )
        }
        try {
          const result = await createScenario({
            profile,
            name,
            input: body.input?.trim(),
            checks: body.checks,
            holdout: body.holdout,
          })
          return Response.json(result, { status: 201 })
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Self-Improve plugin unavailable'
          const status = msg.includes('422')
            ? 422
            : msg.includes('400')
              ? 400
              : 503
          return Response.json({ error: msg }, { status })
        }
      },
    },
  },
})
