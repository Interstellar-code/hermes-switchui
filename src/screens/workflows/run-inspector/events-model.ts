/**
 * events-model.ts — pure model for the Events, Output and Definition tabs.
 */
import { toEpochMs } from '../run-status'
import { TERMINAL, topLevelNodeRuns } from './inspector-model'
import type { WorkflowSseEvent } from '../use-workflow-events'
import type {
  NodeRunRow,
  PhaseTransition,
  WorkflowEventRow,
} from '../api-client'
import type { ParsedWorkflow } from '../types'

export interface EventItem {
  key: string
  ts: number
  type: string
  nodeId: string | null
  summary: string
  data: Record<string, unknown>
  /** Dedupe identity, strongest first. */
  seq: number | null
  id: string | null
  nodeRunId: string | null
}

/** Never shown: not run history. `node_log` has its own listener (F5b). */
const HIDDEN = new Set(['connected', 'message', 'node_log', 'platform_chunk'])

function asObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown
      if (v && typeof v === 'object') return v as Record<string, unknown>
    } catch {
      /* not JSON */
    }
  }
  return {}
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const oneLine = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** One-line summary for the Events list. */
export function eventSummary(type: string, d: Record<string, unknown>): string {
  switch (type) {
    case 'workflow_started': {
      const trigger = asObject(d.trigger)
      const inputs = Object.keys(asObject(d.inputs)).length
      return `${str(trigger.kind) || 'run'} trigger · ${inputs} input${inputs === 1 ? '' : 's'}`
    }
    case 'node_started':
      return str(d.node_type) || 'started'
    case 'node_completed': {
      const out = str(d.output)
      const ms =
        typeof d.duration_ms === 'number' ? ` · ${d.duration_ms}ms` : ''
      return (out ? oneLine(out) : 'completed') + ms
    }
    case 'node_failed':
    case 'workflow_failed':
    case 'loop_iteration_failed':
      return oneLine(str(d.error) || 'failed')
    case 'node_skipped':
      return str(d.reason) || 'skipped'
    case 'node_paused':
    case 'approval_requested':
      return oneLine(str(d.message) || 'waiting for approval')
    case 'approval_received': {
      const note = str(d.comment) || str(d.response)
      return `response: ${str(d.decision) || '—'}${note ? ` · note "${oneLine(note, 60)}"` : ''}`
    }
    case 'workflow_phase':
      return str(d.text)
    default: {
      const msg = str(d.message) || str(d.error) || str(d.reason)
      if (msg) return oneLine(msg)
      const { run_id: _r, node_id: _n, ...rest } = d
      const j = JSON.stringify(rest)
      return j === '{}' ? '' : oneLine(j)
    }
  }
}

function fromRow(
  row: WorkflowEventRow,
  nodeById: Map<string, NodeRunRow>,
): EventItem {
  const data = asObject(row.data)
  const nodeRunId = row.node_run_id ?? null
  const nodeId =
    str(data.node_id) ||
    (row.step_name ?? '') ||
    (nodeRunId ? (nodeById.get(nodeRunId)?.dag_node_id ?? '') : '') ||
    null
  return {
    key: `db:${row.id}`,
    ts: toEpochMs(row.created_at) ?? 0,
    type: row.event_type,
    nodeId: nodeId || null,
    summary: eventSummary(row.event_type, data),
    data,
    seq: row.seq,
    id: row.id,
    nodeRunId,
  }
}

/**
 * A live SSE frame is the bus wrapper (engine/emitter/bus.py `_row_payload`):
 * `{id, seq, run_id, event_type, node_run_id, data:{node_id, …}, created_at?, _replayed?}`.
 * Live-emitted frames carry no `created_at`, so they fall back to receivedAt.
 */
function fromLive(ev: WorkflowSseEvent, i: number): EventItem {
  const env = ev.data
  const d = asObject(env.data)
  const seq = typeof env.seq === 'number' ? env.seq : null
  const id = typeof env.id === 'string' ? env.id : null
  const nodeRunId = typeof env.node_run_id === 'string' ? env.node_run_id : null
  const nodeId = str(d.node_id) || null
  return {
    key:
      seq != null
        ? `live:s:${seq}`
        : id
          ? `live:i:${id}`
          : `live:${ev.receivedAt}:${ev.type}:${i}`,
    ts:
      toEpochMs(env.created_at as string | number | undefined) ?? ev.receivedAt,
    type: ev.type,
    nodeId,
    summary: eventSummary(ev.type, d),
    data: d,
    seq,
    id,
    nodeRunId,
  }
}

/** Window for matching an id-less live event (0.1.0 backend) to a DB row. */
const LOOSE_MS = 2000

/**
 * DB rows + live SSE + synthetic `workflow_phase` rows, oldest first.
 * Dedupe: seq, then id; a live event with neither matches a DB row on
 * (type, node_run_id ?? node_id) within ±2s.
 */
export function mergeEvents(
  rows: Array<WorkflowEventRow>,
  live: Array<WorkflowSseEvent>,
  nodeRuns: Array<NodeRunRow>,
  transitions: Array<PhaseTransition>,
): Array<EventItem> {
  const nodeById = new Map(nodeRuns.map((n) => [n.id, n]))
  const seen = new Set<string>()
  // (type|node) → DB row timestamps, for id-less live events.
  const dbTimes = new Map<string, Array<number>>()
  const looseKey = (e: EventItem) => `${e.type}|${e.nodeRunId ?? e.nodeId}`
  const out: Array<EventItem> = []
  const add = (e: EventItem) => {
    if (e.seq != null) seen.add(`s:${e.seq}`)
    if (e.id) seen.add(`i:${e.id}`)
    out.push(e)
  }
  for (const r of rows) {
    const e = fromRow(r, nodeById)
    if (HIDDEN.has(e.type)) continue
    if ((e.seq != null && seen.has(`s:${e.seq}`)) || seen.has(`i:${e.id}`))
      continue
    add(e)
    const k = looseKey(e)
    dbTimes.set(k, [...(dbTimes.get(k) ?? []), e.ts])
  }
  // `_replayed` live events are the last 50 DB rows we already fetched.
  for (const [i, ev] of live.entries()) {
    if (ev.data._replayed === true || HIDDEN.has(ev.type)) continue
    const e = fromLive(ev, i)
    if (e.seq != null || e.id) {
      if (
        (e.seq != null && seen.has(`s:${e.seq}`)) ||
        (e.id && seen.has(`i:${e.id}`))
      )
        continue
    } else if (
      (dbTimes.get(looseKey(e)) ?? []).some(
        (t) => Math.abs(t - e.ts) <= LOOSE_MS,
      )
    ) {
      continue
    }
    add(e)
  }
  for (const t of transitions) {
    out.push({
      key: `phase:${t.id}`,
      ts: toEpochMs(t.at) ?? 0,
      type: 'workflow_phase',
      nodeId: null,
      summary: `${t.from_phase ?? '∅'} → ${t.to_phase} (decided_by ${t.decided_by})`,
      data: {
        text: `${t.from_phase ?? '∅'} → ${t.to_phase} (decided_by ${t.decided_by})`,
      },
      seq: null,
      id: null,
      nodeRunId: null,
    })
  }
  return out.sort((a, b) => a.ts - b.ts)
}

// ── filters ──────────────────────────────────────────────────────────────────

export const EVENT_CHIPS = [
  'node_started',
  'node_completed',
  'node_failed',
  'node_paused',
  'approval',
  'workflow_*',
  'node_skipped',
  'other',
] as const
export type EventChip = (typeof EVENT_CHIPS)[number]
export const DEFAULT_CHIPS: ReadonlySet<EventChip> = new Set(
  EVENT_CHIPS.filter((c) => c !== 'node_skipped'),
)

export function chipOf(type: string): EventChip {
  if (type.startsWith('approval_') || type === 'approval') return 'approval'
  if (type.startsWith('workflow_')) return 'workflow_*'
  return (EVENT_CHIPS as ReadonlyArray<string>).includes(type)
    ? (type as EventChip)
    : 'other'
}

export function filterEvents(
  items: Array<EventItem>,
  f: { node: string | null; chips: ReadonlySet<EventChip>; search: string },
): Array<EventItem> {
  const q = f.search.trim().toLowerCase()
  return items.filter(
    (e) =>
      f.chips.has(chipOf(e.type)) &&
      (!f.node || e.nodeId === f.node) &&
      (!q ||
        `${e.type} ${e.nodeId ?? ''} ${e.summary}`.toLowerCase().includes(q)),
  )
}

/** node_id → reason, for definition nodes the engine skipped without a run row. */
export function skipReasonsFrom(items: Array<EventItem>): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of items)
    if (e.type === 'node_skipped' && e.nodeId && !e.nodeRunId)
      m.set(e.nodeId, str(e.data.reason) || 'skipped')
  return m
}

// ── output ───────────────────────────────────────────────────────────────────

export interface FinalReport {
  sinks: Array<{ id: string; text: string }>
  /** Sinks that did not complete, with a plain-language reason. */
  missing: Array<{ id: string; reason: string }>
}

/** Completed sink nodes (no dependents) and why the others have no report. */
export function finalReport(
  parsed: ParsedWorkflow | null | undefined,
  nodeRuns: Array<NodeRunRow>,
  runError?: string | null,
): FinalReport {
  const byNode = new Map(
    topLevelNodeRuns(nodeRuns).map((n) => [n.dag_node_id, n]),
  )
  const hasOut = new Set((parsed?.edges ?? []).map((e) => e[0]))
  const failed = [...byNode.values()].find((n) => n.status === 'failed')
  const sinks: FinalReport['sinks'] = []
  const missing: FinalReport['missing'] = []
  for (const n of parsed?.nodes ?? []) {
    if (hasOut.has(n.id) || n.type === 'cancel') continue
    const nr = byNode.get(n.id)
    if (nr?.status === 'completed' && nr.summary?.trim()) {
      sinks.push({ id: n.id, text: nr.summary })
    } else {
      missing.push({
        id: n.id,
        reason: nr
          ? `${nr.status}${nr.status === 'completed' ? ' with no output' : ''}`
          : failed
            ? `not reached because ${failed.dag_node_id} failed`
            : runError
              ? 'not reached because the run failed'
              : 'not reached yet',
      })
    }
  }
  return { sinks, missing }
}

/** Most recently completed top-level node with output. */
export function latestOutput(nodeRuns: Array<NodeRunRow>) {
  let best: NodeRunRow | null = null
  for (const n of topLevelNodeRuns(nodeRuns)) {
    if (n.status !== 'completed' || !n.summary?.trim()) continue
    if (
      !best ||
      (toEpochMs(n.completed_at) ?? 0) >= (toEpochMs(best.completed_at) ?? 0)
    )
      best = n
  }
  return best ? { nodeId: best.dag_node_id, text: best.summary ?? '' } : null
}

export const isTerminalStatus = (s: string) => TERMINAL.has(s)

// ── definition ───────────────────────────────────────────────────────────────

/** 1-based inclusive line range of the YAML list item whose `id` is `nodeId`. */
export function yamlBlockRange(
  yaml: string,
  nodeId: string,
): { start: number; end: number } | null {
  const lines = yaml.split('\n')
  const esc = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const idRe = new RegExp(`^(\\s*)(-\\s+)?id:\\s*["']?${esc}["']?\\s*(#.*)?$`)
  const indentOf = (l: string) => l.length - l.trimStart().length
  let i = lines.findIndex((l) => idRe.test(l))
  if (i < 0) return null
  let dashIndent: number
  if (/^\s*-\s/.test(lines[i])) {
    dashIndent = indentOf(lines[i])
  } else {
    // `id:` is not the first key: walk up to the item's `- ` line.
    const keyIndent = indentOf(lines[i])
    let j = i - 1
    while (
      j >= 0 &&
      !(/^\s*-\s/.test(lines[j]) && indentOf(lines[j]) < keyIndent)
    )
      j--
    if (j < 0) return null
    i = j
    dashIndent = indentOf(lines[j])
  }
  let end = i
  for (let k = i + 1; k < lines.length; k++) {
    if (!lines[k].trim()) continue
    if (indentOf(lines[k]) <= dashIndent) break
    end = k
  }
  return { start: i + 1, end: end + 1 }
}
