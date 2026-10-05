/**
 * dag-layout.ts — seed geometry for the Conductor canvas (node positions per
 * layer) and small formatting helpers. React Flow owns edges and fit.
 */
import type { DagModel } from './dag-model'

export const NODE_W = 104
export const NODE_H = 62
export const GAP_X = 28
export const GAP_Y = 22
export const PAD = 24

export interface Point {
  x: number
  y: number
}

export interface DagLayout {
  positions: Record<string, Point>
  width: number
  height: number
}

/** Left-to-right layers, each column centred on the tallest. Seeds React Flow positions. */
export function layoutDag(dag: Pick<DagModel, 'nodes'>): DagLayout {
  const columns = new Map<number, Array<string>>()
  for (const n of dag.nodes) {
    const col = columns.get(n.layer) ?? []
    col.push(n.id)
    columns.set(n.layer, col)
  }
  const layers = [...columns.keys()].sort((a, b) => a - b)
  const colHeight = (count: number) => count * NODE_H + (count - 1) * GAP_Y
  const tallest = Math.max(
    0,
    ...layers.map((l) => colHeight(columns.get(l)!.length)),
  )

  const positions: Record<string, Point> = {}
  layers.forEach((layer, col) => {
    const ids = columns.get(layer)!
    const offset = (tallest - colHeight(ids.length)) / 2
    ids.forEach((id, row) => {
      positions[id] = {
        x: PAD + col * (NODE_W + GAP_X),
        y: PAD + offset + row * (NODE_H + GAP_Y),
      }
    })
  })

  return {
    positions,
    width: layers.length
      ? PAD * 2 + layers.length * NODE_W + (layers.length - 1) * GAP_X
      : 0,
    height: layers.length ? PAD * 2 + tallest : 0,
  }
}

/** 83000 -> "1:23"; 3 600 000+ -> "1:00:00"; 24h+ -> "62d 10h". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * "node x of y": completed/skipped count, +1 while a node is active. A failed
 * run reports the first failed node's position (dag order) instead.
 */
export function nodeProgress(dag: DagModel): { x: number; y: number } {
  const y = dag.nodes.length + dag.hiddenCount
  const failedAt = dag.nodes.findIndex((n) => n.status === 'failed')
  if (failedAt >= 0) return { x: failedAt + 1, y }
  const done = dag.nodes.filter(
    (n) => n.status === 'completed' || n.status === 'skipped',
  ).length
  const active = dag.nodes.some(
    (n) => n.status === 'running' || n.status === 'paused',
  )
  return { x: Math.min(y, done + (active ? 1 : 0)), y }
}
