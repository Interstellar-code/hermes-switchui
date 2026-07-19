/**
 * MemoryMap — D3 force-directed Memory Map tab (issue #342).
 *
 * Replaces the old hand-rolled spring-layout Graph tab. Fetches the
 * deduplicated graph from GET /api/memory/graph and renders it with a
 * d3-force simulation. Rendering is D3-owned (per-tick position updates are
 * imperative via d3-selection) so ~1,876 nodes never trigger a React re-render
 * per frame. React only owns the SVG shell and the overlay controls.
 *
 * Data DTOs from the API are cloned before the simulation touches them, since
 * d3-force / d3-link mutate node & link objects in place.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { drag as d3drag } from 'd3-drag'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import type { Selection } from 'd3-selection'
import type {
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force'
import type { ZoomBehavior } from 'd3-zoom'
import '@/styles/matrix-memory-map.css'

// ── API types (mirror src/server/memory-graph.ts response) ──────────────────

type Kind = 'gist' | 'fact' | 'wiki'
type EdgeType = 'ctx' | 'references'

type GraphNode = { id: string; kind: Kind; label: string }
type GraphEdge = {
  source: string
  target: string
  edgeType: EdgeType
  weight: number
  occurrences: number
  timestamp: string | null
}
type GraphMeta = {
  rawEdgeCount: number
  edgeCount: number
  nodeCount: number
  truncated: boolean
  dbMissing: boolean
  generatedAt: string
}
type GraphResponse = { nodes: Array<GraphNode>; edges: Array<GraphEdge>; meta: GraphMeta }

type SimNode = GraphNode & SimulationNodeDatum
type SimEdge = Omit<GraphEdge, 'source' | 'target'> &
  SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode }

// ── constants ───────────────────────────────────────────────────────────────

const KIND_COLOR: Record<Kind, string> = {
  gist: '#00ff41', // matrix green
  fact: '#5fcfff', // cyan
  wiki: '#ffb347', // amber
}
const EDGE_COLOR: Record<EdgeType, string> = {
  ctx: 'rgba(0, 255, 65, 0.28)',
  references: 'rgba(255, 179, 71, 0.34)',
}
const NODE_R: Record<Kind, number> = { gist: 5, fact: 5, wiki: 7 }
const CHARGE: Record<Kind, number> = { gist: -34, fact: -34, wiki: -140 }
const LINK_DISTANCE: Record<EdgeType, number> = { ctx: 45, references: 90 }

async function fetchGraph(): Promise<GraphResponse> {
  const res = await fetch('/api/memory/graph', { credentials: 'same-origin' })
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<GraphResponse>
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// ── component ────────────────────────────────────────────────────────────────

export function MemoryMap() {
  const query = useQuery<GraphResponse>({
    queryKey: ['memory', 'map', 'graph'],
    queryFn: fetchGraph,
    staleTime: 60_000,
  })

  if (query.isLoading) {
    return <div className="mm-state" role="status">Loading memory map…</div>
  }
  if (query.isError) {
    return (
      <div className="mm-state mm-state-error" role="alert">
        Failed to load memory map:{' '}
        {query.error instanceof Error ? query.error.message : 'unknown error'}
      </div>
    )
  }

  const data = query.data
  if (!data || data.nodes.length === 0) {
    return (
      <div className="mm-state" role="status">
        {data?.meta.dbMissing
          ? 'No memory database found for this profile yet.'
          : 'No memory graph data to display.'}
      </div>
    )
  }

  return <MemoryMapCanvas data={data} />
}

// Split so the simulation effect only mounts once real data exists.
function MemoryMapCanvas({ data }: { data: GraphResponse }) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // interaction state (drives the detail panel + highlight, not per-tick)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [hovered, setHovered] = useState<GraphNode | null>(null)
  const [search, setSearch] = useState('')
  const [showCtx, setShowCtx] = useState(true)
  const [showRefs, setShowRefs] = useState(true)

  // handles kept across effects for imperative highlight + cleanup
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodeSelRef = useRef<Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null)
  const linkSelRef = useRef<Selection<SVGLineElement, SimEdge, SVGGElement, unknown> | null>(null)

  const counts = useMemo(() => {
    const byKind: Record<Kind, number> = { gist: 0, fact: 0, wiki: 0 }
    for (const n of data.nodes) byKind[n.kind]++
    return byKind
  }, [data])

  // ── build simulation + D3-owned rendering (runs when data changes) ─────────
  useEffect(() => {
    const svgEl = svgRef.current
    const wrapEl = wrapRef.current
    if (!svgEl || !wrapEl) return

    const reduced = prefersReducedMotion()

    // clone DTOs — d3-force mutates node/link objects in place.
    const nodes: Array<SimNode> = data.nodes.map((n) => ({ ...n }))
    const edges: Array<SimEdge> = data.edges.map((e) => ({ ...e }))

    let width = wrapEl.clientWidth || 800
    let height = wrapEl.clientHeight || 600

    const svg = select(svgEl)
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    const viewport = svg.select<SVGGElement>('g.mm-viewport')
    const linkG = viewport.select<SVGGElement>('g.mm-links')
    const nodeG = viewport.select<SVGGElement>('g.mm-nodes')

    // links
    const linkSel = linkG
      .selectAll<SVGLineElement, SimEdge>('line')
      .data(edges)
      .join('line')
      .attr('class', (d) => `mm-link mm-link-${d.edgeType}`)
      .attr('stroke', (d) => EDGE_COLOR[d.edgeType])
      .attr('stroke-width', (d) => Math.min(3, 0.6 + d.occurrences * 0.25))
    linkSelRef.current = linkSel

    // node groups: dot (gist/fact) or card (wiki) + label + native <title>
    const nodeSel = nodeG
      .selectAll<SVGGElement, SimNode>('g.mm-node')
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const g = enter
          .append('g')
          .attr('class', (d) => `mm-node mm-node-${d.kind}`)
          .attr('tabindex', -1)
        g.append('title').text((d) => `${d.kind}: ${d.label}`)
        // shape
        g.each(function (d) {
          const sel = select(this)
          if (d.kind === 'wiki') {
            sel
              .append('rect')
              .attr('class', 'mm-shape')
              .attr('x', -6)
              .attr('y', -6)
              .attr('width', 12)
              .attr('height', 12)
              .attr('rx', 2)
              .attr('fill', KIND_COLOR.wiki)
          } else {
            sel
              .append('circle')
              .attr('class', 'mm-shape')
              .attr('r', NODE_R[d.kind])
              .attr('fill', KIND_COLOR[d.kind])
          }
        })
        // label (hidden by default via CSS, shown for wiki/hover/selected)
        g.append('text')
          .attr('class', 'mm-label')
          .attr('x', 9)
          .attr('y', 3)
          .text((d) => d.label)
        return g
      })
    nodeSelRef.current = nodeSel

    // ── forces ────────────────────────────────────────────────────────────
    const sim = forceSimulation<SimNode, SimEdge>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance((d) => LINK_DISTANCE[d.edgeType])
          .strength(0.4),
      )
      .force('charge', forceManyBody<SimNode>().strength((d) => CHARGE[d.kind]))
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => NODE_R[d.kind] + 3),
      )
      .alphaDecay(0.02)
    simRef.current = sim

    function ticked() {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    }
    sim.on('tick', ticked)

    if (reduced) {
      // Static layout: settle synchronously, no continuous animation.
      sim.stop()
      sim.tick(180)
      ticked()
    }

    // ── drag-to-pin ─────────────────────────────────────────────────────────
    const dragBehavior = d3drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active && !reduced) sim.alphaTarget(0.2).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
        if (reduced) ticked()
      })
      .on('end', (event) => {
        if (!event.active) sim.alphaTarget(0)
        // node stays pinned (fx/fy retained) — double-click to release
      })
    nodeSel.call(dragBehavior)

    // ── hover / click ─────────────────────────────────────────────────────
    nodeSel
      .on('mouseenter', (_event, d) => setHovered(d))
      .on('mouseleave', () => setHovered(null))
      .on('click', (event, d) => {
        event.stopPropagation()
        setSelected((cur) => (cur?.id === d.id ? null : d))
      })
      .on('dblclick', (event, d) => {
        // release a pinned node
        event.stopPropagation()
        d.fx = null
        d.fy = null
        if (!reduced) sim.alphaTarget(0.1).restart()
      })
    svg.on('click', () => setSelected(null))

    // ── zoom / pan ──────────────────────────────────────────────────────────
    const zoomBehavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .on('zoom', (event) => {
        viewport.attr('transform', event.transform.toString())
      })
    zoomRef.current = zoomBehavior
    svg.call(zoomBehavior)

    // ── resize ────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      width = wrapEl.clientWidth || width
      height = wrapEl.clientHeight || height
      svg.attr('viewBox', `0 0 ${width} ${height}`)
      sim.force('center', forceCenter(width / 2, height / 2))
      if (!reduced) sim.alpha(0.3).restart()
    })
    ro.observe(wrapEl)

    // ── cleanup ─────────────────────────────────────────────────────────────
    return () => {
      sim.on('tick', null)
      sim.stop()
      ro.disconnect()
      svg.on('.zoom', null)
      svg.on('click', null)
      nodeSel.on('.drag', null)
      nodeSel.on('mouseenter', null).on('mouseleave', null).on('click', null).on('dblclick', null)
      linkG.selectAll('*').remove()
      nodeG.selectAll('*').remove()
      simRef.current = null
      zoomRef.current = null
      nodeSelRef.current = null
      linkSelRef.current = null
    }
  }, [data])

  // ── apply search / edge-toggle / highlight imperatively (no re-sim) ────────
  useEffect(() => {
    const nodeSel = nodeSelRef.current
    const linkSel = linkSelRef.current
    if (!nodeSel || !linkSel) return

    const q = search.trim().toLowerCase()
    const activeId = selected?.id ?? hovered?.id ?? null

    // neighbor set for focus dimming
    const neighbors = new Set<string>()
    if (activeId) {
      neighbors.add(activeId)
      for (const e of linkSel.data()) {
        const s = typeof e.source === 'string' ? e.source : e.source.id
        const t = typeof e.target === 'string' ? e.target : e.target.id
        if (s === activeId) neighbors.add(t)
        if (t === activeId) neighbors.add(s)
      }
    }

    function edgeVisible(et: EdgeType): boolean {
      return et === 'ctx' ? showCtx : showRefs
    }

    nodeSel
      .classed('mm-match', (d) => q.length > 0 && d.label.toLowerCase().includes(q))
      .classed('mm-dim', (d) => {
        if (q.length > 0) return !d.label.toLowerCase().includes(q)
        if (activeId) return !neighbors.has(d.id)
        return false
      })
      .classed('mm-selected', (d) => d.id === selected?.id)
      .classed('mm-show-label', (d) => d.kind === 'wiki' || d.id === activeId || d.id === selected?.id)

    linkSel
      .classed('mm-hidden', (d) => !edgeVisible(d.edgeType))
      .classed('mm-dim', (d) => {
        if (!activeId) return false
        const s = typeof d.source === 'string' ? d.source : d.source.id
        const t = typeof d.target === 'string' ? d.target : d.target.id
        return s !== activeId && t !== activeId
      })
  }, [search, selected, hovered, showCtx, showRefs, data])

  function zoomBy(factor: number) {
    const svgEl = svgRef.current
    const zb = zoomRef.current
    if (svgEl && zb) select(svgEl).transition().duration(200).call(zb.scaleBy, factor)
  }
  function zoomReset() {
    const svgEl = svgRef.current
    const zb = zoomRef.current
    if (svgEl && zb) select(svgEl).transition().duration(200).call(zb.transform, zoomIdentity)
  }

  return (
    <div className="mm-wrap" ref={wrapRef}>
      {/* controls */}
      <div className="mm-controls">
        <input
          type="search"
          className="mm-search"
          placeholder="Search nodes…"
          value={search}
          aria-label="Search memory map nodes by label"
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mm-toggles" role="group" aria-label="Edge type filters">
          <button
            type="button"
            className={`mm-toggle ${showCtx ? 'is-on' : ''}`}
            aria-pressed={showCtx}
            onClick={() => setShowCtx((v) => !v)}
          >
            <span className="mm-swatch" style={{ background: KIND_COLOR.gist }} aria-hidden />
            ctx
          </button>
          <button
            type="button"
            className={`mm-toggle ${showRefs ? 'is-on' : ''}`}
            aria-pressed={showRefs}
            onClick={() => setShowRefs((v) => !v)}
          >
            <span className="mm-swatch" style={{ background: KIND_COLOR.wiki }} aria-hidden />
            references
          </button>
        </div>
        <div className="mm-zoom" role="group" aria-label="Zoom controls">
          <button type="button" className="mm-zoom-btn" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
            +
          </button>
          <button type="button" className="mm-zoom-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
            −
          </button>
          <button type="button" className="mm-zoom-btn" aria-label="Reset zoom" onClick={zoomReset}>
            ⟲
          </button>
        </div>
      </div>

      {/* legend (non-color-only: shape + name) */}
      <div className="mm-legend" aria-hidden>
        <span className="mm-legend-item"><span className="mm-legend-dot" style={{ background: KIND_COLOR.gist }} />gist ({counts.gist})</span>
        <span className="mm-legend-item"><span className="mm-legend-dot" style={{ background: KIND_COLOR.fact }} />fact ({counts.fact})</span>
        <span className="mm-legend-item"><span className="mm-legend-square" style={{ background: KIND_COLOR.wiki }} />wiki ({counts.wiki})</span>
      </div>

      <svg ref={svgRef} className="mm-svg" role="img" aria-label={`Memory map: ${data.meta.nodeCount} nodes, ${data.meta.edgeCount} edges`}>
        <g className="mm-viewport">
          <g className="mm-links" />
          <g className="mm-nodes" />
        </g>
      </svg>

      {/* detail panel */}
      {selected && (
        <div className="mm-detail" role="region" aria-label="Selected node detail">
          <div className={`mm-detail-kind mm-detail-kind-${selected.kind}`}>{selected.kind}</div>
          <div className="mm-detail-label">{selected.label}</div>
          <button type="button" className="mm-detail-close" onClick={() => setSelected(null)} aria-label="Close detail">
            Close
          </button>
        </div>
      )}

      {data.meta.truncated && (
        <div className="mm-truncated" role="note">
          Showing {data.meta.edgeCount} of {data.meta.rawEdgeCount} edges (truncated).
        </div>
      )}
    </div>
  )
}
