/**
 * GET /api/workflow-runs/:runId/definition
 *
 * Thin proxy for the plugin's pinned-definition endpoint (feature `definition_pin`).
 * A plugin without it (or an unknown run) answers 404 → `{ available: false }`.
 * The plugin's `parsed` has no depends_on, so `parsed` is re-projected from
 * the pinned `yaml` with the same logic as /workflow-definitions/:id/parsed
 * (null when the YAML does not parse).
 */
import { createFileRoute } from '@tanstack/react-router'
import { parse as parseYaml } from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import { WORKFLOW_ID_RE } from '../../server/workflow-id'
import { dashboardFetch } from '../../server/gateway-capabilities'
import { projectWorkflow } from '../../server/workflow-parsed'
import type { WorkflowDoc } from '../../server/workflow-parsed'

function project(definition: unknown) {
  const d = definition as { yaml?: unknown; workflow_id?: unknown } | null
  if (typeof d?.yaml !== 'string') return null
  try {
    const doc = (parseYaml(d.yaml) ?? {}) as WorkflowDoc
    const name = typeof d.workflow_id === 'string' ? d.workflow_id : ''
    return projectWorkflow(doc, { name, description: '' })
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/workflow-runs/$runId/definition')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (!WORKFLOW_ID_RE.test(params.runId)) {
          return Response.json({ error: 'Invalid run id' }, { status: 400 })
        }
        try {
          const res = await dashboardFetch(
            `/api/plugins/workflow-engine/runs/${encodeURIComponent(params.runId)}/definition`,
          )
          if (res.status === 404) return Response.json({ available: false })
          if (!res.ok) {
            return Response.json(
              { error: 'Failed to load definition' },
              { status: 502 },
            )
          }
          const body = (await res.json()) as { definition?: unknown }
          return Response.json({
            available: true,
            ...body,
            parsed: project(body.definition),
          })
        } catch {
          return Response.json(
            { error: 'Failed to load definition' },
            { status: 502 },
          )
        }
      },
    },
  },
})
