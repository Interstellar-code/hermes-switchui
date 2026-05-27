import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { getToolArtifact } from '../../server/tool-artifacts-store'

export const Route = createFileRoute('/api/artifacts/$artifactId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const artifact = getToolArtifact(params.artifactId)
        if (!artifact) {
          return Response.json(
            { ok: false, error: 'Artifact not found' },
            { status: 404 },
          )
        }
        return Response.json({ ok: true, artifact })
      },
    },
  },
})
