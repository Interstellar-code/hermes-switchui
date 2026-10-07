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
  getViewportForBounds,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { NODE_H, NODE_W, layoutDag } from '../dag-layout'
import { FlowControls } from './flow-controls'
import { FlowNodeComponent } from './flow-node'
import { mergePositions, toFlow } from './flow-model'
import { StageLanes } from './stage-lanes'
import type { FlowNode, FlowNodeMeta } from './flow-model'
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
  /**
   * F4 graph editor (opt-in; Conductor defaults unchanged): connectable
   * handles, Delete/Backspace removal, palette drop-to-add, selection
   * tracking and editor-owned position overrides instead of the layout store.
   */
  editable?: boolean
  /** editable: drag handle → handle means target depends_on source. */
  onConnect?: (connection: { source: string; target: string }) => void
  /** editable: nodes removed with the Delete key / button. */
  onNodesDelete?: (nodeIds: Array<string>) => void
  /** editable: edges removed with the Delete key (= depends_on entries). */
  onEdgesDelete?: (edges: Array<{ source: string; target: string }>) => void
  /** editable: palette drag-and-drop; position is in flow coordinates. */
  onDropNode?: (nodeType: string, position: { x: number; y: number }) => void
  /** editable: selection changes (node ids; empty = nothing selected). */
  onSelectionChange?: (nodeIds: Array<string>) => void
  /** editable: positions after a node drag (all nodes, flow coordinates). */
  onPositionsChange?: (
    positions: Record<string, { x: number; y: number }>,
  ) => void
  /** editable: editor-owned positions that win over seed/saved (drop spots). */
  overridePositions?: Record<string, { x: number; y: number }>
  /** editable: per-node editor visuals (subtitle, validation marker). */
  nodeMeta?: Record<string, FlowNodeMeta>
  /**
   * F3 definition view (opt-in; Conductor defaults unchanged): nodes show
   * their stage instead of run status, drag is session-only — nothing is
   * read from or written to the shared Conductor layout store.
   */
  neutral?: boolean
}

// Pixel padding: a long chain is width-bound, so % padding would waste zoom.
const PAD_X = 24
const FIT = {
  padding: { x: `${PAD_X}px`, y: '32px' },
  maxZoom: 1.25,
  /** Card text stays readable; wider graphs pan horizontally. */
  minZoom: 0.85,
} as const
/** The idle preview cannot pan, so it fits whole. */
const PREVIEW_MIN_ZOOM = 0.3
const nodeTypes = { dag: FlowNodeComponent }

type Mode = 'fit' | 'free' | { centredOn: string }

function FlowCanvasInner({
  dag,
  workflowId,
  preview = false,
  onNodeSelect,
  focusNodeId = null,
  resetKey = 0,
  editable = false,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onDropNode,
  onSelectionChange,
  onPositionsChange,
  overridePositions,
  nodeMeta,
  neutral = false,
}: FlowCanvasProps) {
  const {
    setViewport,
    setCenter,
    screenToFlowPosition,
    getNodes,
    getNode,
    getNodesBounds,
  } = useReactFlow<FlowNode>()
  const hostRef = useRef<HTMLDivElement>(null)
  // Neutral (definition) mode never reads or writes the shared layout store.
  const storeId = neutral ? null : workflowId
  const saved = useConductorLayoutStore((s) =>
    storeId ? s.layouts[storeId] : undefined,
  )
  const savePositions = useConductorLayoutStore((s) => s.savePositions)
  const setLocked = useConductorLayoutStore((s) => s.setLocked)
  // The editor always allows dragging and never writes the Conductor store.
  const locked = editable || neutral ? false : (saved?.locked ?? false)

  const seed = useMemo(() => layoutDag(dag).positions, [dag])
  const [initialNodes] = useState(
    () =>
      toFlow(
        dag,
        mergePositions(
          seed,
          editable
            ? { ...(saved?.positions ?? {}), ...overridePositions }
            : saved?.positions,
          dag.nodes.map((n) => n.id),
        ),
        preview,
        editable,
        nodeMeta,
        neutral,
      ).nodes,
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const edges = useMemo(
    () => toFlow(dag, {}, preview, editable).edges,
    [dag, preview, editable],
  )

  // Status polls rebuild node data; on-canvas positions (and measurements) stay.
  useEffect(() => {
    setNodes((prev) => {
      const current = Object.fromEntries(prev.map((n) => [n.id, n.position]))
      const ids = dag.nodes.map((n) => n.id)
      const byId = new Map(prev.map((n) => [n.id, n]))
      const base = editable ? { ...current, ...overridePositions } : current
      return toFlow(
        dag,
        mergePositions(seed, base, ids),
        preview,
        editable,
        nodeMeta,
        neutral,
      ).nodes.map((n) => {
        const existing = byId.get(n.id)
        const next = { ...existing, ...n }
        // Editor rebuilds on validation updates; keep the selection.
        if (editable && existing?.selected) next.selected = true
        return next
      })
    })
  }, [
    dag,
    seed,
    preview,
    editable,
    nodeMeta,
    overridePositions,
    neutral,
    setNodes,
  ])

  // Auto-fit follows container resizes until the user pans / zooms.
  const autoFit = useRef(true)
  const [mode, setMode] = useState<Mode>('fit')
  // fitView, except a graph clamped at the zoom floor shows its start
  // (left edge) instead of a cropped middle.
  const fitRef = useRef((_duration?: number) => {})
  fitRef.current = (duration = 0) => {
    const el = hostRef.current
    const all = getNodes()
    if (!el || all.length === 0) return
    const b = getNodesBounds(all)
    const vp = getViewportForBounds(
      b,
      el.clientWidth,
      el.clientHeight,
      preview ? PREVIEW_MIN_ZOOM : FIT.minZoom,
      FIT.maxZoom,
      FIT.padding,
    )
    if (b.width * vp.zoom > el.clientWidth - 2 * PAD_X)
      vp.x = PAD_X - b.x * vp.zoom
    void setViewport(vp, { duration })
  }
  const refit = (duration = 0) => {
    autoFit.current = true
    setMode('fit')
    fitRef.current(duration)
  }
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (autoFit.current) fitRef.current()
      }, 60)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [])

  const resetSeen = useRef(resetKey)
  useEffect(() => {
    if (resetKey === resetSeen.current) return
    resetSeen.current = resetKey
    setNodes((prev) =>
      prev.map((n) => ({ ...n, position: seed[n.id] ?? n.position })),
    )
    autoFit.current = true
    setMode('fit')
    requestAnimationFrame(() => fitRef.current(200))
  }, [resetKey, seed, setNodes])

  const initialised = useNodesInitialized()
  const focused = useRef(false)
  useEffect(() => {
    if (!initialised) return
    if (!focusNodeId) {
      if (focused.current) {
        focused.current = false
        autoFit.current = true
        setMode('fit')
        fitRef.current(200)
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
  }, [focusNodeId, initialised, getNode, setCenter])

  const [minimap, setMinimap] = useState(true)
  const manual = () => {
    autoFit.current = false
    setMode('free')
  }

  return (
    <div
      ref={hostRef}
      className={`flow-host${preview ? ' preview' : ''}${editable ? ' editable' : ''}`}
      {...(editable
        ? {
            onDragOver: (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            },
            onDrop: (event) => {
              if (!onDropNode) return
              event.preventDefault()
              const type = event.dataTransfer.getData(
                'application/x-switchui-wf-node',
              )
              if (!type) return
              onDropNode(
                type,
                screenToFlowPosition({
                  x: event.clientX,
                  y: event.clientY,
                }),
              )
            },
          }
        : {})}
    >
      <ReactFlow
        aria-label={
          preview
            ? 'Mission flow preview'
            : editable
              ? 'Workflow graph editor canvas'
              : 'Mission flow canvas'
        }
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
        nodesConnectable={editable}
        nodesDraggable={!locked && !preview}
        nodesFocusable={false}
        edgesFocusable={editable}
        elementsSelectable={!preview}
        panOnDrag={!preview}
        zoomOnScroll={!preview}
        zoomOnDoubleClick={!preview}
        preventScrolling={!preview}
        fitView
        fitViewOptions={{
          ...FIT,
          minZoom: preview ? PREVIEW_MIN_ZOOM : FIT.minZoom,
        }}
        minZoom={PREVIEW_MIN_ZOOM}
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
        onConnect={
          editable && onConnect
            ? (connection) => {
                if (!connection.source || !connection.target) return
                if (connection.source === connection.target) return
                onConnect({
                  source: connection.source,
                  target: connection.target,
                })
              }
            : undefined
        }
        onNodesDelete={
          editable && onNodesDelete
            ? (deleted) => onNodesDelete(deleted.map((n) => n.id))
            : undefined
        }
        onEdgesDelete={
          editable && onEdgesDelete
            ? (deleted) =>
                onEdgesDelete(
                  deleted
                    .map((e) => {
                      const found = edges.find((x) => x.id === e.id)
                      return found
                        ? { source: found.source, target: found.target }
                        : null
                    })
                    .filter(
                      (p): p is { source: string; target: string } => p != null,
                    ),
                )
            : undefined
        }
        onEdgesChange={
          editable && onEdgesDelete
            ? (changes) => {
                const removed = changes.filter(
                  (c): c is { type: 'remove'; id: string } =>
                    c.type === 'remove',
                )
                if (removed.length === 0) return
                onEdgesDelete(
                  removed
                    .map((c) => {
                      const found = edges.find((x) => x.id === c.id)
                      return found
                        ? { source: found.source, target: found.target }
                        : null
                    })
                    .filter(
                      (p): p is { source: string; target: string } => p != null,
                    ),
                )
              }
            : undefined
        }
        onSelectionChange={
          editable && onSelectionChange
            ? ({ nodes: selected }) =>
                onSelectionChange(selected.map((n) => n.id))
            : undefined
        }
        onNodeDragStop={(_, __, dragged) => {
          if (editable) {
            if (!onPositionsChange) return
            const current = new Map(getNodes().map((n) => [n.id, n.position]))
            for (const n of dragged) current.set(n.id, n.position)
            onPositionsChange(Object.fromEntries(current))
            return
          }
          if (neutral || !workflowId) return
          const current = new Map(getNodes().map((n) => [n.id, n.position]))
          for (const n of dragged) current.set(n.id, n.position)
          // Only moved nodes persist; the rest keep following the seed.
          const positions = Object.fromEntries(
            [...current].filter(
              ([id, p]) =>
                !(id in seed) || seed[id].x !== p.x || seed[id].y !== p.y,
            ),
          )
          savePositions(workflowId, positions)
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <StageLanes nodes={nodes} />
        {!preview && (
          <>
            <FlowControls
              locked={locked}
              lockDisabled={!workflowId || editable || neutral}
              onToggleLock={() =>
                !editable && workflowId && setLocked(workflowId, !locked)
              }
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
                nodeColor={(n: FlowNode) =>
                  `color-mix(in oklab, ${nodeColor(n.data.node.type)} var(--mm-mix, 100%), var(--theme-text))`
                }
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
