import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../../server/auth-middleware'
import {
  NODE_ID_MAX,
  getMemoryGraphNode,
} from '../../../../server/memory-graph-node'
import { isMemoryProfile } from '../../../../server/memory-profile'

export const Route = createFileRoute('/api/memory/graph/node')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const id = url.searchParams.get('id') ?? ''
        if (!id.trim() || id.length > NODE_ID_MAX) {
          return Response.json({ error: 'id is required' }, { status: 400 })
        }
        const profile = url.searchParams.get('profile')
        if (profile !== null && !isMemoryProfile(profile)) {
          return Response.json({ error: 'unknown profile' }, { status: 400 })
        }

        try {
          const node = getMemoryGraphNode(id, profile ?? undefined)
          if (!node) {
            return Response.json({ error: 'Node not found' }, { status: 404 })
          }
          return Response.json(node, {
            headers: { 'Cache-Control': 'private, no-store' },
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to load node'
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
