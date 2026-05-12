/**
 * GraphTab — Graph tab body for the Memory screen (MEM-06).
 *
 * No heavy graph lib in deps — renders an SVG adjacency graph using a
 * simple spring-layout simulation (requestAnimationFrame, 60 ticks).
 * Falls back to a node/edge list if the graph endpoint returns no data.
 *
 * Data source: GET /api/knowledge/graph → { nodes, edges }
 *
 * Tier-1 UX improvements:
 *  1. Hover tooltip (full title, type chip, degree count)
 *  2. Progressive label density (selected/hovered/high-degree only)
 *  3. Interactive legend (isolate / mute per category)
 *  4. Clickable neighbor links in detail panel
 *  5. 1-hop / 2-hop / all toggle
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import type { KnowledgeGraph } from '@/server/knowledge-browser'

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchGraph(): Promise<KnowledgeGraph> {
  const res = await fetch('/api/knowledge/graph')
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<KnowledgeGraph>
}

// ── Type colours ──────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  product: '#00ff41',
  memory: '#5fcfff',
  engineering: '#ffb347',
  design: '#d6ff5f',
  ops: '#ff5fa2',
}

function nodeColor(type?: string): string {
  if (!type) return '#00ff41'
  const key = type.toLowerCase()
  return TYPE_COLORS[key] ?? '#00ff41'
}

// ── Zustand store for graph UI state ─────────────────────────────────────────

type HopMode = '1' | '2' | 'all'
type CategoryFilterMode = 'isolate' | 'mute'

interface GraphStore {
  graphCategoryFilter: { category: string; mode: CategoryFilterMode } | null
  setGraphCategoryFilter: (f: { category: string; mode: CategoryFilterMode } | null) => void
  hopMode: HopMode
  setHopMode: (m: HopMode) => void
}

const useGraphStore = create<GraphStore>((set) => ({
  graphCategoryFilter: null,
  setGraphCategoryFilter: (f) => set({ graphCategoryFilter: f }),
  hopMode: 'all',
  setHopMode: (m) => set({ hopMode: m }),
}))

// ── Spring layout ─────────────────────────────────────────────────────────────

type SimNode = {
  id: string
  title: string
  type?: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

function initNodes(
  nodes: KnowledgeGraph['nodes'],
  width: number,
  height: number,
): Array<SimNode> {
  return nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    const rad = Math.min(width, height) * 0.35
    return {
      id: n.id,
      title: n.title,
      type: n.type,
      x: width / 2 + Math.cos(angle) * rad * (0.5 + Math.random() * 0.5),
      y: height / 2 + Math.sin(angle) * rad * (0.5 + Math.random() * 0.5),
      vx: 0,
      vy: 0,
      r: 10 + Math.min(n.tags.length * 2, 8),
    }
  })
}

function runLayout(
  nodes: Array<SimNode>,
  edges: KnowledgeGraph['edges'],
  width: number,
  height: number,
  ticks = 80,
): Array<SimNode> {
  const idxById = new Map(nodes.map((n, i) => [n.id, i]))
  const sim = nodes.map((n) => ({ ...n }))

  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks

    // repulsion
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        const dx = b.x - a.x || 0.01
        const dy = b.y - a.y || 0.01
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (3000 / (dist * dist)) * alpha
        a.vx -= (dx / dist) * force
        a.vy -= (dy / dist) * force
        b.vx += (dx / dist) * force
        b.vy += (dy / dist) * force
      }
    }

    // attraction along edges
    for (const edge of edges) {
      const si = idxById.get(edge.source)
      const ti = idxById.get(edge.target)
      if (si == null || ti == null) continue
      const a = sim[si]
      const b = sim[ti]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - 120) * 0.04 * alpha
      a.vx += (dx / dist) * force
      a.vy += (dy / dist) * force
      b.vx -= (dx / dist) * force
      b.vy -= (dy / dist) * force
    }

    // gravity to centre — degree-weighted so isolated nodes get pulled in harder
    const degMap = new Map<string, number>()
    for (const e of edges) {
      degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1)
      degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1)
    }
    for (const n of sim) {
      const deg = degMap.get(n.id) ?? 0
      // Low-degree nodes (orphans, leaves) get much stronger gravity
      const gravityCoef = deg === 0 ? 0.08 : deg === 1 ? 0.04 : 0.02
      n.vx += (width / 2 - n.x) * gravityCoef * alpha
      n.vy += (height / 2 - n.y) * gravityCoef * alpha
    }

    // integrate — clamp inside a margin-cropped area so outliers can't park at the wall
    const margin = Math.min(width, height) * 0.12
    for (const n of sim) {
      n.vx *= 0.85
      n.vy *= 0.85
      n.x += n.vx
      n.y += n.vy
      n.x = Math.max(n.r + margin, Math.min(width - n.r - margin, n.x))
      n.y = Math.max(n.r + margin, Math.min(height - n.r - margin, n.y))
    }
  }
  return sim
}

// ── Post-layout centering pass ────────────────────────────────────────────────

function recenterGraph(nodes: Array<SimNode>, width: number, height: number): Array<SimNode> {
  if (nodes.length === 0) return nodes
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  }
  const bbW = maxX - minX
  const bbH = maxY - minY
  const targetW = width * 0.70
  const targetH = height * 0.70
  const scaleX = bbW > targetW ? targetW / bbW : 1
  const scaleY = bbH > targetH ? targetH / bbH : 1
  const scale = Math.min(scaleX, scaleY)
  if (scale >= 1) return nodes
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return nodes.map((n) => ({
    ...n,
    x: cx + (n.x - cx) * scale,
    y: cy + (n.y - cy) * scale,
  }))
}

// ── Degree helpers ────────────────────────────────────────────────────────────

function computeDegrees(
  nodes: Array<SimNode>,
  edges: KnowledgeGraph['edges'],
): Map<string, number> {
  const deg = new Map<string, number>()
  for (const n of nodes) deg.set(n.id, 0)
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  return deg
}

function computeHighDegreeThreshold(degrees: Map<string, number>): number {
  const vals = Array.from(degrees.values()).sort((a, b) => a - b)
  if (vals.length === 0) return 3
  const p75idx = Math.floor(vals.length * 0.75)
  return Math.max(3, vals[p75idx] ?? 3)
}

// ── Hop visibility ────────────────────────────────────────────────────────────

function computeVisibleIds(
  selectedId: string | null,
  hopMode: HopMode,
  edges: KnowledgeGraph['edges'],
): Set<string> | null {
  if (!selectedId || hopMode === 'all') return null

  const neighbors1 = new Set<string>()
  for (const e of edges) {
    if (e.source === selectedId) neighbors1.add(e.target)
    if (e.target === selectedId) neighbors1.add(e.source)
  }

  if (hopMode === '1') {
    const s = new Set(neighbors1)
    s.add(selectedId)
    return s
  }

  // 2-hop
  const neighbors2 = new Set(neighbors1)
  for (const e of edges) {
    if (neighbors1.has(e.source)) neighbors2.add(e.target)
    if (neighbors1.has(e.target)) neighbors2.add(e.source)
  }
  neighbors2.add(selectedId)
  return neighbors2
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

type TooltipState = {
  nodeId: string
  title: string
  type?: string
  degree: number
  x: number
  y: number
} | null

// ── SVG Graph ─────────────────────────────────────────────────────────────────

type SvgGraphProps = {
  graph: KnowledgeGraph
  selectedId: string | null
  onSelect: (id: string) => void
  categoryFilter: { category: string; mode: CategoryFilterMode } | null
  hopMode: HopMode
}

function SvgGraph({ graph, selectedId, onSelect, categoryFilter, hopMode }: SvgGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<Array<SimNode>>([])
  const [size, setSize] = useState({ width: 800, height: 500 })
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      const nextW = Math.max(Math.round(rect.width), 1)
      const nextH = Math.max(Math.round(rect.height), 1)
      setSize((prev) =>
        prev.width === nextW && prev.height === nextH
          ? prev
          : { width: nextW, height: nextH },
      )
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const { width, height } = size
    if (width <= 1 || height <= 1) return
    const initial = initNodes(graph.nodes, width, height)
    const laid = runLayout(initial, graph.edges, width, height)
    setNodes(recenterGraph(laid, width, height))
  }, [graph, size])

  // Cancel pending tooltip timer on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    }
  }, [])

  // Reset zoom/pan when graph data changes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [graph])

  // Wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom((prev) => {
        const next = Math.min(4, Math.max(0.3, prev * step))
        // Zoom around cursor position
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        setPan((p) => ({
          x: mx - (mx - p.x) * (next / prev),
          y: my - (my - p.y) * (next / prev),
        }))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Drag to pan (mousedown on SVG canvas, not on nodes)
  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Only primary button, only on the SVG background (target is svg or the transform group)
    if (e.button !== 0) return
    const target = e.target as Element
    // If the click is directly on a node group or its children, skip
    if (target.closest('[data-node]')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false }
    e.currentTarget.style.cursor = 'grabbing'
  }, [pan])

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    drag.moved = true
    setPan({ x: drag.panX + dx, y: drag.panY + dy })
  }, [])

  const handleSvgMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      e.currentTarget.style.cursor = ''
      dragRef.current = null
    }
  }, [])

  const handleSvgMouseLeave = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      e.currentTarget.style.cursor = ''
      dragRef.current = null
    }
  }, [])

  // Escape to dismiss tooltip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTooltip(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const idxById = new Map(nodes.map((n, i) => [n.id, i]))
  const degrees = computeDegrees(nodes, graph.edges)
  const degThreshold = computeHighDegreeThreshold(degrees)
  const visibleIds = computeVisibleIds(selectedId, hopMode, graph.edges)

  const handleMouseEnter = useCallback(
    (n: SimNode, svgX: number, svgY: number) => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
      setHoveredId(n.id)
      const deg = degrees.get(n.id) ?? 0
      // Convert SVG coords (pre-transform) → container-relative screen coords
      // by applying the zoom/pan transform then scaling for viewBox→CSS pixels
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const scaleX = rect.width / size.width
      const scaleY = rect.height / size.height
      setTooltip({
        nodeId: n.id,
        title: n.title,
        type: n.type,
        degree: deg,
        x: (svgX * zoom + pan.x) * scaleX,
        y: (svgY * zoom + pan.y) * scaleY,
      })
    },
    [degrees, size, zoom, pan],
  )

  const handleMouseLeave = useCallback(() => {
    tooltipTimerRef.current = setTimeout(() => {
      setTooltip(null)
      setHoveredId(null)
    }, 80)
  }, [])

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(4, z * 1.15))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.3, z / 1.15))
  }, [])

  const handleZoomReset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  return (
    <div ref={containerRef} className="graph-svg" aria-label="Knowledge graph" style={{ position: 'relative' }}>
      {/* Zoom controls */}
      <div className="graph-zoom-controls">
        <button type="button" className="mem-btn graph-controls-btn graph-zoom-btn" title="Zoom in" onClick={handleZoomIn}>
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 3v8M3 7h8" strokeLinecap="round"/>
          </svg>
        </button>
        <button type="button" className="mem-btn graph-controls-btn graph-zoom-btn" title="Zoom out" onClick={handleZoomOut}>
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7h8" strokeLinecap="round"/>
          </svg>
        </button>
        <button type="button" className="mem-btn graph-controls-btn graph-zoom-btn" title="Reset view" onClick={handleZoomReset}>
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4"/><circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/>
          </svg>
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <GraphTooltip
          tooltip={tooltip}
          containerWidth={size.width}
          containerHeight={size.height}
          onMouseEnter={() => { if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current) }}
          onMouseLeave={handleMouseLeave}
        />
      )}

      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        style={{ cursor: 'grab' }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={handleSvgMouseLeave}
      >
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <path d="M0 0L6 3L0 6" fill="none" stroke="rgba(0,255,65,0.4)" strokeWidth="1"/>
        </marker>
      </defs>

      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

      {/* Edges */}
      {graph.edges.map((edge, i) => {
        const si = idxById.get(edge.source)
        const ti = idxById.get(edge.target)
        if (si == null || ti == null) return null
        const s = nodes[si]
        const t = nodes[ti]

        // Category filter
        if (categoryFilter?.mode === 'mute') {
          const cat = categoryFilter.category
          if (s.type?.toLowerCase() === cat || t.type?.toLowerCase() === cat) return null
        }
        if (categoryFilter?.mode === 'isolate') {
          const cat = categoryFilter.category
          if (s.type?.toLowerCase() !== cat && t.type?.toLowerCase() !== cat) return null
        }

        // Hop filter
        if (visibleIds && !visibleIds.has(edge.source) && !visibleIds.has(edge.target)) return null

        const isHighlighted =
          selectedId === edge.source || selectedId === edge.target
        return (
          <line
            key={i}
            x1={s.x}
            y1={s.y}
            x2={t.x}
            y2={t.y}
            stroke={isHighlighted ? 'rgba(0,255,65,0.6)' : 'rgba(0,255,65,0.15)'}
            strokeWidth={isHighlighted ? 1.5 : 0.8}
            markerEnd="url(#arrow)"
          />
        )
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isSelected = n.id === selectedId
        const isHovered = n.id === hoveredId
        const color = nodeColor(n.type)
        const deg = degrees.get(n.id) ?? 0
        const isConnected =
          selectedId != null &&
          graph.edges.some((e) => (e.source === selectedId && e.target === n.id) || (e.target === selectedId && e.source === n.id))
        const dimmed = selectedId != null && !isSelected && !isConnected

        // Category filter
        const nodeCategory = n.type?.toLowerCase() ?? ''
        if (categoryFilter?.mode === 'mute' && nodeCategory === categoryFilter.category) return null
        if (categoryFilter?.mode === 'isolate' && nodeCategory !== categoryFilter.category) {
          // render dimmed version
          return (
            <g
              key={n.id}
              data-node="1"
              transform={`translate(${n.x},${n.y})`}
              style={{ cursor: 'pointer', opacity: 0.08 }}
              onClick={() => onSelect(n.id)}
            >
              <circle r={n.r} fill="rgba(0,12,4,0.9)" stroke={color} strokeWidth={1.5} />
            </g>
          )
        }

        // Hop visibility
        if (visibleIds && !visibleIds.has(n.id)) {
          return (
            <g
              key={n.id}
              data-node="1"
              transform={`translate(${n.x},${n.y})`}
              style={{ cursor: 'pointer', opacity: 0.08 }}
              onClick={() => onSelect(n.id)}
            >
              <circle r={n.r} fill="rgba(0,12,4,0.9)" stroke={color} strokeWidth={1.5} />
            </g>
          )
        }

        // Progressive label: show if selected, hovered, or high-degree
        const showLabel = isSelected || isHovered || deg >= degThreshold

        return (
          <g
            key={n.id}
            data-node="1"
            transform={`translate(${n.x},${n.y})`}
            style={{ cursor: 'pointer', opacity: dimmed ? 0.3 : 1 }}
            onClick={(e) => { if (dragRef.current?.moved) { e.stopPropagation(); return; } onSelect(n.id) }}
            onMouseEnter={() => handleMouseEnter(n, n.x, n.y)}
            onMouseLeave={handleMouseLeave}
            role="button"
            aria-label={n.title}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(n.id) }}
            onFocus={() => handleMouseEnter(n, n.x, n.y)}
            onBlur={handleMouseLeave}
          >
            {isSelected && (
              <>
                <circle r={n.r + 10} fill="none" stroke="#ffb454" strokeWidth={2} opacity={0.35} />
                <circle r={n.r + 5} fill="none" stroke="#ffb454" strokeWidth={1.5} opacity={0.7} />
              </>
            )}
            {isHovered && !isSelected && (
              <circle r={n.r + 6} fill="none" stroke={color} strokeWidth={1} opacity={0.4} />
            )}
            <circle
              r={n.r}
              fill={isSelected ? '#ffb454' : 'rgba(0,12,4,0.9)'}
              stroke={isSelected ? '#ffb454' : color}
              strokeWidth={isSelected ? 0 : 1.5}
              style={isSelected ? { filter: 'drop-shadow(0 0 8px #ffb454)' } : undefined}
            />
            {showLabel && (
              <text
                textAnchor="middle"
                dy={n.r + 13}
                fontSize={isSelected ? 12 : 10}
                fontWeight={isSelected ? 700 : 400}
                fill={isSelected ? '#ffd58c' : isHovered ? color : 'rgba(0,255,65,0.7)'}
                fontFamily="ui-monospace, monospace"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {n.title.length > 18 ? `${n.title.slice(0, 16)}…` : n.title}
              </text>
            )}
          </g>
        )
      })}
      </g>
      </svg>
    </div>
  )
}

// ── Tooltip component ─────────────────────────────────────────────────────────

type GraphTooltipProps = {
  tooltip: NonNullable<TooltipState>
  containerWidth: number
  containerHeight: number
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function GraphTooltip({ tooltip, containerWidth, containerHeight, onMouseEnter, onMouseLeave }: GraphTooltipProps) {
  const tipW = 200
  const tipH = 76
  const offset = 14

  let left = tooltip.x + offset
  let top = tooltip.y - tipH / 2

  // Clamp to container
  if (left + tipW > containerWidth - 8) left = tooltip.x - tipW - offset
  if (top < 8) top = 8
  if (top + tipH > containerHeight - 8) top = containerHeight - tipH - 8

  return (
    <div
      className="graph-tooltip"
      style={{ left, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="graph-tooltip-title">{tooltip.title}</div>
      <div className="graph-tooltip-row">
        {tooltip.type && (
          <span
            className="graph-tooltip-chip"
            style={{ borderColor: nodeColor(tooltip.type), color: nodeColor(tooltip.type) }}
          >
            {tooltip.type.toUpperCase()}
          </span>
        )}
        <span className="graph-tooltip-degree">{tooltip.degree} link{tooltip.degree !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

// ── Fallback list view ────────────────────────────────────────────────────────

type SvgGraphBaseProps = {
  graph: KnowledgeGraph
  selectedId: string | null
  onSelect: (id: string) => void
}

function FallbackList({ graph, selectedId, onSelect }: SvgGraphBaseProps) {
  return (
    <div className="graph-fallback">
      <div className="graph-fallback-nodes">
        <div className="graph-fallback-header">Nodes ({graph.nodes.length})</div>
        {graph.nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`graph-fallback-node ${n.id === selectedId ? 'is-active' : ''}`}
            onClick={() => onSelect(n.id)}
          >
            <span
              className="graph-fallback-dot"
              style={{ background: nodeColor(n.type) }}
            />
            <span>{n.title}</span>
            <span className="graph-fallback-path">{n.id}</span>
          </button>
        ))}
      </div>
      <div className="graph-fallback-edges">
        <div className="graph-fallback-header">Edges ({graph.edges.length})</div>
        {graph.edges
          .filter((e) => !selectedId || e.source === selectedId || e.target === selectedId)
          .map((e, i) => (
            <div key={i} className="graph-fallback-edge">
              {e.source} <span className="graph-fallback-arrow">→</span> {e.target}
            </div>
          ))}
      </div>
    </div>
  )
}

// ── Interactive Legend ────────────────────────────────────────────────────────

type LegendProps = {
  categoryFilter: { category: string; mode: CategoryFilterMode } | null
  onSetFilter: (f: { category: string; mode: CategoryFilterMode } | null) => void
}

function GraphLegend({ categoryFilter, onSetFilter }: LegendProps) {
  const handleClick = (kind: string, e: React.MouseEvent) => {
    const isShift = e.shiftKey
    const mode: CategoryFilterMode = isShift ? 'mute' : 'isolate'

    if (categoryFilter?.category === kind && categoryFilter.mode === mode) {
      onSetFilter(null) // toggle off
    } else {
      onSetFilter({ category: kind, mode })
    }
  }

  return (
    <div className="graph-legend">
      {Object.entries(TYPE_COLORS).map(([kind, color]) => {
        const isIsolated = categoryFilter?.category === kind && categoryFilter.mode === 'isolate'
        const isMuted = categoryFilter?.category === kind && categoryFilter.mode === 'mute'
        return (
          <button
            key={kind}
            type="button"
            className={`graph-legend-row ${isIsolated ? 'is-isolated' : ''} ${isMuted ? 'is-muted' : ''}`}
            title={`Click to isolate · Shift+click to mute`}
            onClick={(e) => handleClick(kind, e)}
          >
            <span
              className="graph-legend-pip"
              style={
                isIsolated
                  ? { background: color, boxShadow: `0 0 6px ${color}` }
                  : { background: 'transparent', borderColor: color }
              }
            />
            <span className="graph-legend-label">{kind}</span>
            {isMuted && <span className="graph-legend-badge">muted</span>}
          </button>
        )
      })}
      {categoryFilter && (
        <button
          type="button"
          className="graph-legend-reset"
          onClick={() => onSetFilter(null)}
        >
          reset
        </button>
      )}
    </div>
  )
}

// ── GraphTab ──────────────────────────────────────────────────────────────────

export function GraphTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [useFallback, setUseFallback] = useState(false)

  const { graphCategoryFilter, setGraphCategoryFilter, hopMode, setHopMode } = useGraphStore()

  const graphQuery = useQuery<KnowledgeGraph>({
    queryKey: ['knowledge', 'graph'],
    queryFn: fetchGraph,
    staleTime: 60_000,
  })

  const graph = graphQuery.data ?? { nodes: [], edges: [] }
  const selectedNode = graph.nodes.find((n) => n.id === selectedId) ?? null

  // Build neighbor info for detail panel
  const connectedEdges = graph.edges.filter(
    (e) => e.source === selectedId || e.target === selectedId,
  )
  const neighborIds = connectedEdges.map((e) =>
    e.source === selectedId ? e.target : e.source,
  )
  const neighborNodes = neighborIds.map((nid) => graph.nodes.find((n) => n.id === nid)).filter(Boolean) as KnowledgeGraph['nodes']

  return (
    <div className="graph-wrap">
      {graphQuery.isLoading && <div className="mem-loading">Building graph…</div>}
      {graphQuery.isError && (
        <div className="mem-loading" style={{ color: 'var(--m-red, #ff4444)' }}>
          Failed to load graph
        </div>
      )}

      {!graphQuery.isLoading && !graphQuery.isError && graph.nodes.length === 0 && (
        <div className="mem-loading">No wiki pages found — graph is empty</div>
      )}

      {/* Hop toggle — shown when a node is selected and using SVG view */}
      {graph.nodes.length > 0 && !useFallback && selectedId && (
        <div className="graph-hop-toggle">
          <span className="graph-hop-label">Show:</span>
          {(['1', '2', 'all'] as HopMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`graph-hop-btn ${hopMode === m ? 'is-active' : ''}`}
              onClick={() => setHopMode(m)}
            >
              {m === '1' ? '1-hop' : m === '2' ? '2-hop' : 'all'}
            </button>
          ))}
        </div>
      )}

      {graph.nodes.length > 0 && !useFallback && (
        <SvgGraph
          graph={graph}
          selectedId={selectedId}
          onSelect={setSelectedId}
          categoryFilter={graphCategoryFilter}
          hopMode={hopMode}
        />
      )}
      {graph.nodes.length > 0 && useFallback && (
        <FallbackList graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {/* Interactive Legend */}
      {graph.nodes.length > 0 && (
        <GraphLegend
          categoryFilter={graphCategoryFilter}
          onSetFilter={setGraphCategoryFilter}
        />
      )}

      {/* Controls */}
      <div className="graph-controls">
        <button
          type="button"
          className="mem-btn graph-controls-btn"
          title={useFallback ? 'Switch to graph view' : 'Switch to list view'}
          onClick={() => setUseFallback((v) => !v)}
        >
          {useFallback ? (
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="4" cy="4" r="2"/><circle cx="12" cy="4" r="2"/>
              <circle cx="8" cy="12" r="2"/>
              <path d="M6 4h4M5.4 5.6L8 10.2M10.6 5.6L8 10.2" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round"/>
            </svg>
          )}
        </button>
        {selectedId && (
          <button
            type="button"
            className="mem-btn graph-controls-btn"
            title="Clear selection"
            onClick={() => { setSelectedId(null); setHopMode('all') }}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <div className="graph-detail">
          <div className="graph-detail-title">{selectedNode.title}</div>
          <div className="graph-detail-path">{selectedNode.id}</div>
          {selectedNode.type && (
            <div className="graph-detail-meta">
              <span className="graph-detail-dot" style={{ background: nodeColor(selectedNode.type) }} />
              {selectedNode.type}
            </div>
          )}
          {selectedNode.tags.length > 0 && (
            <div className="graph-detail-tags">
              {selectedNode.tags.map((tag) => (
                <span key={tag} className="graph-detail-tag">{tag}</span>
              ))}
            </div>
          )}
          {neighborNodes.length > 0 && (
            <div className="graph-detail-edges">
              <div className="graph-detail-edges-label">Links ({neighborNodes.length})</div>
              {connectedEdges.map((e, i) => {
                const neighborId = e.source === selectedId ? e.target : e.source
                const neighbor = graph.nodes.find((n) => n.id === neighborId)
                const dir = e.source === selectedId ? '→' : '←'
                return (
                  <button
                    key={i}
                    type="button"
                    className="graph-detail-neighbor-btn"
                    onClick={() => setSelectedId(neighborId)}
                    title={neighborId}
                  >
                    <span
                      className="graph-detail-neighbor-dot"
                      style={{ background: nodeColor(neighbor?.type) }}
                    />
                    <span className="graph-detail-arrow">{dir}</span>
                    <span className="graph-detail-neighbor-name">
                      {neighbor?.title ?? neighborId}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
