/**
 * conductor-store.ts — Live mission projection from workflow_runs.
 *
 * Each workflow_run row is projected to a Mission on-the-fly (no stored state).
 * One listRuns per snapshot: missions and stats are derived from the same fetch.
 */

import { getEngine } from './workflow-engine/factory'
import { PluginClient } from './workflow-engine/clients/plugin-client'
import type { WorkflowRun } from './workflow-engine/interface'

export interface Mission {
  id: string
  title: string
  subtitle: string
  status: 'live' | 'waiting' | 'queued' | 'done' | 'err'
  elapsed: string
  tokens: string
  action?: 'focus' | 'replay' | 'retry'
  dayGroup: 'now' | 'today' | 'yesterday' | 'earlier'
  createdAt: number
  workflowId: string
  triggerKind: string | null
  inputs: Record<string, unknown>
  userMessage: string
  error: string | null
}

export interface ConductorStats {
  live: number
  needsYou: number
  nodesRunning: number
  oldestLiveElapsed: string
  tokens: string
}

export interface ConductorSnapshot {
  missions: Array<Mission>
  stats: ConductorStats
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

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function computeDayGroup(
  status: Mission['status'],
  startedAtMs: number,
): Mission['dayGroup'] {
  if (status === 'live' || status === 'waiting' || status === 'queued')
    return 'now'
  const today = startOfDay(Date.now())
  if (startedAtMs >= today) return 'today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (startedAtMs >= yesterday.getTime()) return 'yesterday'
  return 'earlier'
}

function deriveAction(status: Mission['status']): Mission['action'] {
  if (status === 'live' || status === 'waiting' || status === 'queued')
    return 'focus'
  if (status === 'done') return 'replay'
  return 'retry'
}

// Map workflow_run.status → Mission.status
function mapStatus(runStatus: string): Mission['status'] {
  if (runStatus === 'running') return 'live'
  if (runStatus === 'paused') return 'waiting'
  if (runStatus === 'pending') return 'queued'
  if (
    runStatus === 'failed' ||
    runStatus === 'error' ||
    runStatus === 'cancelled'
  ) {
    return 'err'
  }
  return 'done'
}

/** Date | ISO string | epoch ms/s → epoch ms; `fallback` when missing or unparseable. */
function toMs(
  d: Date | string | number | undefined | null,
  fallback: number,
): number {
  if (d == null || (typeof d === 'number' && d <= 0)) return fallback
  const raw =
    typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : new Date(d).getTime()
  return Number.isFinite(raw) ? raw : fallback
}

function runToMission(run: WorkflowRun): Mission {
  const now = Date.now()
  const status = mapStatus(run.status)
  const startedAtMs = toMs(run.started_at, toMs(run.last_heartbeat, now))
  const endedAtMs =
    status === 'done' || status === 'err'
      ? toMs(run.completed_at, toMs(run.last_heartbeat, now))
      : now

  const meta = run.metadata ?? {}
  const trigger = (meta.trigger ?? {}) as Record<string, unknown>
  const triggerKind = trigger.kind ?? trigger.type
  const inputs = meta.inputs as Record<string, unknown> | null | undefined

  return {
    id: run.id,
    title: run.workflow_id,
    subtitle: `${run.workflow_id} · ${run.current_phase}`,
    status,
    elapsed: formatElapsed(endedAtMs - startedAtMs),
    tokens: '—', // D7: real tokens arrive with B1
    action: deriveAction(status),
    dayGroup: computeDayGroup(status, startedAtMs),
    createdAt: startedAtMs,
    workflowId: run.workflow_id,
    triggerKind: typeof triggerKind === 'string' ? triggerKind : null,
    inputs: inputs ?? {},
    userMessage: run.user_message,
    error: run.error ?? null,
  }
}

const pluginClient = new PluginClient()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let memo: { at: number; value: Promise<ConductorSnapshot> } | null = null

/**
 * Missions + header stats from a single listRuns call. `maxAgeMs` > 0 reuses a
 * snapshot taken within that window (state route); the default always refetches.
 */
export function getConductorSnapshot(maxAgeMs = 0): Promise<ConductorSnapshot> {
  if (memo && Date.now() - memo.at < maxAgeMs) return memo.value
  const value = buildSnapshot()
  const entry = { at: Date.now(), value }
  memo = entry
  value.catch(() => {
    if (memo === entry) memo = null
  })
  return value
}

async function buildSnapshot(): Promise<ConductorSnapshot> {
  const [runs, active] = await Promise.all([
    getEngine().listRuns({ limit: 200 }),
    pluginClient.listActiveNodeRuns().catch(() => []),
  ])
  const missions = runs.map(runToMission)
  const live = missions.filter((m) => m.status === 'live')
  const oldest = live.reduce<number | null>(
    (min, m) => (min == null || m.createdAt < min ? m.createdAt : min),
    null,
  )
  return {
    missions,
    stats: {
      live: live.length,
      needsYou: missions.filter((m) => m.status === 'waiting').length,
      nodesRunning: active.filter((n) => n.status === 'running').length,
      oldestLiveElapsed:
        oldest == null ? '—' : formatElapsed(Date.now() - oldest),
      tokens: '—',
    },
  }
}

export async function getMission(
  _request: Request,
  id: string,
): Promise<Mission | null> {
  try {
    const run = await getEngine().getRun(id)
    return run ? runToMission(run) : null
  } catch {
    return null
  }
}

export async function abortMission(id: string): Promise<void> {
  await getEngine().cancelRun(id)
}
