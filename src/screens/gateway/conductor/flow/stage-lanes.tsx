import { useStore } from '@xyflow/react'
import { laneExtents } from './flow-model'
import type { FlowNode } from './flow-model'

/**
 * Faint PLAN / EXECUTE / REVIEW bands behind the nodes. X follows the
 * viewport (pan / zoom / drag); bands always span the full canvas height.
 */
export function StageLanes({ nodes }: { nodes: Array<FlowNode> }) {
  const [tx, , zoom] = useStore((s) => s.transform)
  const lanes = laneExtents(
    nodes.map((n) => ({ stage: n.data.node.stage, x: n.position.x })),
  )
  if (lanes.length < 2) return null
  return (
    <div className="flow-lanes" aria-hidden="true">
      {lanes.map((l) => (
        <div
          key={l.stage}
          className="flow-lane"
          style={{ left: tx + l.x0 * zoom, width: (l.x1 - l.x0) * zoom }}
        >
          <span>{l.stage}</span>
        </div>
      ))}
    </div>
  )
}
