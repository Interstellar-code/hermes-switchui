/**
 * run-status.ts — shared run contract for Conductor and Workflows.
 *
 * One query (`['workflow-runs','index']`) feeds per-workflow run summaries,
 * so cards, rails and the canvas never fan out their own run lists.
 */
import { useQuery } from '@tanstack/react-query'
import { listWorkflowRuns } from './api-client'
import type { LaunchWorkflowInput, WorkflowRunRow } from './api-client'
import type { Mission } from '@/server/conductor-store'

export const RUN_INDEX_LIMIT = 200

/**
 * Run statuses `POST /retry` accepts. The backend reaper marks a run whose
 * owner died failed after 5 min (run_store STALE_MS / mark_crashed_runs).
 */
export const RESUMABLE = new Set(['failed', 'cancelled'])
/** run_store STALE_MS: a pending/running run this quiet has lost its owner. */
export const STALE_HEARTBEAT_MS = 5 * 60 * 1000

/** RESUME applies: failed/cancelled, or pending/running with a stale heartbeat. */
export function isResumable(
  run: Pick<WorkflowRunRow, 'status' | 'last_heartbeat'> | null | undefined,
  now = Date.now(),
): boolean {
  if (!run) return false
  if (RESUMABLE.has(run.status)) return true
  const beat = toEpochMs(run.last_heartbeat)
  return (
    (run.status === 'pending' || run.status === 'running') &&
    beat != null &&
    now - beat > STALE_HEARTBEAT_MS
  )
}
const RECENT = 10

export type StageLabel = 'PLAN' | 'ROUTE' | 'EXECUTE' | 'REVIEW' | 'REPORT'

// D3 vocabulary, plus the synonyms real bundled definitions use for `phase:`.
const PHASE_MAP: Record<string, StageLabel> = {
  discover: 'PLAN',
  plan: 'PLAN',
  intake: 'PLAN',
  scope: 'PLAN',
  scan: 'PLAN',
  investigate: 'PLAN',
  analyze: 'PLAN',
  design: 'PLAN',
  draft: 'PLAN',
  route: 'ROUTE',
  execute: 'EXECUTE',
  implement: 'EXECUTE',
  iterate: 'EXECUTE',
  generate: 'EXECUTE',
  render: 'EXECUTE',
  fix: 'EXECUTE',
  resolve: 'EXECUTE',
  ingest: 'EXECUTE',
  catalog: 'EXECUTE',
  review: 'REVIEW',
  approval: 'REVIEW',
  validate: 'REVIEW',
  verify: 'REVIEW',
  evaluate: 'REVIEW',
  gate: 'REVIEW',
  report: 'REPORT',
  publish: 'REPORT',
  finalize: 'REPORT',
}

/** YAML `phase:` / run `current_phase` → stage pill label; null when unknown. */
export function phaseLabel(
  phase: string | null | undefined,
): StageLabel | null {
  return phase ? (PHASE_MAP[phase.trim().toLowerCase()] ?? null) : null
}

const ACTIVE = new Set(['running', 'pending'])

export interface SparkPoint {
  id: string
  status: string
  durationMs: number | null
}

export interface WorkflowRunSummary {
  active: Array<WorkflowRunRow>
  waiting: Array<WorkflowRunRow>
  last: WorkflowRunRow | null
  /** Newest first, ≤10. */
  recent: Array<WorkflowRunRow>
  /** Median duration of finished runs among `recent`; null when none. */
  medianMs: number | null
  /** Oldest → newest, ≤10. */
  sparkline: Array<SparkPoint>
}

export type WorkflowRunIndex = Record<string, WorkflowRunSummary>

/** ISO string | epoch s/ms → epoch ms; null when missing or unparseable. */
export function toEpochMs(
  v: string | number | null | undefined,
): number | null {
  if (v == null || v === '') return null
  const ms =
    typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : new Date(v).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

export function runDurationMs(run: WorkflowRunRow): number | null {
  const start = toEpochMs(run.started_at)
  const end = toEpochMs(run.completed_at)
  return start != null && end != null && end >= start ? end - start : null
}

export function indexRunsByWorkflow(
  runs: Array<WorkflowRunRow>,
): WorkflowRunIndex {
  const byWf = new Map<string, Array<WorkflowRunRow>>()
  for (const r of runs) {
    const list = byWf.get(r.workflow_id) ?? []
    list.push(r)
    byWf.set(r.workflow_id, list)
  }
  const index: WorkflowRunIndex = {}
  for (const [wf, list] of byWf) {
    const sorted = [...list].sort(
      (a, b) => (toEpochMs(b.started_at) ?? 0) - (toEpochMs(a.started_at) ?? 0),
    )
    const recent = sorted.slice(0, RECENT)
    const durations = recent
      .map(runDurationMs)
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b)
    const mid = durations.length >> 1
    index[wf] = {
      active: sorted.filter((r) => ACTIVE.has(r.status)),
      waiting: sorted.filter((r) => r.status === 'paused'),
      last: sorted[0] ?? null,
      recent,
      medianMs: durations.length
        ? durations.length % 2
          ? durations[mid]
          : (durations[mid - 1] + durations[mid]) / 2
        : null,
      sparkline: [...recent].reverse().map((r) => ({
        id: r.id,
        status: r.status,
        durationMs: runDurationMs(r),
      })),
    }
  }
  return index
}

/** 2s while anything is live or waiting, 10s when idle (D9). */
export function runIndexInterval(
  runs: Array<WorkflowRunRow> | undefined,
): number {
  return runs?.some((r) => ACTIVE.has(r.status) || r.status === 'paused')
    ? 2000
    : 10_000
}

export function fetchRunIndexRuns(): Promise<Array<WorkflowRunRow>> {
  return listWorkflowRuns({ limit: RUN_INDEX_LIMIT })
}

export function useWorkflowRunIndex() {
  return useQuery({
    queryKey: ['workflow-runs', 'index'],
    queryFn: fetchRunIndexRuns,
    select: indexRunsByWorkflow,
    refetchInterval: (query) => runIndexInterval(query.state.data),
  })
}

/**
 * D6 Run again: same workflow, `variables = metadata.inputs`,
 * `user_message = run.user_message`. Null when no message was recorded.
 */
export function runAgainInput(
  run: WorkflowRunRow | Mission,
): LaunchWorkflowInput | null {
  const [workflowId, userMessage, inputs] =
    'workflowId' in run
      ? [run.workflowId, run.userMessage, run.inputs]
      : [run.workflow_id, run.user_message, run.metadata?.inputs]
  if (!userMessage) return null
  const variables =
    inputs && typeof inputs === 'object' && Object.keys(inputs).length
      ? (inputs as Record<string, unknown>)
      : undefined
  return {
    workflow_id: workflowId,
    conversation_id: crypto.randomUUID(),
    user_message: userMessage,
    variables,
    schedule: { type: 'now' },
  }
}
