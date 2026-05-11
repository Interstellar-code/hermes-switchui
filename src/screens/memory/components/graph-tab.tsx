/**
 * GraphTab — Graph tab body for the Memory screen (MEM-06).
 *
 * No heavy graph lib in deps — renders an SVG adjacency graph using a
 * simple spring-layout simulation (requestAnimationFrame, 60 ticks).
 * Falls back to a node/edge list if the graph endpoint returns no data.
 *
 * Data source: GET /api/knowledge/graph → { nodes, edges }
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
): SimNode[] {
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
  nodes: SimNode[],
  edges: KnowledgeGraph['edges'],
  width: number,
  height: number,
  ticks = 80,
): SimNode[] {
  const idxById = new Map(nodes.map((n, i) => [n.id, i]))
  const sim = nodes.map((n) => ({ ...n }))

  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks

    // repulsion
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]!
        const b = sim[j]!
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
      const a = sim[si]!
      const b = sim[ti]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - 120) * 0.04 * alpha
      a.vx += (dx / dist) * force
      a.vy += (dy / dist) * force
      b.vx -= (dx / dist) * force
      b.vy -= (dy / dist) * force
    }

    // gravity to centre
    for (const n of sim) {
      n.vx += (width / 2 - n.x) * 0.01 * alpha
      n.vy += (height / 2 - n.y) * 0.01 * alpha
    }

    // integrate
    for (const n of sim) {
      n.vx *= 0.85
      n.vy *= 0.85
      n.x += n.vx
      n.y += n.vy
      n.x = Math.max(n.r + 8, Math.min(width - n.r - 8, n.x))
      n.y = Math.max(n.r + 8, Math.min(height - n.r - 8, n.y))
    }
  }
  return sim
}

// ── SVG Graph ─────────────────────────────────────────────────────────────────

type SvgGraphProps = {
  graph: KnowledgeGraph
  selectedId: string | null
  onSelect: (id: string) => void
}

function SvgGraph({ graph, selectedId, onSelect }: SvgGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<SimNode[]>([])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const w = width || 800
    const h = height || 500
    const initial = initNodes(graph.nodes, w, h)
    const laid = runLayout(initial, graph.edges, w, h)
    setNodes(laid)
  }, [graph])

  const idxById = new Map(nodes.map((n, i) => [n.id, i]))

  return (
    <svg ref={svgRef} className="graph-svg" aria-label="Knowledge graph">
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <path d="M0 0L6 3L0 6" fill="none" stroke="rgba(0,255,65,0.4)" strokeWidth="1"/>
        </marker>
      </defs>

      {/* Edges */}
      {graph.edges.map((edge, i) => {
        const si = idxById.get(edge.source)
        const ti = idxById.get(edge.target)
        if (si == null || ti == null) return null
        const s = nodes[si]!
        const t = nodes[ti]!
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
        const color = nodeColor(n.type)
        const isConnected =
          selectedId != null &&
          graph.edges.some((e) => e.source === selectedId && e.target === n.id || e.target === selectedId && e.source === n.id)
        const dimmed = selectedId != null && !isSelected && !isConnected

        return (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            style={{ cursor: 'pointer', opacity: dimmed ? 0.3 : 1 }}
            onClick={() => onSelect(n.id)}
            role="button"
            aria-label={n.title}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(n.id) }}
          >
            {isSelected && (
              <circle r={n.r + 5} fill="none" stroke={color} strokeWidth={1.5} opacity={0.4} />
            )}
            <circle
              r={n.r}
              fill={isSelected ? color : 'rgba(0,12,4,0.9)'}
              stroke={color}
              strokeWidth={isSelected ? 0 : 1.5}
            />
            <text
              textAnchor="middle"
              dy={n.r + 13}
              fontSize={10}
              fill={isSelected ? color : 'rgba(0,255,65,0.7)'}
              fontFamily="ui-monospace, monospace"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {n.title.length > 18 ? `${n.title.slice(0, 16)}…` : n.title}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Fallback list view ────────────────────────────────────────────────────────

function FallbackList({ graph, selectedId, onSelect }: SvgGraphProps) {
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

// ── GraphTab ──────────────────────────────────────────────────────────────────

export function GraphTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [useFallback, setUseFallback] = useState(false)

  const graphQuery = useQuery<KnowledgeGraph>({
    queryKey: ['knowledge', 'graph'],
    queryFn: fetchGraph,
    staleTime: 60_000,
  })

  const graph = graphQuery.data ?? { nodes: [], edges: [] }
  const selectedNode = graph.nodes.find((n) => n.id === selectedId) ?? null
  const connectedEdges = graph.edges.filter(
    (e) => e.source === selectedId || e.target === selectedId,
  )

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

      {graph.nodes.length > 0 && !useFallback && (
        <SvgGraph graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
      )}
      {graph.nodes.length > 0 && useFallback && (
        <FallbackList graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {/* Legend */}
      {graph.nodes.length > 0 && (
        <div className="graph-legend">
          {Object.entries(TYPE_COLORS).map(([kind, color]) => (
            <div key={kind} className="row">
              <span className="d" style={{ background: color }} />
              {kind}
            </div>
          ))}
        </div>
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
            onClick={() => setSelectedId(null)}
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
          {connectedEdges.length > 0 && (
            <div className="graph-detail-edges">
              <div className="graph-detail-edges-label">Links ({connectedEdges.length})</div>
              {connectedEdges.map((e, i) => (
                <div key={i} className="graph-detail-edge">
                  {e.source === selectedId ? (
                    <><span className="graph-detail-arrow">→</span> {e.target}</>
                  ) : (
                    <><span className="graph-detail-arrow">←</span> {e.source}</>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
