/**
 * POST /api/workflow-definitions/validate
 *
 * Server-side lint of a draft definition via the engine's validate feature.
 * The static "validate" segment outranks the `$id` route by router
 * precedence, so this path never matches workflow-definitions.$id.
 * Body: {yaml: string, id?}: string. Empty yaml is forwarded (the engine
 * answers it with a schema error). Engine down → 503 engine_ok:false.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { WORKFLOW_ID_RE } from '../../server/workflow-id'
import { getEngine } from '../../server/workflow-engine/factory'
import { WorkflowPayloadTooLargeError } from '../../server/workflow-engine/clients/plugin-client'

const MAX_YAML_BYTES = 1024 * 1024

export const Route = createFileRoute('/api/workflow-definitions/validate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
        }
        const { yaml, id } = (body ?? {}) as { yaml?: unknown; id?: unknown }
        if (typeof yaml !== 'string') {
          return Response.json(
            { error: 'yaml must be a string' },
            { status: 400 },
          )
        }
        if (Buffer.byteLength(yaml, 'utf8') > MAX_YAML_BYTES) {
          return Response.json(
            { error: `yaml exceeds ${MAX_YAML_BYTES} bytes` },
            { status: 413 },
          )
        }
        if (
          id !== undefined &&
          (typeof id !== 'string' || !WORKFLOW_ID_RE.test(id))
        ) {
          return Response.json(
            { error: 'id must be 1-128 chars of [A-Za-z0-9_:.-]' },
            { status: 400 },
          )
        }

        try {
          const report = await getEngine().validateDefinition(
            yaml,
            typeof id === 'string' ? id : undefined,
          )
          return Response.json(report)
        } catch (err) {
          if (err instanceof WorkflowPayloadTooLargeError)
            return Response.json({ error: err.message }, { status: 413 })
          const message = err instanceof Error ? err.message : String(err)
          console.warn(
            `[workflow-definitions/validate] engine unavailable: ${message}`,
          )
          return Response.json(
            { engine_ok: false, error: 'Workflow engine unavailable' },
            { status: 503 },
          )
        }
      },
    },
  },
})
