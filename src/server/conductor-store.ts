/**
 * conductor-store.ts — Live mission projection from workflow_runs.
 *
 * Each workflow_run row is projected to a Mission on-the-fly.
 * No file-backed seed data. createMission returns 501 (use /workflows).
 * abortMission returns 501 (engine abort not yet wired).
 *
 * NOTE: Previously read workflow_runs directly from the local SQLite file,
 * which caused split-brain when the workflow-engine plugin owns the DB.
 * Now delegates to getEngine() so plugin-backed deployments see live data.
 */

import { getEngine } from './workflow-engine/factory'
import type { WorkflowRun } from './workflow-engine/interface'

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

function toMs(d: Date | number | undefined | null): number {
  if (d == null) return Date.now()
  return d instanceof Date ? d.getTime() : (d as number)
}

function runToMission(run: WorkflowRun): Mission {
  const now = Date.now()
  const status = mapStatus(run.status)
  const startedAtMs = toMs(run.started_at)
  const completedAtMs = run.completed_at != null ? toMs(run.completed_at) : null

  let elapsedMs: number
  if (status === 'live') {
    elapsedMs = now - startedAtMs
  } else if (completedAtMs != null) {
    elapsedMs = completedAtMs - startedAtMs
  } else {
    elapsedMs = now - startedAtMs
  }

  // TODO: token_usage not yet in workflow_runs schema
  const tokens = '—'

  // Build a human subtitle from phase + workflow id
  const subtitle = `${run.workflow_id} · ${run.current_phase}`

  return {
    id: run.id,
    title: run.workflow_id,
    subtitle,
    status,
    elapsed: formatElapsed(elapsedMs),
    tokens,
    action: deriveAction(status),
    dayGroup: computeDayGroup(startedAtMs),
    createdAt: startedAtMs,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listMissions(request: Request): Promise<Array<Mission>> {
  try {
    const engine = getEngine()
    const runs = await engine.listRuns({ limit: 200 })
    return runs.map(runToMission)
  } catch {
    return []
  }
}

export async function getMission(request: Request, id: string): Promise<Mission | null> {
  try {
    const engine = getEngine()
    const run = await engine.getRun(id)
    return run ? runToMission(run) : null
  } catch {
    return null
  }
}

export async function createMission(_input: {
  title: string
  subtitle?: string
}): Promise<Mission> {
  throw Object.assign(new Error('createMission: use /api/workflow-runs to start a run'), {
    status: 501,
  })
}

export async function abortMission(_id: string): Promise<void> {
  throw Object.assign(new Error('abortMission: engine abort not yet wired'), {
    status: 501,
  })
}

export async function getConductorState(_request: Request): Promise<{
  missions: Array<Mission>
}> {
  return { missions: [] }
}
