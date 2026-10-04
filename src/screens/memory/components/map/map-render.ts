/**
 * Pure renderer helpers for the Memory Map canvas (memory-map.tsx): colour
 * buckets per colour-by mode, dimming, node radius and minimap geometry.
 * Kept DOM-free so they unit-test without a canvas.
 */

import { KIND_ORDER } from './map-kinds'
import type { ColourBy, Kind } from '../memory-map-graph'

/** Named cluster palette slots (`--mm-cluster-0..7`); index 8 = "Other". */
export const CLUSTER_SLOTS = 8
/** Age ramp, oldest → newest (tokens in matrix-memory-map.css). */
export const AGE_VARS = [
  '--mm-age-old',
  '--mm-age-1',
  '--mm-age-2',
  '--mm-age-3',
  '--mm-age-4',
  '--mm-age-new',
] as const

export type MapPalette = {
  kind: Record<Kind, string>
  /** CLUSTER_SLOTS slot colours + "Other" last. */
  cluster: ReadonlyArray<string>
  /** AGE_VARS ramp colours + "undated" (muted) last. */
  age: ReadonlyArray<string>
  text: string
  bg: string
  accent: string
  /** neutral edge colour for the cluster / age modes */
  edge: string
}

/** Colour list a mode indexes into; `colourIndex` picks the slot. */
export function paletteFor(
  mode: ColourBy,
  p: MapPalette,
): ReadonlyArray<string> {
  if (mode === 'cluster') return p.cluster
  if (mode === 'age') return p.age
  return KIND_ORDER.map((k) => p.kind[k])
}

/**
 * Colour bucket of a node under `mode`. `clusterId` is from computeClusters
 * (-1 = Other); `ageT` is 0 (oldest) … 1 (newest), null when undated
 * (its own muted bucket after the ramp, never "oldest").
 */
export function colourIndex(
  mode: ColourBy,
  kind: Kind,
  clusterId: number,
  ageT: number | null,
): number {
  if (mode === 'cluster')
    return clusterId >= 0 && clusterId < CLUSTER_SLOTS
      ? clusterId
      : CLUSTER_SLOTS
  if (mode === 'age')
    return ageT == null
      ? AGE_VARS.length
      : Math.round(Math.min(1, Math.max(0, ageT)) * (AGE_VARS.length - 1))
  return KIND_ORDER.indexOf(kind)
}

/** Recency of `t` within [min, max] as 0..1; null when undated. */
export function ageOf(
  t: number | null | undefined,
  min: number,
  max: number,
): number | null {
  if (t == null || !Number.isFinite(t)) return null
  return max > min ? (t - min) / (max - min) : 1
}

/** Nodes outside the search hits, the active neighbourhood or the selected cluster fade. */
export function isDimmed(
  id: string,
  clusterId: number,
  s: {
    hits: Set<string> | null
    neighbors: Set<string> | null
    selectedCluster: number | null
  },
): boolean {
  return (
    (s.hits != null && !s.hits.has(id)) ||
    (s.neighbors != null && !s.neighbors.has(id)) ||
    (s.selectedCluster != null && clusterId !== s.selectedCluster)
  )
}

const BASE_R: Record<Kind, number> = {
  gist: 2.6,
  working: 2.6,
  fact: 2.6,
  entity: 3,
  episodic: 3.4,
  wiki: 4,
}

/** Every kind grows with degree (sqrt, +6 cap) so hubs stand out. */
export function nodeRadius(kind: Kind, deg: number): number {
  return BASE_R[kind] + Math.min(6, Math.sqrt(Math.max(0, deg)))
}

// ── minimap geometry ────────────────────────────────────────────────────────

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
/** sim → minimap: `mini = sim * k + (x, y)` */
export type MiniTransform = { k: number; x: number; y: number }

/** Fit `b` (sim coords) centred into a w×h minimap with `pad` px inset. */
export function minimapTransform(
  b: Bounds,
  w: number,
  h: number,
  pad = 6,
): MiniTransform {
  const bw = Math.max(1, b.maxX - b.minX)
  const bh = Math.max(1, b.maxY - b.minY)
  const k = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)
  return {
    k,
    x: w / 2 - (k * (b.minX + b.maxX)) / 2,
    y: h / 2 - (k * (b.minY + b.maxY)) / 2,
  }
}

/** The main canvas viewport (zoom `t`, width×height px) as a minimap rect. */
export function viewportRect(
  t: { x: number; y: number; k: number },
  width: number,
  height: number,
  m: MiniTransform,
): { x: number; y: number; w: number; h: number } {
  const sx = -t.x / t.k
  const sy = -t.y / t.k
  return {
    x: sx * m.k + m.x,
    y: sy * m.k + m.y,
    w: (width / t.k) * m.k,
    h: (height / t.k) * m.k,
  }
}

/** Minimap px → sim coords. */
export function miniToSim(
  mx: number,
  my: number,
  m: MiniTransform,
): [number, number] {
  return [(mx - m.x) / m.k, (my - m.y) / m.k]
}
