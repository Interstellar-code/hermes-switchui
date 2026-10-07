/**
 * palette.tsx — F4 graph editor node palette. Each entry drags onto the
 * canvas (FlowCanvas editable onDropNode) or clicks to append.
 */
import { nodeColor } from '../node-colors'
import { PALETTE_TYPES } from './editor-graph'
import type { CSSProperties, ReactElement } from 'react'
import type { NodeType } from '../types'

const ICONS: Record<NodeType, ReactElement> = {
  prompt: (
    <path
      d="M2 3h12v8H6l-3 3z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  bash: (
    <path
      d="M2 4l4 4-4 4M8 12h6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  script: (
    <path
      d="M2 4l4 4-4 4M8 12h6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  command: (
    <path
      d="M5 2v12M11 2v12M2 5h12M2 11h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  approval: (
    <path
      d="M3 8l3 3 7-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  loop: (
    <path
      d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  router: (
    <path
      d="M2 8h5l3-4h4M7 8l3 4h4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  cancel: (
    <path
      d="M4 4l8 8M12 4l-8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  subgraph: (
    <path
      d="M2 2h5v5H2zM9 9h5v5H9zM7 4.5h4.5V9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
}

export const PALETTE_DRAG_MIME = 'application/x-switchui-wf-node'

export function NodePalette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  return (
    <aside className="wge-pal" aria-label="Node palette">
      <h2>ADD NODE</h2>
      {PALETTE_TYPES.map(({ type, label }) => (
        <button
          key={type}
          type="button"
          className="wge-pi"
          style={{ '--c': nodeColor(type) } as CSSProperties}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(PALETTE_DRAG_MIME, type)
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onAdd(type)}
          aria-label={`Add ${label} node`}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
            {ICONS[type]}
          </svg>
          {label}
        </button>
      ))}
      <p className="wge-meta">
        Drag onto the canvas, or select a node and press A to add after it.
      </p>
    </aside>
  )
}
