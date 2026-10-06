/**
 * GET /api/workflow-definitions/:id/parsed
 *
 * Fetches the definition (and its raw YAML) from the plugin, then projects
 * a UI-friendly shape locally. The plugin's own parsed endpoint returns a
 * thinner shape than the editor needs; doing the projection here keeps
 * switchui independent of plugin response evolution.
 */
import { createFileRoute } from '@tanstack/react-router'
import { parse as parseYaml } from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import { getEngine } from '../../server/workflow-engine/factory'
import { projectWorkflow } from '../../server/workflow-parsed'
import type { WorkflowDoc } from '../../server/workflow-parsed'

export const Route = createFileRoute('/api/workflow-definitions/$id/parsed')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })

        const engine = getEngine()
        const def = await engine.getDefinition(params.id)
        if (!def) return Response.json({ error: 'not found' }, { status: 404 })

        const etag = `"${def.checksum}"`
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch && ifNoneMatch === etag) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': 'private, max-age=30' },
          })
        }

        let doc: WorkflowDoc
        try {
          doc = parseYaml(def.yaml) ?? {}
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return Response.json(
            { error: msg, errorType: 'yaml_parse' },
            { status: 422 },
          )
        }

        const payload = {
          definition: def,
          parsed: projectWorkflow(doc, def),
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ETag: etag,
            'Cache-Control': 'private, max-age=30',
          },
        })
      },
    },
  },
})
