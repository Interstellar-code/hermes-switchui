import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { openDb, defaultWorkflowDbPath } from '../../../server/workflow-engine/db/client'
import { runMigrations } from '../../../server/workflow-engine/db/migrate'

export interface WorkerRun {
  runId: string
  nodeId: string
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

interface ActiveNodeRow {
  id: string
  workflow_run_id: string
  dag_node_id: string
  node_type: string
  assigned_agent: string | null
  started_at: number | null
}

function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalS / 60).toString().padStart(2, '0')
  const ss = (totalS % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

let _dbReady = false
function ensureDb() {
  if (_dbReady) return openDb(defaultWorkflowDbPath())
  const db = openDb(defaultWorkflowDbPath())
  runMigrations(db)
  _dbReady = true
  return db
}

export const Route = createFileRoute('/api/conductor/workers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const db = ensureDb()
          const rows = db
            .prepare<[], ActiveNodeRow>(
              `SELECT id, workflow_run_id, dag_node_id, node_type, assigned_agent, started_at
               FROM node_runs
               WHERE status = 'running'
               ORDER BY started_at ASC`,
            )
            .all()

          const now = Date.now()

          // Group by assigned_agent (or fall back to 'engine' lane)
          const laneMap = new Map<string, WorkerLane>()
          for (const row of rows) {
            const agentKey = row.assigned_agent ?? 'engine'
            if (!laneMap.has(agentKey)) {
              laneMap.set(agentKey, {
                id: agentKey,
                name: agentKey,
                role: row.assigned_agent ? 'agent' : 'engine',
                activeCount: 0,
                runs: [],
              })
            }
            const lane = laneMap.get(agentKey)!
            const startedAt = row.started_at ?? now
            const elapsedMs = now - startedAt
            lane.runs.push({
              runId: row.workflow_run_id,
              nodeId: row.dag_node_id,
              label: row.dag_node_id,
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
