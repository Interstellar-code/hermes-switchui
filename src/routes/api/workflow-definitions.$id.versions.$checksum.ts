/**
 * GET /api/workflow-definitions/:id/versions/:checksum
 *
 * One snapshot with its yaml (engine feature `definition_versions`).
 * 404 passthrough for unknown id, unknown checksum, or a checksum that
 * belongs to another workflow; engine down → 503 engine_ok:false.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { WORKFLOW_ID_RE } from '../../server/workflow-id'
import { getEngine } from '../../server/workflow-engine/factory'
import { WorkflowNotFoundError } from '../../server/workflow-engine/clients/plugin-client'

export const Route = createFileRoute(
  '/api/workflow-definitions/$id/versions/$checksum',
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (!WORKFLOW_ID_RE.test(params.id)) {
          return Response.json(
            { error: 'id must be 1-128 chars of [A-Za-z0-9_:.-]' },
            { status: 400 },
          )
        }
        try {
          const version = await getEngine().getDefinitionVersion(
            params.id,
            params.checksum,
          )
          return Response.json({ version })
        } catch (err) {
          if (err instanceof WorkflowNotFoundError)
            return Response.json({ error: err.message }, { status: 404 })
          const message = err instanceof Error ? err.message : String(err)
          console.warn(
            `[workflow-definitions/${params.id}/versions/${params.checksum}] engine unavailable: ${message}`,
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
