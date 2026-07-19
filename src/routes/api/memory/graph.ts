import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  EDGE_TYPES,
  MAX_LIMIT,
  buildMemoryGraph,
} from '../../../server/memory-graph'
import type { MemoryGraphEdgeType } from '../../../server/memory-graph'

// Strict-ish ISO-8601: date, optional time, optional zone. Rejects garbage
// while accepting the TEXT timestamps stored in graph_edges.
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export const Route = createFileRoute('/api/memory/graph')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)

        let limit: number | undefined
        const rawLimit = url.searchParams.get('limit')
        if (rawLimit !== null) {
          const n = Number(rawLimit)
          if (!Number.isInteger(n) || n < 1) {
            return bad('limit must be a positive integer')
          }
          limit = Math.min(n, MAX_LIMIT) // clamp, do not reject
        }

        let edgeType: MemoryGraphEdgeType | null = null
        const rawEdgeType = url.searchParams.get('edgeType')
        if (rawEdgeType !== null) {
          if (!EDGE_TYPES.includes(rawEdgeType as MemoryGraphEdgeType)) {
            return bad("edgeType must be one of: 'ctx', 'references'")
          }
          edgeType = rawEdgeType as MemoryGraphEdgeType
        }

        let since: string | null = null
        const rawSince = url.searchParams.get('since')
        if (rawSince !== null) {
          if (!ISO_RE.test(rawSince) || Number.isNaN(Date.parse(rawSince))) {
            return bad('since must be an ISO-8601 timestamp')
          }
          since = rawSince
        }

        try {
          const graph = buildMemoryGraph({ limit, edgeType, since })
          return Response.json(graph, {
            headers: { 'Cache-Control': 'private, no-store' },
          })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to build memory graph'
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
