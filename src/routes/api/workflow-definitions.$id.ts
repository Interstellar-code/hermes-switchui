/**
 * GET    /api/workflow-definitions/:id  — fetch one
 * DELETE /api/workflow-definitions/:id  — delete (project/user only; bundled is read-only)
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { getEngine } from '../../server/workflow-engine/factory'

export const Route = createFileRoute('/api/workflow-definitions/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const engine = getEngine()
        const def = await engine.getDefinition(params.id)
        if (!def) return Response.json({ error: 'not found' }, { status: 404 })
        return Response.json({ definition: def })
      },
      DELETE: async ({ request, params }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request))
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const engine = getEngine()
        const existing = await engine.getDefinition(params.id)
        if (!existing)
          return Response.json({ error: 'not found' }, { status: 404 })
        if (existing.source === 'bundled') {
          return Response.json(
            { error: 'bundled definitions are read-only' },
            { status: 403 },
          )
        }
        let rowsAffected: number
        try {
          rowsAffected = await engine.deleteWorkflowDefinition(params.id)
        } catch (err) {
          const status = (err as { status?: number }).status
          const rawMsg = err instanceof Error ? err.message : String(err)
          const is409 = status === 409 || /409\b/.test(rawMsg)
          if (is409) {
            // Strip PluginClient prefix if present: "PluginClient DELETE /definitions/x: 409 {body}"
            const match = rawMsg.match(/409\s+([\s\S]*)$/)
            const text = match ? match[1].trim() : rawMsg
            let engineBody: { error?: unknown; detail?: unknown } = {}
            try {
              engineBody = JSON.parse(text) as typeof engineBody
            } catch {
              // plain-text conflict
            }
            const error =
              typeof engineBody.error === 'string'
                ? engineBody.error
                : typeof engineBody.detail === 'string'
                  ? engineBody.detail
                  : text || rawMsg
            return Response.json({ error }, { status: 409 })
          }
          throw err
        }
        if (rowsAffected === 0)
          return Response.json({ error: 'not found' }, { status: 404 })
        // Phase 2: always plugin path — plugin manages its own manifest state.
        return Response.json({ ok: true })
      },
    },
  },
})
