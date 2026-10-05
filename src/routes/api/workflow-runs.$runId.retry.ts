/**
 * POST /api/workflow-runs/:runId/retry  { from_node_id? }
 *
 * Re-runs a failed/cancelled/crashed run in place (plugin feature `retry_run`).
 * The actor is set server-side; plugin errors are mapped to generic messages
 * plus a stable `code` the UI can branch on:
 *   409 live_owner       — the previous owner is still stopping; try again shortly
 *   409 already_retried  — another retry won the race (the UI treats it as success)
 *   409 not_retryable    — completed or paused runs
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { WORKFLOW_ID_RE } from '../../server/workflow-id'
import { getEngine } from '../../server/workflow-engine/factory'
import { WorkflowRetryError } from '../../server/workflow-engine/clients/plugin-client'

function conflictCode(message: string) {
  if (message.includes('live process')) return 'live_owner'
  if (message.includes('already retried')) return 'already_retried'
  return 'not_retryable'
}

const CONFLICT_TEXT = {
  live_owner: 'Run is still stopping — try again shortly',
  already_retried: 'Run was already retried',
  not_retryable: 'Only failed, cancelled or crashed runs can be retried',
} as const

export const Route = createFileRoute('/api/workflow-runs/$runId/retry')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!WORKFLOW_ID_RE.test(params.runId)) {
          return Response.json({ error: 'Invalid run id' }, { status: 400 })
        }
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const fromNodeId =
          body && typeof body === 'object'
            ? (body as { from_node_id?: unknown }).from_node_id
            : undefined
        if (
          fromNodeId != null &&
          (typeof fromNodeId !== 'string' || !WORKFLOW_ID_RE.test(fromNodeId))
        ) {
          return Response.json(
            { error: 'Invalid from_node_id' },
            { status: 400 },
          )
        }
        try {
          const run = await getEngine().retryRun(params.runId, {
            ...(fromNodeId ? { from_node_id: fromNodeId } : {}),
            actor: 'switchui',
          })
          return Response.json({ run })
        } catch (err) {
          if (err instanceof WorkflowRetryError) {
            if (err.status === 404)
              return Response.json({ error: 'Run not found' }, { status: 404 })
            if (err.status === 409) {
              const code = conflictCode(err.message)
              return Response.json(
                { error: CONFLICT_TEXT[code], code },
                { status: 409 },
              )
            }
            return Response.json(
              {
                error: fromNodeId
                  ? `Node "${fromNodeId}" is not part of this run`
                  : 'Invalid retry request',
              },
              { status: 400 },
            )
          }
          return Response.json(
            { error: 'Failed to retry run' },
            { status: 502 },
          )
        }
      },
    },
  },
})
