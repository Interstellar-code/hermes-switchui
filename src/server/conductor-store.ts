/**
 * conductor-store.ts — Live mission projection from workflow_runs.
 *
 * Each workflow_run row is projected to a Mission on-the-fly.
 * No file-backed seed data. createMission returns 501 (use /workflows).
 * abortMission returns 501 (engine abort not yet wired).
 */

import { openDb, defaultWorkflowDbPath } from './workflow-engine/db/client'
import { runMigrations } from './workflow-engine/db/migrate'

export interface Mission {
  id: string
  title: string
  subtitle: string
  status: 'live' | 'done' | 'err'
  elapsed: string
  tokens: string
  action?: 'focus' | 'replay' | 'retry'
  dayGroup: 'now' | 'today' | 'yesterday'
  createdAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalS / 60)
    .toString()
    .padStart(2, '0')
  const ss = (totalS % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

function computeDayGroup(startedAtMs: number): Mission['dayGroup'] {
  const now = Date.now()
  const diffH = (now - startedAtMs) / 1000 / 3600
  if (diffH < 1) return 'now'
  if (diffH < 24) return 'today'
  return 'yesterday'
}

function deriveAction(status: Mission['status']): Mission['action'] {
  if (status === 'live') return 'focus'
  if (status === 'done') return 'replay'
  return 'retry'
}

// Map workflow_run.status → Mission.status
function mapStatus(runStatus: string): Mission['status'] {
  if (runStatus === 'running') return 'live'
  if (runStatus === 'completed' || runStatus === 'success') return 'done'
  if (
    runStatus === 'failed' ||
    runStatus === 'error' ||
    runStatus === 'cancelled'
  ) {
    return 'err'
  }
  // pending | paused → surface as done so UI doesn't show as live
  return 'done'
}

interface WorkflowRunRow {
  id: string
  workflow_id: string
  status: string
  started_at: number
  completed_at: number | null
  user_message: string
  current_phase: string
}

function rowToMission(row: WorkflowRunRow): Mission {
  const now = Date.now()
  const status = mapStatus(row.status)

  let elapsedMs: number
  if (status === 'live') {
    elapsedMs = now - row.started_at
  } else if (row.completed_at != null) {
    elapsedMs = row.completed_at - row.started_at
  } else {
    elapsedMs = now - row.started_at
  }

  // TODO: token_usage not yet in workflow_runs schema
  const tokens = '—'

  // Build a human subtitle from phase + workflow id
  const subtitle = `${row.workflow_id} · ${row.current_phase}`

  return {
    id: row.id,
    title: row.workflow_id,
    subtitle,
    status,
    elapsed: formatElapsed(elapsedMs),
    tokens,
    action: deriveAction(status),
    dayGroup: computeDayGroup(row.started_at),
    createdAt: row.started_at,
  }
}

// Ensure DB is open and migrated. Lazy-init on first call.
let _dbReady = false
function ensureDb() {
  const db = openDb(defaultWorkflowDbPath())
  if (!_dbReady) {
    runMigrations(db)
    _dbReady = true
  }
  return db
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listMissions(): Promise<Array<Mission>> {
  try {
    const db = ensureDb()
    const rows = db
      .prepare<[], WorkflowRunRow>(
        `SELECT id, workflow_id, status, started_at, completed_at, user_message, current_phase
         FROM workflow_runs
         ORDER BY started_at DESC
         LIMIT 200`,
      )
      .all()
    return rows.map(rowToMission)
  } catch {
    return []
  }
}

export async function getMission(id: string): Promise<Mission | null> {
  try {
    const db = ensureDb()
    const row = db
      .prepare<[string], WorkflowRunRow>(
        `SELECT id, workflow_id, status, started_at, completed_at, user_message, current_phase
         FROM workflow_runs
         WHERE id = ?`,
      )
      .get(id)
    return row ? rowToMission(row) : null
  } catch {
    return null
  }
}

export async function createMission(_input: {
  title: string
  subtitle?: string
}): Promise<never> {
  // Missions are created by dispatching a workflow from the /workflows page.
  const err = Object.assign(
    new Error('Create workflows from /workflows page'),
    { statusCode: 501 },
  )
  throw err
}

export async function abortMission(_id: string): Promise<never> {
  // TODO: wire to engine abort API when available
  const err = Object.assign(new Error('Abort not yet supported'), {
    statusCode: 501,
  })
  throw err
}

export async function getConductorState(): Promise<{
  liveMissions: number
  elapsed: string
  workersActive: number
  tokensUsed: string
}> {
  try {
    const db = ensureDb()

    // Live workflow_runs
    const liveRows = db
      .prepare<[], WorkflowRunRow>(
        `SELECT id, workflow_id, status, started_at, completed_at, user_message, current_phase
         FROM workflow_runs
         WHERE status = 'running'
         ORDER BY started_at ASC`,
      )
      .all()

    // Active node_runs count (real "workers" — DAG nodes currently executing)
    const activeNodesRow = db
      .prepare<[], { c: number }>(
        `SELECT COUNT(*) as c FROM node_runs WHERE status = 'running'`,
      )
      .get()
    const workersActive = activeNodesRow?.c ?? 0

    let elapsed = '00:00'
    if (liveRows.length > 0) {
      const oldest = liveRows[0]! // ORDER BY started_at ASC → first is oldest
      elapsed = formatElapsed(Date.now() - oldest.started_at)
    }

    return {
      liveMissions: liveRows.length,
      elapsed,
      workersActive,
      // TODO: token_usage column not yet in workflow_runs schema
      tokensUsed: '—',
    }
  } catch {
    return {
      liveMissions: 0,
      elapsed: '00:00',
      workersActive: 0,
      tokensUsed: '—',
    }
  }
}
