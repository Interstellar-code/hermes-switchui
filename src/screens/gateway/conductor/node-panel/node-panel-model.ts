/**
 * node-panel-model.ts — pure model behind the docked node panel.
 * Tolerates missing/null backend fields (older plugins).
 */
import type { NodeRunRow, WorkflowRunRow } from '@/screens/workflows/api-client'
import type { ParsedWorkflow } from '@/screens/workflows/types'
import {
  LLM_TYPES,
  asList,
  fmtDuration,
} from '@/screens/workflows/run-inspector/inspector-model'
import { toEpochMs } from '@/screens/workflows/run-status'

type DefNode = ParsedWorkflow['nodes'][number]

export interface SelectedNode {
  /** Definition node (null when the run row has no matching definition node). */
  def: DefNode | null
  /** Top-level node_run (the loop wrapper for loops); null when not reached. */
  nodeRun: NodeRunRow | null
  /** Loop iteration rows, in order. */
  iterations: Array<NodeRunRow>
  dependsOn: Array<string>
  feeds: Array<string>
  /** 1-based position in the definition, and the definition's node count. */
  index: number | null
  total: number
}

export function selectNode(
  parsed: ParsedWorkflow | null,
  nodeRuns: Array<NodeRunRow>,
  nodeId: string,
): SelectedNode {
  const defs = parsed?.nodes ?? []
  const def = defs.find((n) => n.id === nodeId) ?? null
  const mine = nodeRuns.filter((nr) => nr.dag_node_id === nodeId)
  const nodeRun =
    mine.find(
      (nr) => nr.loop_iteration == null && !nr.parent_subgraph_node_run_id,
    ) ??
    mine.find((nr) => nr.loop_iteration == null) ??
    null
  const iterations = mine
    .filter((nr) => nr.loop_iteration != null)
    .sort((a, b) => (a.loop_iteration ?? 0) - (b.loop_iteration ?? 0))
  const dependsOn = asList(nodeRun?.depends_on).length
    ? asList(nodeRun?.depends_on)
    : (def?.depends_on ?? [])
  const feeds = [
    ...new Set(
      (parsed?.edges ?? [])
        .filter(([from]) => from === nodeId)
        .map(([, to]) => to)
        .concat(
          defs.filter((n) => n.depends_on?.includes(nodeId)).map((n) => n.id),
        ),
    ),
  ]
  const i = defs.findIndex((n) => n.id === nodeId)
  return {
    def,
    nodeRun,
    iterations,
    dependsOn,
    feeds,
    index: i >= 0 ? i + 1 : null,
    total: defs.length,
  }
}

export function durationMs(nr: NodeRunRow | null, now: number): number | null {
  const start = toEpochMs(nr?.started_at)
  if (start == null) return null
  const end = toEpochMs(nr?.completed_at)
  return Math.max(0, (end ?? now) - start)
}

/** `10m (600000 ms)`; falls back to the idle timeout, then "not set". */
export function timeoutText(nr: NodeRunRow | null): string {
  const short = (ms: number) => fmtDuration(ms).replace(/ 00s$/, '')
  if (nr?.max_runtime_seconds)
    return `${short(nr.max_runtime_seconds * 1000)} (${nr.max_runtime_seconds * 1000} ms)`
  if (nr?.idle_timeout_ms)
    return `idle ${short(nr.idle_timeout_ms)} (${nr.idle_timeout_ms} ms)`
  return 'not set'
}

/** Honest per-type usage line, or null when the node reported usage. */
export function usageNote(type: string, nr: NodeRunRow | null): string | null {
  if (type === 'approval')
    return 'Approval nodes do not call a model — no usage.'
  if (!LLM_TYPES.has(type))
    return `No usage reported for ${type} nodes. Only prompt, loop and command nodes report tokens.`
  const hasUsage =
    (nr?.total_tokens ?? 0) > 0 || nr?.model != null || nr?.cost_usd != null
  return hasUsage ? null : 'No usage reported for this node run.'
}

const EXIT_RE = /exited with code (\d+)(?::\s*)?/

export function exitCode(error: string | null | undefined): number | null {
  const m = EXIT_RE.exec(error ?? '')
  return m ? Number(m[1]) : null
}

/**
 * Text after `exited with code N: `, last `n` non-empty lines. An error that is
 * only the prefix ("... exited with code 1") has no tail of its own, so the
 * whole message stands in.
 */
export function stderrTail(error: string | null | undefined, n = 12): string {
  const text = error ?? ''
  const lines = (s: string) => s.split('\n').filter((l) => l.trim())
  const m = EXIT_RE.exec(text)
  const body = m ? lines(text.slice(m.index + m[0].length)) : []
  return (body.length > 0 ? body : lines(text)).slice(-n).join('\n')
}

/** Last non-empty line of an error, for the callout. */
export function lastErrorLine(error: string | null | undefined): string {
  return stderrTail(error, 1)
}

export interface ApprovalInfo {
  message: string
  captureResponse: boolean
  response: string | null
  actor: string | null
}

function metaOf(nr: NodeRunRow): Record<string, unknown> {
  if (!nr.metadata) return {}
  if (typeof nr.metadata === 'object') return nr.metadata
  try {
    return JSON.parse(nr.metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Approval fields, or null when the node is not an approval. */
export function approvalInfo(
  nr: NodeRunRow | null,
  run: WorkflowRunRow | null,
  def: DefNode | null,
): ApprovalInfo | null {
  if (!nr || (nr.node_type !== 'approval' && !nr.approval_message)) return null
  const pause = run?.metadata?.pause as
    | { captureResponse?: boolean }
    | undefined
  const actor = metaOf(nr).approved_by
  return {
    message: nr.approval_message ?? '',
    captureResponse:
      pause?.captureResponse === true ||
      /capture_response:\s*true/.test(def?.config ?? def?.config_preview ?? ''),
    response: nr.approval_response ?? null,
    actor: typeof actor === 'string' ? actor : null,
  }
}

/** True while this node is the one a paused run is waiting on. */
export function isAwaitingApproval(
  nr: NodeRunRow | null,
  run: WorkflowRunRow | null,
): boolean {
  return (
    run?.status === 'paused' &&
    nr?.status === 'paused' &&
    (nr.node_type === 'approval' || !!nr.approval_message)
  )
}

/** `7m 03s` — a live wait counter. */
export function fmtWait(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** artifact_refs (JSON column: string | array | null) → display labels. */
export function artifactLabels(nr: NodeRunRow | null): Array<string> {
  let raw: unknown = nr?.artifact_refs
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (r): r is Record<string, string | undefined> =>
        !!r && typeof r === 'object',
    )
    .map((r) => r.label ?? r.path ?? r.url ?? r.type ?? 'artifact')
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** `key: value` lines; one nested object level is flattened the same way, indented. */
function kvLines(obj: Record<string, unknown>, nested: boolean): string {
  return Object.entries(obj)
    .map(([k, val]) => {
      const t =
        nested && isRecord(val)
          ? kvLines(val, false).replace(/^/gm, '  ')
          : typeof val === 'string'
            ? val
            : JSON.stringify(val, null, 2)
      return t.includes('\n') || (nested && isRecord(val))
        ? `${k}:\n${t}`
        : `${k}: ${t}`
    })
    .join('\n')
}

/** Definition config arrives as a JSON string; show `key: value` with scripts unescaped. */
export function configText(def: DefNode | null): string {
  const raw = (def?.config ?? def?.config_preview ?? '').trim()
  try {
    const v = JSON.parse(raw) as unknown
    if (isRecord(v)) return kvLines(v, true)
  } catch {
    /* already plain text, or a truncated preview */
  }
  return raw
}
