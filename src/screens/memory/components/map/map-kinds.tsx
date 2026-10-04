/**
 * map-kinds — kind/edge-type order, shapes and the legend glyph, shared by the
 * Memory Map canvas (memory-map.tsx), rail and inspector.
 */

import type { EdgeType, Kind } from '../memory-map-graph'

export type Shape =
  | 'circle'
  | 'ring'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'square'

export const KIND_ORDER: ReadonlyArray<Kind> = [
  'gist',
  'working',
  'fact',
  'entity',
  'episodic',
  'wiki',
]
export const EDGE_ORDER: ReadonlyArray<EdgeType> = [
  'mentions',
  'about',
  'ctx',
  'summarizes',
  'references',
  'relates',
]
export const KIND_SHAPE: Record<Kind, Shape> = {
  gist: 'circle',
  working: 'ring',
  fact: 'triangle',
  entity: 'diamond',
  episodic: 'hexagon',
  wiki: 'square',
}
// Edges borrow a kind colour (drawn with globalAlpha).
export const EDGE_KIND: Record<EdgeType, Kind> = {
  ctx: 'gist',
  references: 'wiki',
  mentions: 'entity',
  about: 'fact',
  relates: 'episodic',
  summarizes: 'working',
}

/** SVG twin of tracePath for legend / panel chips. */
export function KindGlyph({ kind }: { kind: Kind }) {
  const fill = `var(--mm-${kind})`
  const shape = KIND_SHAPE[kind]
  return (
    <svg className="mm-glyph" viewBox="0 0 12 12" aria-hidden="true">
      {shape === 'circle' && <circle cx="6" cy="6" r="4.5" fill={fill} />}
      {shape === 'ring' && (
        <circle
          cx="6"
          cy="6"
          r="3.8"
          fill="none"
          stroke={fill}
          strokeWidth="1.8"
        />
      )}
      {shape === 'square' && (
        <rect x="1.8" y="1.8" width="8.4" height="8.4" rx="1" fill={fill} />
      )}
      {shape === 'diamond' && (
        <path d="M6 0.6L11.4 6 6 11.4 0.6 6z" fill={fill} />
      )}
      {shape === 'triangle' && <path d="M6 1L11.2 10.5H0.8z" fill={fill} />}
      {shape === 'hexagon' && (
        <path d="M11 6L8.5 10.3h-5L1 6l2.5-4.3h5z" fill={fill} />
      )}
    </svg>
  )
}
