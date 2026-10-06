import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { agentCount, loopBadge } from '../dag-model'
import { nodeClass, statusGlyph, statusText } from './flow-model'
import { useNow } from './use-now'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { FlowNode } from './flow-model'
import { compactTokens } from '@/lib/format-usage'
import { nodeColor } from '@/screens/workflows/node-colors'

function FlowNodeView({ data }: NodeProps<FlowNode>) {
  const { node: n, upstreamFailed, preview } = data
  const editable = data.editable === true
  const now = useNow(
    !preview && (n.status === 'running' || n.status === 'paused'),
  )
  const badge = loopBadge(n.loop)
  const nAgents = agentCount(n.sessions)
  const line = preview
    ? n.stage.toLowerCase()
    : editable
      ? (data.subtitle ?? n.stage.toLowerCase())
      : statusText(n, now, upstreamFailed)
  const status = n.status === 'idle' ? 'pending' : n.status

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    // Same path as a pointer click: React Flow's onNodeClick ignores keys, so click the wrapper.
    e.currentTarget.parentElement?.click()
  }

  return (
    <div
      className={`dn ${nodeClass(n.status)} t-${n.type}${editable && data.disconnected ? ' dn-new' : ''}`}
      style={{ '--node-c': nodeColor(n.type) } as CSSProperties}
      data-node-id={n.id}
      {...(preview
        ? {}
        : {
            tabIndex: 0,
            role: 'button',
            'aria-label': `${n.label}, ${n.type} node, ${status}: ${line}. ${editable && data.errorText ? `Error: ${data.errorText}. ` : ''}${editable ? 'Select to configure' : 'Open details'}`,
            onKeyDown,
          })}
    >
      <Handle type="target" position={Position.Left} isConnectable={editable} />
      <span className="k">
        {n.type}
        {badge && <span className="loop">↻ {badge}</span>}
        <span className="x" aria-hidden="true">
          {statusGlyph(n.status)}
        </span>
      </span>
      <span className="nm">{n.label}</span>
      <span className="s">
        {line}
        {n.tokens != null &&
          n.tokens > 0 &&
          ` · ${compactTokens(n.tokens)} tok`}
      </span>
      {nAgents > 0 && <span className="agents-chip">◇ {nAgents}</span>}
      {editable && data.errorText && (
        <span className="dn-errmsg" aria-hidden="true">
          {data.errorText}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={editable}
      />
    </div>
  )
}

export const FlowNodeComponent = memo(FlowNodeView)
