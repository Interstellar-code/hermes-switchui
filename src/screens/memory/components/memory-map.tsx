/**
 * MemoryMap — D3 force-directed Memory Map tab (issue #342).
 *
 * Renders the full mnemosyne graph (GET /api/memory/graph): gist / working /
 * fact / entity / episodic / wiki nodes tied together by ctx / references /
 * mentions / about / relates / summarizes edges (~7k nodes / ~13k edges).
 *
 * At this scale SVG DOM is not viable, so rendering is on a <canvas>:
 * d3-force drives the layout, we draw per tick, d3-zoom handles pan/zoom, and
 * node dragging + hover use simulation.find() for hit-testing. d3-zoom's
 * .filter defers to node-drag when the pointer is over a node.
 *
 * API DTOs are cloned before the sim mutates them (d3-force/link mutate in
 * place). Full unmount cleanup stops the sim, cancels rAF, detaches
 * zoom/drag/pointer listeners and the ResizeObserver.
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
  forceX,
  forceY,
} from 'd3-force'
import { pointer, select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { ZoomTransform } from 'd3-zoom'
import '@/styles/matrix-memory-map.css'

// ── API types (mirror src/server/memory-graph.ts) ───────────────────────────

type Kind = 'gist' | 'fact' | 'wiki' | 'entity' | 'working' | 'episodic'
type EdgeType = 'ctx' | 'references' | 'mentions' | 'about' | 'relates' | 'summarizes'

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

type SimNode = GraphNode & SimulationNodeDatum & { deg: number }
type SimEdge = Omit<GraphEdge, 'source' | 'target'> &
  SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode }

// ── palette / geometry ──────────────────────────────────────────────────────

const KIND_COLOR: Record<Kind, string> = {
  gist: '#00ff41',
  working: '#7dffa8',
  fact: '#5fcfff',
  entity: '#ffb347',
  episodic: '#c792ea',
  wiki: '#ff6b9d',
}
const KIND_LABEL: Record<Kind, string> = {
  gist: 'gist',
  working: 'working',
  fact: 'fact',
  entity: 'entity',
  episodic: 'episodic',
  wiki: 'wiki',
}
const BASE_R: Record<Kind, number> = {
  gist: 2.6,
  working: 2.6,
  fact: 2.6,
  entity: 3,
  episodic: 3.4,
  wiki: 4,
}
const EDGE_COLOR: Record<EdgeType, string> = {
  ctx: 'rgba(0,255,65,0.30)',
  references: 'rgba(255,107,157,0.45)',
  mentions: 'rgba(255,179,71,0.12)',
  about: 'rgba(95,207,255,0.22)',
  relates: 'rgba(199,146,234,0.55)',
  summarizes: 'rgba(125,255,168,0.30)',
}
const EDGE_ORDER: ReadonlyArray<EdgeType> = [
  'mentions',
  'about',
  'ctx',
  'summarizes',
  'references',
  'relates',
]
const KIND_ORDER: ReadonlyArray<Kind> = [
  'gist',
  'working',
  'fact',
  'entity',
  'episodic',
  'wiki',
]

function nodeRadius(n: SimNode): number {
  // entity hubs grow with degree so the connectors stand out
  const boost = n.kind === 'entity' ? Math.min(6, Math.sqrt(n.deg)) : 0
  return BASE_R[n.kind] + boost
}

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

function MemoryMapCanvas({ data }: { data: GraphResponse }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [hovered, setHovered] = useState<GraphNode | null>(null)
  const [search, setSearch] = useState('')
  const [visibleTypes, setVisibleTypes] = useState<Record<EdgeType, boolean>>({
    ctx: true,
    references: true,
    mentions: true,
    about: true,
    relates: true,
    summarizes: true,
  })
  const [visibleKinds, setVisibleKinds] = useState<Record<Kind, boolean>>({
    gist: true,
    working: true,
    fact: true,
    entity: true,
    episodic: true,
    wiki: true,
  })
  const [hideIsolated, setHideIsolated] = useState(false)
  const [minConnections, setMinConnections] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null)
  const zoomResetRef = useRef<(() => void) | null>(null)
  const zoomByRef = useRef<((k: number) => void) | null>(null)
  const redrawRef = useRef<(() => void) | null>(null)

  // live refs so interaction state reaches the (data-scoped) draw loop
  // without rebuilding the simulation.
  const stateRef = useRef({
    selected,
    hovered,
    search,
    visibleTypes,
    visibleKinds,
    hideIsolated,
    minConnections,
  })
  stateRef.current = {
    selected,
    hovered,
    search,
    visibleTypes,
    visibleKinds,
    hideIsolated,
    minConnections,
  }

  const counts = useMemo(() => {
    const byKind: Partial<Record<Kind, number>> = {}
    for (const n of data.nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1
    return byKind
  }, [data])

  // Slider ceiling = highest node degree (capped so the control stays usable).
  const maxConn = useMemo(() => {
    const deg = new Map<string, number>()
    for (const e of data.edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
    }
    let m = 0
    for (const v of deg.values()) if (v > m) m = v
    return Math.max(1, Math.min(m, 50))
  }, [data])

  useEffect(() => {
    const wrapEl = wrapRef.current
    const canvas = canvasRef.current
    if (!wrapEl || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = prefersReducedMotion()
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)

    // clone DTOs — d3-force mutates node/link objects in place.
    const degree = new Map<string, number>()
    for (const e of data.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const nodes: Array<SimNode> = data.nodes.map((n) => ({
      ...n,
      deg: degree.get(n.id) ?? 0,
    }))
    const edges: Array<SimEdge> = data.edges.map((e) => ({ ...e }))
    const nodeById = new Map(nodes.map((n) => [n.id, n]))

    let width = wrapEl.clientWidth || 800
    let height = wrapEl.clientHeight || 600
    let transform: ZoomTransform = zoomIdentity

    function sizeCanvas() {
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
    }
    sizeCanvas()

    const sim = forceSimulation<SimNode, SimEdge>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance((d) => (d.edgeType === 'mentions' ? 40 : 28))
          .strength(0.15),
      )
      .force('charge', forceManyBody<SimNode>().strength(-14).distanceMax(400))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.02))
      .force('y', forceY(height / 2).strength(0.02))
      .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d) + 1).iterations(1))
      .alphaDecay(0.03)
    simRef.current = sim

    // ── drawing ───────────────────────────────────────────────────────────
    let raf = 0
    function endpoints(e: SimEdge): [SimNode | undefined, SimNode | undefined] {
      const s = typeof e.source === 'string' ? nodeById.get(e.source) : e.source
      const t = typeof e.target === 'string' ? nodeById.get(e.target) : e.target
      return [s, t]
    }

    // ── filter visibility (recomputed only when filter state changes) ────────
    let visKey = ''
    const nodeDeg = new Map<string, number>()
    const visibleNodes = new Set<string>()
    function recomputeVisibility(
      vt: Record<EdgeType, boolean>,
      vk: Record<Kind, boolean>,
      hideIso: boolean,
      minC: number,
    ) {
      nodeDeg.clear()
      for (const e of edges) {
        if (!vt[e.edgeType]) continue
        const [s, t] = endpoints(e)
        if (!s || !t || !vk[s.kind] || !vk[t.kind]) continue
        nodeDeg.set(s.id, (nodeDeg.get(s.id) ?? 0) + 1)
        nodeDeg.set(t.id, (nodeDeg.get(t.id) ?? 0) + 1)
      }
      const min = Math.max(minC, hideIso ? 1 : 0)
      visibleNodes.clear()
      for (const n of nodes) {
        if (!vk[n.kind]) continue
        if ((nodeDeg.get(n.id) ?? 0) >= min) visibleNodes.add(n.id)
      }
    }
    const edgeShown = (e: SimEdge, vt: Record<EdgeType, boolean>): boolean => {
      if (!vt[e.edgeType]) return false
      const [s, t] = endpoints(e)
      return !!s && !!t && visibleNodes.has(s.id) && visibleNodes.has(t.id)
    }

    function draw() {
      const {
        selected: sel,
        hovered: hov,
        search: q,
        visibleTypes: vis,
        visibleKinds: vkinds,
        hideIsolated: hideIso,
        minConnections: minC,
      } = stateRef.current
      const key = JSON.stringify([vis, vkinds, hideIso, minC])
      if (key !== visKey) {
        visKey = key
        recomputeVisibility(vis, vkinds, hideIso, minC)
      }
      const activeId =
        (hov && visibleNodes.has(hov.id) ? hov.id : null) ??
        (sel && visibleNodes.has(sel.id) ? sel.id : null)
      const query = q.trim().toLowerCase()

      const neighbors = new Set<string>()
      if (activeId) {
        neighbors.add(activeId)
        for (const e of edges) {
          if (!edgeShown(e, vis)) continue
          const [s, t] = endpoints(e)
          if (!s || !t) continue
          if (s.id === activeId) neighbors.add(t.id)
          if (t.id === activeId) neighbors.add(s.id)
        }
      }

      ctx!.save()
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx!.clearRect(0, 0, width, height)
      ctx!.translate(transform.x, transform.y)
      ctx!.scale(transform.k, transform.k)

      // edges, batched per type for throughput
      ctx!.lineWidth = 1 / transform.k
      for (const type of EDGE_ORDER) {
        if (!vis[type]) continue
        ctx!.strokeStyle = EDGE_COLOR[type]
        ctx!.beginPath()
        for (const e of edges) {
          if (e.edgeType !== type) continue
          const [s, t] = endpoints(e)
          if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) continue
          if (!visibleNodes.has(s.id) || !visibleNodes.has(t.id)) continue
          if (activeId && !(s.id === activeId || t.id === activeId)) continue
          ctx!.moveTo(s.x, s.y)
          ctx!.lineTo(t.x, t.y)
        }
        ctx!.stroke()
      }

      // nodes
      for (const n of nodes) {
        if (n.x == null || n.y == null) continue
        if (!visibleNodes.has(n.id)) continue
        const matched = query.length > 0 && n.label.toLowerCase().includes(query)
        const dim =
          (query.length > 0 && !matched) ||
          (activeId != null && !neighbors.has(n.id))
        const r = nodeRadius(n)
        ctx!.globalAlpha = dim ? 0.12 : 1
        ctx!.fillStyle = KIND_COLOR[n.kind]
        ctx!.beginPath()
        if (n.kind === 'wiki') ctx!.rect(n.x - r, n.y - r, r * 2, r * 2)
        else ctx!.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx!.fill()
        if (n.id === sel?.id || n.id === hov?.id || matched) {
          ctx!.globalAlpha = 1
          ctx!.lineWidth = 2 / transform.k
          ctx!.strokeStyle = '#ffffff'
          ctx!.stroke()
        }
      }
      ctx!.globalAlpha = 1

      // labels only for the active node + its neighbors (readable at any scale)
      if (activeId) {
        ctx!.fillStyle = '#dfffce'
        ctx!.font = `${11 / transform.k}px ui-monospace, monospace`
        for (const n of nodes) {
          if (!neighbors.has(n.id) || n.x == null || n.y == null) continue
          ctx!.fillText(n.label, n.x + nodeRadius(n) + 2, n.y + 3 / transform.k)
        }
      }
      ctx!.restore()
    }
    function scheduleDraw() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        draw()
      })
    }
    // let React trigger a repaint on filter/selection change even when the
    // simulation has cooled (no ticks firing).
    redrawRef.current = scheduleDraw

    sim.on('tick', scheduleDraw)
    if (reduced) {
      sim.stop()
      sim.tick(250)
      draw()
    }

    // ── hit testing ─────────────────────────────────────────────────────────
    function nodeAt(px: number, py: number): SimNode | undefined {
      const sx = (px - transform.x) / transform.k
      const sy = (py - transform.y) / transform.k
      const n = sim.find(sx, sy, 12 / transform.k)
      if (!n) return undefined
      // ignore nodes hidden by the current filters
      return visibleNodes.size === 0 || visibleNodes.has(n.id) ? n : undefined
    }

    // ── zoom / pan (defers to node-drag when pointer is on a node) ────────────
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 8])
      .filter((event: any) => {
        if (event.type === 'wheel') return true
        if (event.button != null && event.button !== 0) return false
        const [px, py] = pointer(event, canvas)
        return !nodeAt(px, py) // grab a node → let drag win; else pan
      })
      .on('zoom', (event: any) => {
        transform = event.transform
        scheduleDraw()
      })
    const canvasSel = select(canvas)
    canvasSel.call(zoomBehavior as any)
    zoomByRef.current = (k) =>
      canvasSel.transition().duration(200).call(zoomBehavior.scaleBy as any, k)
    zoomResetRef.current = () =>
      canvasSel.transition().duration(200).call(zoomBehavior.transform as any, zoomIdentity)

    // ── node drag ─────────────────────────────────────────────────────────
    const dragBehavior = d3drag<HTMLCanvasElement, unknown>()
      .container(canvas)
      .subject((event: any) => {
        const [px, py] = pointer(event, canvas)
        return nodeAt(px, py)
      })
      .on('start', (event: any) => {
        if (!event.active && !reduced) sim.alphaTarget(0.15).restart()
        const s = event.subject as SimNode
        s.fx = (event.x - transform.x) / transform.k
        s.fy = (event.y - transform.y) / transform.k
      })
      .on('drag', (event: any) => {
        const s = event.subject as SimNode
        s.fx = (event.x - transform.x) / transform.k
        s.fy = (event.y - transform.y) / transform.k
        if (reduced) scheduleDraw()
      })
      .on('end', (event: any) => {
        if (!event.active) sim.alphaTarget(0)
        // stays pinned; double-click releases (below)
      })
    canvasSel.call(dragBehavior as any)

    // ── hover / click ─────────────────────────────────────────────────────
    function onMove(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
      setHovered(n ?? null)
      canvas!.style.cursor = n ? 'pointer' : 'grab'
    }
    function onClick(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
      setSelected((cur) => (n ? (cur?.id === n.id ? null : n) : null))
    }
    function onDblClick(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
      if (n) {
        n.fx = null
        n.fy = null
        if (!reduced) sim.alphaTarget(0.1).restart()
      }
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDblClick)

    // ── resize ──────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      width = wrapEl.clientWidth || width
      height = wrapEl.clientHeight || height
      sizeCanvas()
      sim.force('center', forceCenter(width / 2, height / 2))
      if (!reduced) sim.alpha(0.2).restart()
      scheduleDraw()
    })
    ro.observe(wrapEl)

    // ── cleanup ─────────────────────────────────────────────────────────────
    return () => {
      if (raf) cancelAnimationFrame(raf)
      sim.on('tick', null)
      sim.stop()
      ro.disconnect()
      canvasSel.on('.zoom', null).on('.drag', null)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDblClick)
      simRef.current = null
      zoomByRef.current = null
      zoomResetRef.current = null
      redrawRef.current = null
    }
    // Rebuild only when the dataset changes; interaction reads via stateRef.
  }, [data])

  // repaint on any filter / selection / search change (sim may be cooled)
  useEffect(() => {
    redrawRef.current?.()
  }, [selected, hovered, search, visibleTypes, visibleKinds, hideIsolated, minConnections])

  function toggleType(t: EdgeType) {
    setVisibleTypes((v) => ({ ...v, [t]: !v[t] }))
  }
  function toggleKind(k: Kind) {
    setVisibleKinds((v) => ({ ...v, [k]: !v[k] }))
  }
  function resetFilters() {
    setVisibleTypes({ ctx: true, references: true, mentions: true, about: true, relates: true, summarizes: true })
    setVisibleKinds({ gist: true, working: true, fact: true, entity: true, episodic: true, wiki: true })
    setHideIsolated(false)
    setMinConnections(0)
  }
  const filtersActive =
    hideIsolated ||
    minConnections > 0 ||
    EDGE_ORDER.some((t) => !visibleTypes[t]) ||
    KIND_ORDER.some((k) => !visibleKinds[k])

  return (
    <div className="mm-wrap" ref={wrapRef}>
      <div className="mm-controls">
        <input
          type="search"
          className="mm-search"
          placeholder="Search nodes…"
          value={search}
          aria-label="Search memory map nodes by label"
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={`mm-toggle mm-filter-btn ${filtersActive ? 'is-on' : ''}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filters{filtersActive ? ' •' : ''}
        </button>
        <div className="mm-zoom" role="group" aria-label="Zoom controls">
          <button type="button" className="mm-zoom-btn" aria-label="Zoom in" onClick={() => zoomByRef.current?.(1.4)}>+</button>
          <button type="button" className="mm-zoom-btn" aria-label="Zoom out" onClick={() => zoomByRef.current?.(1 / 1.4)}>−</button>
          <button type="button" className="mm-zoom-btn" aria-label="Reset zoom" onClick={() => zoomResetRef.current?.()}>⟲</button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mm-filter-panel" role="group" aria-label="Graph filters">
          <div className="mm-filter-row">
            <span className="mm-filter-label">Node kinds</span>
            <div className="mm-toggles">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`mm-toggle ${visibleKinds[k] ? 'is-on' : ''}`}
                  aria-pressed={visibleKinds[k]}
                  onClick={() => toggleKind(k)}
                >
                  <span
                    className={k === 'wiki' ? 'mm-legend-square' : 'mm-legend-dot'}
                    style={{ background: KIND_COLOR[k] }}
                  />
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="mm-filter-row">
            <span className="mm-filter-label">Edge types</span>
            <div className="mm-toggles" role="group" aria-label="Edge type filters">
              {EDGE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mm-toggle ${visibleTypes[t] ? 'is-on' : ''}`}
                  aria-pressed={visibleTypes[t]}
                  onClick={() => toggleType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="mm-filter-row">
            <label className="mm-filter-check">
              <input
                type="checkbox"
                checked={hideIsolated}
                onChange={(e) => setHideIsolated(e.target.checked)}
              />
              Hide isolated nodes
            </label>
            <label className="mm-filter-slider">
              <span>Min connections: {minConnections}</span>
              <input
                type="range"
                min={0}
                max={maxConn}
                value={minConnections}
                onChange={(e) => setMinConnections(Number(e.target.value))}
                aria-label="Minimum connections"
              />
            </label>
            <button type="button" className="mm-toggle" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>
      )}

      <div className="mm-legend" aria-label="Node kinds legend">
        {(Object.keys(KIND_COLOR) as Array<Kind>).map((k) => (
          <span key={k} className="mm-legend-item">
            <span
              className={k === 'wiki' ? 'mm-legend-square' : 'mm-legend-dot'}
              style={{ background: KIND_COLOR[k] }}
            />
            {KIND_LABEL[k]} ({counts[k] ?? 0})
          </span>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className="mm-canvas"
        role="img"
        aria-label={`Memory map: ${data.meta.nodeCount} nodes, ${data.meta.edgeCount} edges`}
      />

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
