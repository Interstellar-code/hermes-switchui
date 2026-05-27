import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { PluginClient } from '../../../server/workflow-engine/clients/plugin-client'

export interface WorkerRun {
  runId: string
  nodeId: string
  workflowId: string
  status: 'running' | 'waiting'
  label: string
  elapsed: string
  startedAt: number
}

export interface WorkerLane {
  id: string
  name: string
  role: string
  activeCount: number
  runs: Array<WorkerRun>
}

function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalS / 60).toString().padStart(2, '0')
  const ss = (totalS % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

const pluginClient = new PluginClient()

export const Route = createFileRoute('/api/conductor/workers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const activeRuns = await pluginClient.listActiveNodeRuns()

          const now = Date.now()

          // Group by workerId (or fall back to 'engine' lane)
          const laneMap = new Map<string, WorkerLane>()
          for (const row of activeRuns) {
            const agentKey = row.workerId ?? 'engine'
            if (!laneMap.has(agentKey)) {
              laneMap.set(agentKey, {
                id: agentKey,
                name: agentKey,
                role: row.workerId ? 'agent' : 'engine',
                activeCount: 0,
                runs: [],
              })
            }
            const lane = laneMap.get(agentKey)!
            const startedAt = row.startedAt ? new Date(row.startedAt).getTime() : now
            const elapsedMs = now - startedAt
            lane.runs.push({
              runId: row.runId,
              nodeId: row.nodeId,
              workflowId: row.workflowId,
              status: row.status,
              label: row.nodeId,
              elapsed: formatElapsed(elapsedMs),
              startedAt,
            })
            lane.activeCount = lane.runs.length
          }

          return Response.json({ lanes: Array.from(laneMap.values()) })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to query workers',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
