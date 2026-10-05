/**
 * flow-canvas.tsx — React Flow mission canvas. Lazy-loaded (default export)
 * by mission-canvas.tsx and conductor-idle.tsx so @xyflow/react stays in the
 * conductor chunk; the /conductor route is `ssr: false`.
 */
import '@xyflow/react/dist/base.css'
import '@/styles/conductor-flow.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { NODE_H, NODE_W, layoutDag } from '../dag-layout'
import { FlowControls } from './flow-controls'
import { FlowNodeComponent } from './flow-node'
import { mergePositions, toFlow } from './flow-model'
import { StageLanes } from './stage-lanes'
import type { FlowNode } from './flow-model'
import type { DagModel } from '../dag-model'
import { useConductorLayoutStore } from '@/stores/conductor-layout-store'
import { nodeColor } from '@/screens/workflows/node-colors'

export interface FlowCanvasProps {
  dag: DagModel
  /** Layout persistence key; null = nothing saved (still draggable). */
  workflowId: string | null
  /** Idle preview: dimmed, read-only, no controls. */
  preview?: boolean
  /** Node click / Enter. */
  onNodeSelect?: (nodeId: string) => void
  /** Centre on this node at 100% (F2 docked panel); null returns to fit. */
  focusNodeId?: string | null
  /** Bumped by RESET LAYOUT: back to the seeded layout, refit. */
  resetKey?: number
}

// Pixel padding: a long chain is width-bound, so % padding would waste zoom.
const FIT = {
  padding: { x: '24px', y: '32px' },
  maxZoom: 1.25,
  minZoom: 0.3,
} as const
const nodeTypes = { dag: FlowNodeComponent }

type Mode = 'fit' | 'free' | { centredOn: string }

function FlowCanvasInner({
  dag,
  workflowId,
  preview = false,
  onNodeSelect,
  focusNodeId = null,
  resetKey = 0,
}: FlowCanvasProps) {
  const { fitView, setCenter, getNodes, getNode } = useReactFlow<FlowNode>()
  const hostRef = useRef<HTMLDivElement>(null)
  const saved = useConductorLayoutStore((s) =>
    workflowId ? s.layouts[workflowId] : undefined,
  )
  const savePositions = useConductorLayoutStore((s) => s.savePositions)
  const setLocked = useConductorLayoutStore((s) => s.setLocked)
  const locked = saved?.locked ?? false

  const seed = useMemo(() => layoutDag(dag).positions, [dag])
  const [initialNodes] = useState(
    () =>
      toFlow(
        dag,
        mergePositions(
          seed,
          saved?.positions,
          dag.nodes.map((n) => n.id),
        ),
        preview,
      ).nodes,
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const edges = useMemo(() => toFlow(dag, {}, preview).edges, [dag, preview])

  // Status polls rebuild node data; on-canvas positions (and measurements) stay.
  useEffect(() => {
    setNodes((prev) => {
      const current = Object.fromEntries(prev.map((n) => [n.id, n.position]))
      const ids = dag.nodes.map((n) => n.id)
      const byId = new Map(prev.map((n) => [n.id, n]))
      return toFlow(dag, mergePositions(seed, current, ids), preview).nodes.map(
        (n) => ({ ...byId.get(n.id), ...n }),
      )
    })
  }, [dag, seed, preview, setNodes])

  // Auto-fit follows container resizes until the user pans / zooms.
  const autoFit = useRef(true)
  const [mode, setMode] = useState<Mode>('fit')
  const refit = (duration = 0) => {
    autoFit.current = true
    setMode('fit')
    void fitView({ ...FIT, duration })
  }
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (autoFit.current) void fitView(FIT)
      }, 60)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [fitView])

  const resetSeen = useRef(resetKey)
  useEffect(() => {
    if (resetKey === resetSeen.current) return
    resetSeen.current = resetKey
    setNodes((prev) =>
      prev.map((n) => ({ ...n, position: seed[n.id] ?? n.position })),
    )
    autoFit.current = true
    setMode('fit')
    requestAnimationFrame(() => void fitView({ ...FIT, duration: 200 }))
  }, [resetKey, seed, setNodes, fitView])

  const initialised = useNodesInitialized()
  const focused = useRef(false)
  useEffect(() => {
    if (!initialised) return
    if (!focusNodeId) {
      if (focused.current) {
        focused.current = false
        autoFit.current = true
        setMode('fit')
        void fitView({ ...FIT, duration: 200 })
      }
      return
    }
    const n = getNode(focusNodeId)
    if (!n) return
    focused.current = true
    autoFit.current = false
    setMode({ centredOn: focusNodeId })
    void setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, {
      zoom: 1,
      duration: 250,
    })
  }, [focusNodeId, initialised, getNode, setCenter, fitView])

  const [minimap, setMinimap] = useState(true)
  const manual = () => {
    autoFit.current = false
    setMode('free')
  }

  return (
    <div ref={hostRef} className={`flow-host${preview ? ' preview' : ''}`}>
      <ReactFlow
        aria-label={preview ? 'Mission flow preview' : 'Mission flow canvas'}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        nodesDraggable={!locked && !preview}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={!preview}
        panOnDrag={!preview}
        zoomOnScroll={!preview}
        zoomOnDoubleClick={!preview}
        preventScrolling={!preview}
        fitView
        fitViewOptions={FIT}
        minZoom={FIT.minZoom}
        maxZoom={2}
        snapToGrid
        snapGrid={[8, 8]}
        proOptions={{ hideAttribution: true }}
        onMoveStart={(event) => {
          if (event) manual()
        }}
        onNodeClick={
          onNodeSelect && !preview
            ? (_, node) => onNodeSelect(node.id)
            : undefined
        }
        onNodeDragStop={(_, __, dragged) => {
          if (!workflowId) return
          const positions = Object.fromEntries(
            getNodes().map((n) => [n.id, n.position]),
          )
          for (const n of dragged) positions[n.id] = n.position
          savePositions(workflowId, positions)
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <StageLanes nodes={nodes} />
        {!preview && (
          <>
            <FlowControls
              locked={locked}
              onToggleLock={() => workflowId && setLocked(workflowId, !locked)}
              minimap={minimap}
              onToggleMinimap={() => setMinimap((m) => !m)}
              onFit={() => refit(200)}
              onZoom={manual}
              mode={mode}
            />
            {minimap && (
              <MiniMap
                ariaLabel="Mission flow minimap"
                style={{ width: 176, height: 104 }}
                nodeColor={(n: FlowNode) => nodeColor(n.data.node.type)}
                nodeBorderRadius={2}
                pannable
                zoomable
              />
            )}
          </>
        )}
      </ReactFlow>
    </div>
  )
}

export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
