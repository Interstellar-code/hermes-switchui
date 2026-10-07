/**
 * flow-model.ts — pure DagModel → React Flow projection for the Conductor
 * canvas: node/edge objects, status glyph + line, saved-position merge and
 * stage lane extents. No React here; flow-canvas.tsx renders it.
 */
import { MarkerType } from '@xyflow/react'
import { GAP_X, NODE_H, NODE_W, fmtDuration } from '../dag-layout'
import type { Edge, Node } from '@xyflow/react'
import type { Point } from '../dag-layout'
import type { DagModel, DagNode } from '../dag-model'
import type { StageLabel } from '@/screens/workflows/run-status'

export interface FlowNodeData extends Record<string, unknown> {
  node: DagNode
  /** A failed ancestor means this node will not run ("upstream failed"). */
  upstreamFailed: boolean
  preview: boolean
  /** F4 graph-editor mode (opt-in): connectable handles, editor card line. */
  editable?: boolean
  /** F3 definition view (opt-in): neutral stage line instead of run status. */
  neutral?: boolean
  /** Editor-only card line (body summary / "new · not connected"). */
  subtitle?: string | null
  /** Editor-only inline validation marker text. */
  errorText?: string | null
  /** Editor-only "new, not connected" dashed styling. */
  disconnected?: boolean
}

export type FlowNode = Node<FlowNodeData, 'dag'>

const STATUS_CLASS: Record<string, string> = {
  running: 'run',
  completed: 'done',
  failed: 'fail',
  paused: 'hold',
  skipped: 'skip',
  cancelled: 'skip',
}

/** `.dn` modifier class; 'wait' = not started yet. */
export function nodeClass(status: string): string {
  return STATUS_CLASS[status] ?? 'wait'
}

const GLYPH: Record<string, string> = {
  completed: '✓',
  running: '●',
  paused: '⏸',
  failed: '✗',
  skipped: '–',
  cancelled: '–',
}

export function statusGlyph(status: string): string {
  return GLYPH[status] ?? '○'
}

/** 2100 -> "2.1s"; 98000 -> "1m 38s"; an hour+ falls back to fmtDuration. */
export function fmtShort(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  }
  return fmtDuration(ms)
}

/** Board 7 status line. `now` ticks once a second for running / waiting. */
export function statusText(
  n: DagNode,
  now: number,
  upstreamFailed = false,
): string {
  const took = n.startedAt != null ? (n.completedAt ?? now) - n.startedAt : null
  switch (n.status) {
    case 'running':
      return `running ${fmtDuration(took)}`
    case 'paused':
      return took != null ? `waiting ${fmtShort(took)}` : 'waiting'
    case 'completed':
      if (n.type === 'approval') return 'approved'
      return took != null ? `✓ ${fmtShort(took)}` : '✓ done'
    case 'failed': {
      const code = /exited with code (\d+)/.exec(n.error ?? '')?.[1]
      const head = code != null ? `exit ${code}` : 'failed'
      return took != null ? `${head} · ${fmtShort(took)}` : head
    }
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
      if (upstreamFailed) return 'upstream failed'
      return n.skipReason ? `skipped · ${n.skipReason}` : 'skipped'
    default:
      return upstreamFailed ? 'upstream failed' : 'pending'
  }
}

/** Saved positions win for known ids (finite x/y only); unknown saved ids drop; new ids get the seed. */
export function mergePositions(
  seed: Record<string, Point>,
  saved: Record<string, Point> | undefined,
  ids: Array<string>,
): Record<string, Point> {
  const out: Record<string, Point> = {}
  for (const id of ids) {
    const s = saved?.[id]
    const p =
      s && Number.isFinite(s.x) && Number.isFinite(s.y)
        ? s
        : id in seed
          ? seed[id]
          : null
    if (p) out[id] = p
  }
  return out
}

/** Ids with a failed node somewhere upstream (edges walked forward from every failure). */
function failedDescendants(dag: DagModel): Set<string> {
  const succs = new Map<string, Array<string>>()
  for (const [a, b] of dag.edges) succs.set(a, [...(succs.get(a) ?? []), b])
  const out = new Set<string>()
  const stack = dag.nodes.filter((n) => n.status === 'failed').map((n) => n.id)
  while (stack.length) {
    for (const next of succs.get(stack.pop()!) ?? []) {
      if (out.has(next)) continue
      out.add(next)
      stack.push(next)
    }
  }
  return out
}

function edgeClass(src: string | undefined, dst: string | undefined): string {
  if (src === 'failed') return 'fail'
  if (src !== 'completed') return 'pending'
  if (dst === 'running') return 'live'
  if (dst === 'paused') return 'hold'
  // The edge was traversed once the target ran, whatever its outcome.
  if (dst === 'completed' || dst === 'failed') return 'done'
  return 'pending'
}

const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 12,
  height: 12,
  color: 'var(--m-text-faint, var(--theme-muted))',
}

/** Editor-only node visuals keyed by node id (see FlowNodeData). */
export interface FlowNodeMeta {
  subtitle?: string
  errorText?: string | null
  disconnected?: boolean
}

export function toFlow(
  dag: DagModel,
  positions: Record<string, Point>,
  preview = false,
  editable = false,
  nodeMeta?: Record<string, FlowNodeMeta>,
  neutral = false,
): { nodes: Array<FlowNode>; edges: Array<Edge> } {
  const status = new Map(dag.nodes.map((n) => [n.id, n.status]))
  const blocked = failedDescendants(dag)
  return {
    nodes: dag.nodes.map((n) => ({
      id: n.id,
      type: 'dag',
      position: positions[n.id] ?? { x: 0, y: 0 },
      width: NODE_W,
      height: NODE_H,
      connectable: editable,
      deletable: editable,
      data: {
        node: n,
        upstreamFailed: blocked.has(n.id) && n.status !== 'failed',
        preview,
        ...(editable
          ? {
              editable: true,
              subtitle: nodeMeta?.[n.id]?.subtitle ?? null,
              errorText: nodeMeta?.[n.id]?.errorText ?? null,
              disconnected: nodeMeta?.[n.id]?.disconnected ?? false,
            }
          : {}),
        ...(neutral ? { neutral: true } : {}),
      },
    })),
    edges: dag.edges.map(([a, b]) => ({
      id: `${a}>${b}`,
      source: a,
      target: b,
      className: preview ? 'pending' : edgeClass(status.get(a), status.get(b)),
      selectable: editable,
      focusable: editable,
      ...(editable ? { deletable: true } : {}),
      markerEnd: ARROW,
    })),
  }
}

export interface Lane {
  stage: StageLabel
  /** Flow-space x range of the band. */
  x0: number
  x1: number
}

/**
 * One band per stage, left edge half a gap before the stage's leftmost node,
 * running to the next band. Sorted left to right; dragged nodes move bands.
 */
export function laneExtents(
  nodes: Array<{ stage: StageLabel; x: number }>,
): Array<Lane> {
  const minX = new Map<StageLabel, number>()
  const maxX = new Map<StageLabel, number>()
  for (const n of nodes) {
    minX.set(n.stage, Math.min(minX.get(n.stage) ?? Infinity, n.x))
    maxX.set(n.stage, Math.max(maxX.get(n.stage) ?? -Infinity, n.x))
  }
  const starts = [...minX.entries()]
    .map(([stage, x]) => ({ stage, x0: x - GAP_X / 2 }))
    .sort((a, b) => a.x0 - b.x0)
  return starts.map((l, i) => ({
    ...l,
    x1: starts[i + 1]?.x0 ?? maxX.get(l.stage)! + NODE_W + GAP_X / 2,
  }))
}
