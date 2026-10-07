/**
 * GET /api/workflow-definitions/:id/versions
 *
 * Snapshot history for a definition (engine feature `definition_versions`),
 * newest first. 404 passthrough for unknown ids; engine down → 503
 * engine_ok:false.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { WORKFLOW_ID_RE } from '../../server/workflow-id'
import { getEngine } from '../../server/workflow-engine/factory'
import { WorkflowNotFoundError } from '../../server/workflow-engine/clients/plugin-client'

export const Route = createFileRoute('/api/workflow-definitions/$id/versions')({
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
          const versions = await getEngine().listDefinitionVersions(params.id)
          return Response.json({ versions })
        } catch (err) {
          if (err instanceof WorkflowNotFoundError)
            return Response.json({ error: err.message }, { status: 404 })
          const message = err instanceof Error ? err.message : String(err)
          console.warn(
            `[workflow-definitions/${params.id}/versions] engine unavailable: ${message}`,
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
