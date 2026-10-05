/**
 * inspector-model.ts — pure model behind the RunInspector tabs.
 * Everything here tolerates missing/null backend fields (older plugins).
 */
import { toEpochMs } from '../run-status'
import type { NodeRunRow, PhaseTransition, WorkflowRunRow } from '../api-client'
import type { ParsedWorkflow } from '../types'

export type InspectTab =
  | 'overview'
  | 'output'
  | 'nodes'
  | 'events'
  | 'definition'

export const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled'])
/** Node types that write tokens (others report none). */
export const LLM_TYPES = new Set(['prompt', 'loop', 'command', 'subagent'])

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return 'n/a'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** m:ss (h:mm:ss over an hour), as in the phase rows. */
export function fmtClockDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return 'n/a'
  const s = Math.round(ms / 1000)
  const mm = Math.floor(s / 60)
  return mm >= 60
    ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${mm}:${String(s % 60).padStart(2, '0')}`
}

const p2 = (n: number) => String(n).padStart(2, '0')

export function fmtTime(ts: number | string | null | undefined): string {
  const ms = toEpochMs(ts)
  if (ms == null) return 'never'
  const d = new Date(ms)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

export function fmtDateTime(ts: number | string | null | undefined): string {
  const ms = toEpochMs(ts)
  if (ms == null) return 'n/a'
  const d = new Date(ms)
  const mon = d.toLocaleString('en-US', { month: 'short' })
  return `${mon} ${d.getDate()} · ${fmtTime(ms)}`
}

// ── phases ───────────────────────────────────────────────────────────────────

export interface PhaseSegment {
  phase: string
  startMs: number
  endMs: number | null
  durationMs: number | null
  tone: 'ok' | 'err' | 'live' | 'muted'
}

/** One segment per non-terminal phase; the next transition closes it. */
export function phaseSegments(
  transitions: Array<PhaseTransition>,
  runStatus: string,
): Array<PhaseSegment> {
  const sorted = [...transitions].sort((a, b) => a.at - b.at)
  const out: Array<PhaseSegment> = []
  sorted.forEach((t, i) => {
    if (TERMINAL_PHASES.has(t.to_phase)) return
    const next = sorted[i + 1] as PhaseTransition | undefined
    const startMs = toEpochMs(t.at) ?? 0
    const endMs = next ? toEpochMs(next.at) : null
    const tone: PhaseSegment['tone'] = !next
      ? TERMINAL.has(runStatus)
        ? 'muted'
        : 'live'
      : next.to_phase === 'failed'
        ? 'err'
        : next.to_phase === 'cancelled'
          ? 'muted'
          : 'ok'
    out.push({
      phase: t.to_phase,
      startMs,
      endMs,
      durationMs: endMs != null ? endMs - startMs : null,
      tone,
    })
  })
  return out
}

// ── usage ────────────────────────────────────────────────────────────────────

export function topLevelNodeRuns(nodeRuns: Array<NodeRunRow>) {
  return nodeRuns.filter(
    (nr) => !nr.parent_subgraph_node_run_id && nr.loop_iteration == null,
  )
}

export function usageCoverage(nodeRuns: Array<NodeRunRow>): {
  reporting: Array<string>
  total: number
} {
  const top = topLevelNodeRuns(nodeRuns)
  return {
    reporting: top
      .filter((nr) => (nr.total_tokens ?? 0) > 0)
      .map((nr) => nr.dag_node_id),
    total: top.length,
  }
}

// ── trigger / limits ─────────────────────────────────────────────────────────

export function triggerText(run: WorkflowRunRow): string {
  const t = run.metadata?.trigger as Record<string, unknown> | undefined
  const kind = t?.kind ?? t?.type
  return typeof kind === 'string' && kind ? kind : 'not recorded'
}

export function runtimeLimitText(seconds: number | null | undefined): string {
  if (!seconds) return 'none'
  const h = seconds / 3600
  return seconds >= 3600 && Number.isInteger(h)
    ? `${h}h · ${seconds}s`
    : `${fmtDuration(seconds * 1000)} · ${seconds}s`
}

// ── attempts ─────────────────────────────────────────────────────────────────

/** Gate on the `node_attempts` feature, never on null fields. */
export function attemptText(nodeRun: NodeRunRow, features: Array<string>) {
  if (!features.includes('node_attempts'))
    return 'attempt 1 · retries not recorded'
  const n = (nodeRun.retries ?? 0) + 1
  return nodeRun.max_retries != null
    ? `attempt ${n} of ${nodeRun.max_retries + 1}`
    : `attempt ${n}`
}

/** Table-cell variant: `1`, or `2 of 3` when attempts are recorded. */
export function attemptShort(nodeRun: NodeRunRow, features: Array<string>) {
  if (!features.includes('node_attempts')) return '1'
  const n = (nodeRun.retries ?? 0) + 1
  return nodeRun.max_retries != null
    ? `${n} of ${nodeRun.max_retries + 1}`
    : `${n}`
}

// ── node rows ────────────────────────────────────────────────────────────────

export type RowTone = 'ok' | 'err' | 'live' | 'hold' | 'muted'

export interface NodeTableRow {
  id: string
  nodeRun: NodeRunRow | null
  type: string
  stage: string
  status: string
  tone: RowTone
  startedMs: number | null
  tookMs: number | null
  tokens: number | null
  model: string | null
  skipReason: string | null
}

function statusOf(nr: NodeRunRow): { label: string; tone: RowTone } {
  switch (nr.status) {
    case 'completed':
      return nr.node_type === 'approval'
        ? { label: 'approved', tone: 'ok' }
        : { label: 'done', tone: 'ok' }
    case 'failed':
      return { label: 'failed', tone: 'err' }
    case 'running':
      return { label: 'running', tone: 'live' }
    case 'paused':
      return { label: 'paused', tone: 'hold' }
    case 'skipped':
      return { label: 'skipped', tone: 'muted' }
    case 'cancelled':
      return { label: 'cancelled', tone: 'muted' }
    default:
      return { label: nr.status, tone: 'muted' }
  }
}

/**
 * Definition nodes (in order) overlaid with their node_run; definition nodes
 * with no run are `skipped` when an event says so, else `not reached`.
 * Runs missing from the definition are appended.
 */
export function nodeTableRows(
  parsed: ParsedWorkflow | null | undefined,
  nodeRuns: Array<NodeRunRow>,
  skipReasons: Map<string, string> = new Map(),
  now = Date.now(),
): Array<NodeTableRow> {
  const top = topLevelNodeRuns(nodeRuns)
  const byNode = new Map(top.map((nr) => [nr.dag_node_id, nr]))
  const defs = parsed?.nodes ?? []
  const row = (
    id: string,
    nr: NodeRunRow | null,
    def?: ParsedWorkflow['nodes'][number],
  ): NodeTableRow => {
    const startedMs = toEpochMs(nr?.started_at)
    const endMs = toEpochMs(nr?.completed_at)
    const st = nr
      ? statusOf(nr)
      : skipReasons.has(id)
        ? { label: 'skipped', tone: 'muted' as const }
        : { label: 'not reached', tone: 'muted' as const }
    return {
      id,
      nodeRun: nr,
      type: nr?.node_type ?? def?.type ?? 'prompt',
      stage: def?.phase?.toLowerCase() ?? '—',
      status: st.label,
      tone: st.tone,
      startedMs,
      tookMs:
        startedMs == null
          ? null
          : endMs != null
            ? endMs - startedMs
            : nr?.status === 'running'
              ? now - startedMs
              : null,
      tokens: nr?.total_tokens ?? null,
      model:
        nr?.model ?? def?.hermes_task?.model_hint ?? nr?.model_hint ?? null,
      skipReason: nr?.skip_reason ?? skipReasons.get(id) ?? null,
    }
  }
  const rows = defs.map((d) => row(d.id, byNode.get(d.id) ?? null, d))
  const known = new Set(defs.map((d) => d.id))
  for (const nr of top) {
    if (!known.has(nr.dag_node_id)) rows.push(row(nr.dag_node_id, nr))
  }
  return rows
}

export function summaryCounts(rows: Array<NodeTableRow>) {
  const c = {
    done: 0,
    failed: 0,
    running: 0,
    paused: 0,
    skipped: 0,
    notReached: 0,
  }
  for (const r of rows) {
    if (r.tone === 'ok') c.done++
    else if (r.status === 'failed') c.failed++
    else if (r.status === 'running') c.running++
    else if (r.status === 'paused') c.paused++
    else if (r.status === 'skipped' || r.status === 'cancelled') c.skipped++
    else c.notReached++
  }
  return c
}

/** `'a'` | `['a']` | JSON string → string[]; the JSON columns arrive any of these ways. */
export function asList(raw: string | Array<string> | null | undefined) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : [String(v)]
  } catch {
    return [raw]
  }
}

/** Last `n` non-empty lines of node output, for the STDERR block. */
export function lastLines(text: string | null | undefined, n = 6) {
  return (text ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .slice(-n)
    .join('\n')
}

/** What the shell loads once and hands to every tab. */
export interface InspectorCtx {
  runId: string
  run: WorkflowRunRow
  nodeRuns: Array<NodeRunRow>
  phaseTransitions: Array<PhaseTransition>
  parsed: ParsedWorkflow | null
  features: Array<string>
  /** Called to open a node in the host (Conductor's docked panel); absent on /workflows. */
  onOpenNode?: (dagNodeId: string, panelTab?: 'output') => void
}

/** Run status → chip tone. */
export function statusTone(
  status: string,
): '' | 'ok' | 'err' | 'live' | 'hold' {
  return status === 'completed'
    ? 'ok'
    : status === 'failed'
      ? 'err'
      : status === 'running' || status === 'pending'
        ? 'live'
        : status === 'paused'
          ? 'hold'
          : ''
}
