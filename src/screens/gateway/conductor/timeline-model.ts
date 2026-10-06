/** timeline-model.ts — pure helpers behind MissionTimeline (Gantt of node_runs). */

import { toEpochMs } from '@/screens/workflows/run-status'

export type TimelineScale = '1M' | '5M' | '15M' | 'FIT'
export const SCALE_MS: Record<Exclude<TimelineScale, 'FIT'>, number> = {
  '1M': 60_000,
  '5M': 300_000,
  '15M': 900_000,
}

/** Fields read from a node_run row (loop_iteration is optional on the wire). */
export interface TimelineInputRun {
  id: string
  dag_node_id: string
  status: string
  started_at?: string | number | null
  completed_at?: string | number | null
  loop_iteration?: number | null
  node_type?: string | null
}

export interface TimelineRow {
  id: string
  label: string
  /** Node type (bar colour); null when the row does not say. */
  type: string | null
  status: string
  startedAt: number | null
  completedAt: number | null
  iteration: number | null
}

/** One row per node_run; iterations stacked under their node, by first start. */
export function buildRows(runs: Array<TimelineInputRun>): Array<TimelineRow> {
  const rows = runs.map((r) => ({
    id: r.id,
    label: r.dag_node_id,
    type: r.node_type ?? null,
    status: r.status,
    startedAt: toEpochMs(r.started_at),
    completedAt: toEpochMs(r.completed_at),
    iteration: r.loop_iteration ?? null,
  }))
  const first = new Map<string, number>()
  for (const r of rows) {
    const s = r.startedAt ?? Infinity
    first.set(r.label, Math.min(first.get(r.label) ?? Infinity, s))
  }
  return rows.sort(
    (a, b) =>
      first.get(a.label)! - first.get(b.label)! ||
      a.label.localeCompare(b.label) ||
      (a.iteration ?? 0) - (b.iteration ?? 0) ||
      (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity),
  )
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function rowEnd(row: TimelineRow, now: number): number | null {
  if (row.startedAt == null) return null
  return row.completedAt ?? now
}

export function rowDuration(row: TimelineRow, now: number): number | null {
  const end = rowEnd(row, now)
  return end == null ? null : Math.max(0, end - row.startedAt!)
}

/** Visible window [start, end] for a scale. FIT spans all rows up to now. */
export function windowFor(
  rows: Array<TimelineRow>,
  scale: TimelineScale,
  now: number,
): { start: number; end: number } {
  if (scale !== 'FIT') return { start: now - SCALE_MS[scale], end: now }
  const starts = rows.flatMap((r) => (r.startedAt != null ? [r.startedAt] : []))
  const start = starts.length ? Math.min(...starts) : now - 60_000
  const end = rows.some((r) => r.startedAt != null && r.completedAt == null)
    ? now
    : Math.max(
        start + 1000,
        ...rows.map((r) => r.completedAt ?? r.startedAt ?? 0),
      )
  return { start, end: Math.max(end, start + 1000) }
}

/** Percent position (clamped 0..100) of t within the window. */
export function pct(t: number, w: { start: number; end: number }): number {
  return Math.min(100, Math.max(0, ((t - w.start) / (w.end - w.start)) * 100))
}

/** 5 evenly spaced ticks: offset from start (FIT) or relative to now (fixed scales). */
export function axisTicks(w: { start: number; end: number }, fixed = false) {
  return [0, 25, 50, 75, 100].map((p) => ({
    pct: p,
    label: fixed
      ? p === 100
        ? 'now'
        : `-${formatDuration(((w.end - w.start) * (100 - p)) / 100)}`
      : formatDuration(((w.end - w.start) * p) / 100),
  }))
}
