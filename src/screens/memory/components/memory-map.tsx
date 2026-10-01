/**
 * MemoryMap — D3 force-directed Memory Map tab (issue #342).
 *
 * Renders the mnemosyne graph (GET /api/memory/graph): gist / working /
 * fact / entity / episodic / wiki nodes tied together by ctx / references /
 * mentions / about / relates / summarizes edges (~7k nodes / ~13k edges).
 *
 * At this scale SVG DOM is not viable, so rendering is on a <canvas>:
 * d3-force drives the layout, d3-zoom handles pan/zoom, and node dragging +
 * hover use simulation.find() for hit-testing.
 *
 * Usability defaults: only the top DEFAULT_NODE_LIMIT nodes by degree are
 * shown (episodic chat-log nodes and `mentions` edges off) until "Show all".
 * The simulation only holds the visible subset; filter changes swap its
 * nodes/links in place so positions persist. Edges are bucketed per type on
 * visibility change (not per frame) and culled to the viewport; hover lives
 * in a ref so mousemove never re-renders React.
 *
 * Colours come from `--mm-*` CSS vars that chain to `--theme-*` tokens
 * (matrix-memory-map.css), re-read when the theme changes. Each kind also has
 * its own shape so colour is never the only cue.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
import { zoom as d3zoom, zoomIdentity, zoomTransform } from 'd3-zoom'
import {
  DEFAULT_NODE_LIMIT,
  buildSearchIndex,
  cleanLabel,
  computeVisibleGraph,
  degreeMap,
  nodeDates,
  searchNodes,
  shortLabel,
} from './memory-map-graph'
import { useWikiFocusStore } from './wiki-focus-store'
import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  GraphNodeDetail,
  GraphResponse,
  Kind,
} from './memory-map-graph'
import type {
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force'
import type { ZoomTransform } from 'd3-zoom'
import { useMemoryScreenStore } from '@/stores/memory-screen-store'
import '@/styles/matrix-memory-map.css'

type SimNode = GraphNode & SimulationNodeDatum & { deg: number }
type SimEdge = Omit<GraphEdge, 'source' | 'target'> &
  SimulationLinkDatum<SimNode> & {
    source: string | SimNode
    target: string | SimNode
  }

// ── palette / geometry ──────────────────────────────────────────────────────

type Shape = 'circle' | 'ring' | 'triangle' | 'diamond' | 'hexagon' | 'square'

const KIND_ORDER: ReadonlyArray<Kind> = [
  'gist',
  'working',
  'fact',
  'entity',
  'episodic',
  'wiki',
]
const EDGE_ORDER: ReadonlyArray<EdgeType> = [
  'mentions',
  'about',
  'ctx',
  'summarizes',
  'references',
  'relates',
]
const KIND_SHAPE: Record<Kind, Shape> = {
  gist: 'circle',
  working: 'ring',
  fact: 'triangle',
  entity: 'diamond',
  episodic: 'hexagon',
  wiki: 'square',
}
// Used only when the theme vars can't be read (e.g. stylesheet missing).
const FALLBACK_COLOR: Record<Kind, string> = {
  gist: '#00ff41',
  working: '#7dffa8',
  fact: '#5fcfff',
  entity: '#ffb347',
  episodic: '#c792ea',
  wiki: '#ff6b9d',
}
// Edges borrow a kind colour (drawn with globalAlpha).
const EDGE_KIND: Record<EdgeType, Kind> = {
  ctx: 'gist',
  references: 'wiki',
  mentions: 'entity',
  about: 'fact',
  relates: 'episodic',
  summarizes: 'working',
}
const EDGE_ALPHA: Record<EdgeType, number> = {
  ctx: 0.3,
  references: 0.45,
  mentions: 0.12,
  about: 0.22,
  relates: 0.55,
  summarizes: 0.3,
}
const BASE_R: Record<Kind, number> = {
  gist: 2.6,
  working: 2.6,
  fact: 2.6,
  entity: 3,
  episodic: 3.4,
  wiki: 4,
}
const ALL_TYPES_ON: Record<EdgeType, boolean> = {
  ctx: true,
  references: true,
  mentions: true,
  about: true,
  relates: true,
  summarizes: true,
}
const ALL_KINDS_ON: Record<Kind, boolean> = {
  gist: true,
  working: true,
  fact: true,
  entity: true,
  episodic: true,
  wiki: true,
}
// Focused default: chat-log episodes + entity `mentions` are the noise.
const DEFAULT_TYPES: Record<EdgeType, boolean> = {
  ...ALL_TYPES_ON,
  mentions: false,
}
const DEFAULT_KINDS: Record<Kind, boolean> = {
  ...ALL_KINDS_ON,
  episodic: false,
}

const TAU = Math.PI * 2
// ponytail: expanded neighbour list is capped; paginate if hubs need more
const NEIGHBOUR_MAX = 200

function nodeRadius(n: SimNode): number {
  // entity hubs grow with degree so the connectors stand out
  const boost = n.kind === 'entity' ? Math.min(6, Math.sqrt(n.deg)) : 0
  return BASE_R[n.kind] + boost
}

function tracePath(
  c: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  r: number,
) {
  switch (shape) {
    case 'circle':
    case 'ring':
      c.moveTo(x + r, y)
      c.arc(x, y, r, 0, TAU)
      return
    case 'square':
      c.rect(x - r, y - r, r * 2, r * 2)
      return
    case 'diamond': {
      const d = r * 1.3
      c.moveTo(x, y - d)
      c.lineTo(x + d, y)
      c.lineTo(x, y + d)
      c.lineTo(x - d, y)
      c.closePath()
      return
    }
    case 'triangle': {
      const d = r * 1.35
      c.moveTo(x, y - d)
      c.lineTo(x + d * 0.87, y + d * 0.5)
      c.lineTo(x - d * 0.87, y + d * 0.5)
      c.closePath()
      return
    }
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i
        const px = x + r * 1.1 * Math.cos(a)
        const py = y + r * 1.1 * Math.sin(a)
        if (i === 0) c.moveTo(px, py)
        else c.lineTo(px, py)
      }
      c.closePath()
  }
}

/** SVG twin of tracePath for legend / panel chips. */
function KindGlyph({ kind }: { kind: Kind }) {
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

type Palette = { kind: Record<Kind, string>; text: string; bg: string }

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el)
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb
  const kind = {} as Record<Kind, string>
  for (const k of KIND_ORDER) kind[k] = v(`--mm-${k}`, FALLBACK_COLOR[k])
  return {
    kind,
    text: v('--theme-text', '#d8ffe3'),
    bg: v('--theme-bg', '#020804'),
  }
}

async function fetchGraph(profile: string): Promise<GraphResponse> {
  const res = await fetch(
    `/api/memory/graph?profile=${encodeURIComponent(profile)}`,
    { credentials: 'same-origin' },
  )
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<GraphResponse>
}

async function fetchNode(
  id: string,
  profile: string,
): Promise<GraphNodeDetail> {
  const res = await fetch(
    `/api/memory/graph/node?id=${encodeURIComponent(id)}&profile=${encodeURIComponent(profile)}`,
    {
      credentials: 'same-origin',
    },
  )
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<GraphNodeDetail>
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
  const profile = useMemoryScreenStore((s) => s.profile)
  const query = useQuery<GraphResponse>({
    queryKey: ['memory', 'map', 'graph', profile],
    queryFn: () => fetchGraph(profile),
    staleTime: 60_000,
  })

  if (query.isLoading) {
    return (
      <div className="mm-state" role="status">
        Loading memory map…
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="mm-state mm-state-error" role="alert">
        Failed to load memory map:{' '}
        {query.error instanceof Error ? query.error.message : 'unknown error'}
        <button
          type="button"
          className="mm-toggle"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
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

  return (
    <MemoryMapCanvas
      // Remount per profile: selection/filters belong to one dataset.
      key={profile}
      profile={profile}
      data={data}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  )
}

type MapApi = {
  apply: (nodeIds: Set<string>, edgeIdx: Array<number>) => void
  zoomTo: (id: string) => void
  zoomBy: (k: number) => void
  fit: () => void
  redraw: () => void
}

function MemoryMapCanvas({
  profile,
  data,
  refreshing,
  onRefresh,
}: {
  profile: string
  data: GraphResponse
  refreshing: boolean
  onRefresh: () => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const apiRef = useRef<MapApi | null>(null)
  // node positions survive a refetch (data identity change)
  const posRef = useRef(new Map<string, { x: number; y: number }>())

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [visibleTypes, setVisibleTypes] = useState(DEFAULT_TYPES)
  const [visibleKinds, setVisibleKinds] = useState(DEFAULT_KINDS)
  const [minConnections, setMinConnections] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [activeResult, setActiveResult] = useState(0)
  const [expandedKinds, setExpandedKinds] = useState<Set<Kind>>(new Set())
  const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(
    null,
  )

  const setActiveTab = useMemoryScreenStore((s) => s.setActiveTab)

  // ── data-derived lookups (once per dataset) ──────────────────────────────
  const model = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]))
    const deg = degreeMap(data.edges)
    const dates = nodeDates(data.edges)
    const adj = new Map<string, Set<string>>()
    for (const e of data.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set())
      if (!adj.has(e.target)) adj.set(e.target, new Set())
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }
    const counts: Partial<Record<Kind, number>> = {}
    for (const n of data.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1
    let maxDeg = 1
    for (const v of deg.values()) if (v > maxDeg) maxDeg = v
    return {
      byId,
      deg,
      dates,
      adj,
      counts,
      maxConn: Math.min(maxDeg, 50),
      searchIndex: buildSearchIndex(data.nodes),
    }
  }, [data])

  const visible = useMemo(
    () =>
      computeVisibleGraph(data.nodes, data.edges, {
        kinds: visibleKinds,
        types: visibleTypes,
        minDegree: minConnections,
        limit: showAll ? null : DEFAULT_NODE_LIMIT,
        pinned: selectedId,
      }),
    [data, visibleKinds, visibleTypes, minConnections, showAll, selectedId],
  )

  const results = useMemo(
    () => searchNodes(model.searchIndex, search, model.deg),
    [search, model],
  )

  // live refs so interaction state reaches the draw loop without rebuilding it
  // matchIds: null = no active search (nothing dimmed)
  const matchIds = search.trim() ? results.ids : null
  const stateRef = useRef({ selectedId, matchIds })
  stateRef.current = { selectedId, matchIds }

  useEffect(() => {
    const wrapEl = wrapRef.current
    const canvas = canvasRef.current
    if (!wrapEl || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = prefersReducedMotion()
    const dpr = Math.min(
      2,
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    )
    let palette = readPalette(wrapEl)

    // clone DTOs — d3-force mutates node/link objects in place.
    const positions = posRef.current
    const nodes: Array<SimNode> = data.nodes.map((n) => ({
      ...n,
      ...positions.get(n.id),
      deg: model.deg.get(n.id) ?? 0,
    }))
    const edges: Array<SimEdge> = data.edges.map((e) => ({ ...e }))
    const nodeById = new Map(nodes.map((n) => [n.id, n]))

    let width = wrapEl.clientWidth || 800
    let height = wrapEl.clientHeight || 600
    // d3-zoom keeps __zoom on the canvas across rebuilds (e.g. refresh)
    let transform: ZoomTransform = zoomTransform(canvas)
    let hoverId: string | null = null
    let fitted = positions.size > 0

    function sizeCanvas() {
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
    }
    sizeCanvas()

    const linkForce = forceLink<SimNode, SimEdge>([])
      .id((d) => d.id)
      .distance((d) => (d.edgeType === 'mentions' ? 40 : 28))
      .strength(0.15)
    const sim = forceSimulation<SimNode, SimEdge>([])
      .force('link', linkForce)
      .force('charge', forceManyBody<SimNode>().strength(-14).distanceMax(400))
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.02))
      .force('y', forceY(height / 2).strength(0.02))
      .force(
        'collide',
        forceCollide<SimNode>()
          .radius((d) => nodeRadius(d) + 1)
          .iterations(1),
      )
      .alphaDecay(0.03)
      .stop()

    // ── visible subset (rebuilt on filter change, not per frame) ────────────
    let visNodes: Array<SimNode> = []
    let visIds = new Set<string>()
    let visEdgeKey = ''
    const visByKind = new Map<Kind, Array<SimNode>>()
    const edgesByType = new Map<EdgeType, Array<SimEdge>>()
    const visAdj = new Map<string, Array<SimNode>>()

    const end = (v: string | SimNode) =>
      typeof v === 'string' ? nodeById.get(v) : v

    function apply(nodeIds: Set<string>, edgeIdx: Array<number>) {
      let h = 0
      for (const i of edgeIdx) h = (Math.imul(h, 31) + i) | 0
      const edgeKey = `${edgeIdx.length}:${h}`
      const same =
        nodeIds.size === visIds.size &&
        edgeKey === visEdgeKey &&
        [...nodeIds].every((id) => visIds.has(id))
      if (same) {
        scheduleDraw()
        return
      }
      visIds = nodeIds
      visEdgeKey = edgeKey
      visNodes = []
      visByKind.clear()
      for (const id of nodeIds) {
        const n = nodeById.get(id)
        if (!n) continue
        visNodes.push(n)
        const bucket = visByKind.get(n.kind)
        if (bucket) bucket.push(n)
        else visByKind.set(n.kind, [n])
      }
      // seed newly shown nodes next to an already-placed neighbour
      for (const n of visNodes) {
        if (n.x != null && n.y != null) continue
        let anchor: SimNode | undefined
        for (const nb of model.adj.get(n.id) ?? []) {
          const m = nodeById.get(nb)
          if (m?.x != null && m.y != null) {
            anchor = m
            break
          }
        }
        n.x = (anchor?.x ?? width / 2) + (Math.random() - 0.5) * 30
        n.y = (anchor?.y ?? height / 2) + (Math.random() - 0.5) * 30
      }
      const visEdges = edgeIdx.map((i) => edges[i])
      sim.nodes(visNodes)
      linkForce.links(visEdges)

      edgesByType.clear()
      visAdj.clear()
      for (const e of visEdges) {
        const bucket = edgesByType.get(e.edgeType)
        if (bucket) bucket.push(e)
        else edgesByType.set(e.edgeType, [e])
        const s = end(e.source)
        const t = end(e.target)
        if (!s || !t) continue
        if (!visAdj.has(s.id)) visAdj.set(s.id, [])
        if (!visAdj.has(t.id)) visAdj.set(t.id, [])
        visAdj.get(s.id)!.push(t)
        visAdj.get(t.id)!.push(s)
      }

      if (reduced) {
        sim.stop()
        sim.tick(200)
        if (!fitted) {
          fitted = true
          fit(false)
        }
        scheduleDraw()
      } else {
        sim.alpha(fitted ? 0.4 : 1).restart()
      }
    }

    // ── drawing ───────────────────────────────────────────────────────────
    let raf = 0
    function draw() {
      const { selectedId: sel, matchIds: hits } = stateRef.current
      const activeId =
        (hoverId && visIds.has(hoverId) ? hoverId : null) ??
        (sel && visIds.has(sel) ? sel : null)
      const neighbors = new Set<string>()
      if (activeId) {
        neighbors.add(activeId)
        for (const m of visAdj.get(activeId) ?? []) neighbors.add(m.id)
      }

      // viewport in simulation coords (with margin) for culling
      const m = 20 / transform.k
      const x0 = -transform.x / transform.k - m
      const y0 = -transform.y / transform.k - m
      const x1 = (width - transform.x) / transform.k + m
      const y1 = (height - transform.y) / transform.k + m
      const onScreen = (n: SimNode) =>
        n.x! >= x0 && n.x! <= x1 && n.y! >= y0 && n.y! <= y1

      const c = ctx!
      c.save()
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, width, height)
      c.translate(transform.x, transform.y)
      c.scale(transform.k, transform.k)

      // edges, batched per type
      c.lineWidth = 1 / transform.k
      for (const type of EDGE_ORDER) {
        const bucket = edgesByType.get(type)
        if (!bucket) continue
        c.strokeStyle = palette.kind[EDGE_KIND[type]]
        c.globalAlpha = activeId
          ? Math.min(1, EDGE_ALPHA[type] * 2)
          : EDGE_ALPHA[type]
        c.beginPath()
        for (const e of bucket) {
          const s = e.source as SimNode
          const t = e.target as SimNode
          if (s.x == null || s.y == null || t.x == null || t.y == null) continue
          if (activeId && s.id !== activeId && t.id !== activeId) continue
          if (
            (s.x < x0 && t.x < x0) ||
            (s.x > x1 && t.x > x1) ||
            (s.y < y0 && t.y < y0) ||
            (s.y > y1 && t.y > y1)
          ) {
            continue
          }
          c.moveTo(s.x, s.y)
          c.lineTo(t.x, t.y)
        }
        c.stroke()
      }

      // nodes, one path per kind × (normal | dimmed)
      const matched: Array<SimNode> = []
      for (const kind of KIND_ORDER) {
        const shape = KIND_SHAPE[kind]
        for (const dimPass of [true, false]) {
          c.beginPath()
          let any = false
          for (const n of visByKind.get(kind) ?? []) {
            if (n.x == null || n.y == null || !onScreen(n)) continue
            const isMatch = hits?.has(n.id) ?? false
            const dim =
              (hits != null && !isMatch) ||
              (activeId != null && !neighbors.has(n.id))
            if (dim !== dimPass) continue
            if (isMatch && !dimPass) matched.push(n)
            tracePath(
              c,
              shape,
              n.x,
              n.y,
              shape === 'ring' ? nodeRadius(n) - 0.7 : nodeRadius(n),
            )
            any = true
          }
          if (!any) continue
          c.globalAlpha = dimPass ? 0.12 : 1
          if (shape === 'ring') {
            c.lineWidth = 1.4
            c.strokeStyle = palette.kind[kind]
            c.stroke()
          } else {
            c.fillStyle = palette.kind[kind]
            c.fill()
          }
        }
      }
      c.globalAlpha = 1

      // highlight rings: selected, hovered, search hits
      c.strokeStyle = palette.text
      c.lineWidth = 2 / transform.k
      for (const id of [sel, hoverId]) {
        const n = id && visIds.has(id) ? nodeById.get(id) : undefined
        if (!n || n.x == null || n.y == null) continue
        c.beginPath()
        tracePath(
          c,
          KIND_SHAPE[n.kind],
          n.x,
          n.y,
          nodeRadius(n) + 2 / transform.k,
        )
        c.stroke()
      }
      if (matched.length > 0) {
        c.beginPath()
        for (const n of matched)
          tracePath(c, KIND_SHAPE[n.kind], n.x!, n.y!, nodeRadius(n))
        c.stroke()
      }

      // labels: active neighbourhood, else entity/wiki hubs once zoomed in
      const labelled: Array<SimNode> = []
      if (activeId) {
        for (const id of neighbors) {
          const n = nodeById.get(id)
          if (n && n.x != null && onScreen(n)) labelled.push(n)
        }
      } else if (transform.k >= 1.4) {
        for (const n of visNodes) {
          if (labelled.length >= 120) break
          if (
            (n.kind === 'entity' || n.kind === 'wiki') &&
            n.x != null &&
            onScreen(n)
          ) {
            labelled.push(n)
          }
        }
      }
      if (labelled.length > 0) {
        const fs = 11 / transform.k
        c.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`
        c.lineWidth = 3 / transform.k
        c.lineJoin = 'round'
        c.strokeStyle = palette.bg
        c.fillStyle = palette.text
        for (const n of labelled) {
          const text = shortLabel(n, 28, model.dates.get(n.id) ?? null)
          const lx = n.x! + nodeRadius(n) + 3 / transform.k
          const ly = n.y! + fs * 0.35
          c.strokeText(text, lx, ly)
          c.fillText(text, lx, ly)
        }
      }
      c.restore()
    }
    function scheduleDraw() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        draw()
      })
    }
    sim.on('tick', scheduleDraw)
    sim.on('end', () => {
      if (!fitted) {
        fitted = true
        fit(false)
      }
    })

    // ── hit testing ─────────────────────────────────────────────────────────
    function nodeAt(px: number, py: number): SimNode | undefined {
      const sx = (px - transform.x) / transform.k
      const sy = (py - transform.y) / transform.k
      return sim.find(sx, sy, 12 / transform.k)
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
    const moveTo = (t: ZoomTransform, animate = true) =>
      canvasSel
        .transition()
        .duration(animate && !reduced ? 450 : 0)
        .call(zoomBehavior.transform as any, t)

    function fit(animate = true) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of visNodes) {
        if (n.x == null || n.y == null) continue
        minX = Math.min(minX, n.x)
        minY = Math.min(minY, n.y)
        maxX = Math.max(maxX, n.x)
        maxY = Math.max(maxY, n.y)
      }
      if (!Number.isFinite(minX)) return
      const pad = 48
      const k = Math.max(
        0.05,
        Math.min(
          4,
          Math.min(
            width / (maxX - minX + pad * 2),
            height / (maxY - minY + pad * 2),
          ),
        ),
      )
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      moveTo(
        zoomIdentity
          .translate(width / 2 - k * cx, height / 2 - k * cy)
          .scale(k),
        animate,
      )
    }

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
        if (reduced) {
          s.x = s.fx
          s.y = s.fy
          scheduleDraw()
        }
      })
      .on('end', (event: any) => {
        if (!event.active) sim.alphaTarget(0)
        // stays pinned; double-click releases (below)
      })
    canvasSel.call(dragBehavior as any)

    // ── hover (ref only — no React render per mousemove) / click ─────────
    function onMove(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const id =
        nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)?.id ?? null
      canvas!.style.cursor = id ? 'pointer' : 'grab'
      if (id !== hoverId) {
        hoverId = id
        scheduleDraw()
      }
    }
    function onLeave() {
      if (hoverId) {
        hoverId = null
        scheduleDraw()
      }
    }
    function onClick(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
      setSelectedId((cur) => (n ? (cur === n.id ? null : n.id) : null))
    }
    function onDblClick(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top)
      if (n) {
        n.fx = null
        n.fy = null
        if (!reduced) sim.alpha(0.3).restart()
      }
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDblClick)

    // ── resize + theme change ─────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      width = wrapEl.clientWidth || width
      height = wrapEl.clientHeight || height
      sizeCanvas()
      sim.force('center', forceCenter(width / 2, height / 2))
      sim.force('x', forceX(width / 2).strength(0.02))
      sim.force('y', forceY(height / 2).strength(0.02))
      scheduleDraw()
    })
    ro.observe(wrapEl)
    const mo = new MutationObserver(() => {
      palette = readPalette(wrapEl)
      scheduleDraw()
    })
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    apiRef.current = {
      apply,
      fit,
      redraw: scheduleDraw,
      zoomBy: (k) =>
        canvasSel
          .transition()
          .duration(200)
          .call(zoomBehavior.scaleBy as any, k),
      zoomTo: (id) => {
        const n = nodeById.get(id)
        if (n?.x == null || n.y == null) return
        const k = Math.max(transform.k, 1.8)
        moveTo(
          zoomIdentity
            .translate(width / 2 - k * n.x, height / 2 - k * n.y)
            .scale(k),
        )
      },
    }

    // ── cleanup ─────────────────────────────────────────────────────────────
    return () => {
      if (raf) cancelAnimationFrame(raf)
      for (const n of nodes)
        if (n.x != null && n.y != null) positions.set(n.id, { x: n.x, y: n.y })
      sim.on('tick', null).on('end', null)
      sim.stop()
      ro.disconnect()
      mo.disconnect()
      canvasSel.interrupt().on('.zoom', null).on('.drag', null)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDblClick)
      apiRef.current = null
    }
    // Rebuild only when the dataset changes; interaction reads via stateRef.
  }, [data, model])

  // push the visible subset into the simulation (after the build effect)
  useEffect(() => {
    apiRef.current?.apply(visible.nodeIds, visible.edgeIdx)
  }, [visible])

  // zoom to a focused node once it is in the visible set
  useEffect(() => {
    if (focusReq) apiRef.current?.zoomTo(focusReq.id)
  }, [focusReq])

  // repaint on selection / search change (sim may be cooled)
  useEffect(() => {
    apiRef.current?.redraw()
  }, [selectedId, matchIds])

  // collapse "+N more" groups when the selection changes
  useEffect(() => {
    setExpandedKinds(new Set())
  }, [selectedId])

  function focusNode(id: string) {
    const n = model.byId.get(id)
    if (!n) return
    if (!visibleKinds[n.kind])
      setVisibleKinds((v) => ({ ...v, [n.kind]: true }))
    setSelectedId(id)
    setResultsOpen(false)
    setFocusReq((r) => ({ id, seq: (r?.seq ?? 0) + 1 }))
  }
  function openInWiki(path: string) {
    useWikiFocusStore.getState().setPath(path)
    setActiveTab('wiki')
  }
  function resetFilters() {
    setVisibleTypes(DEFAULT_TYPES)
    setVisibleKinds(DEFAULT_KINDS)
    setMinConnections(0)
    setShowAll(false)
  }
  const filtersActive =
    minConnections > 0 ||
    EDGE_ORDER.some((t) => visibleTypes[t] !== DEFAULT_TYPES[t]) ||
    KIND_ORDER.some((k) => visibleKinds[k] !== DEFAULT_KINDS[k])

  const selected = selectedId ? model.byId.get(selectedId) : undefined
  const detailQuery = useQuery({
    queryKey: ['memory', 'map', 'node', profile, selectedId],
    queryFn: () => fetchNode(selectedId!, profile),
    enabled: !!selectedId,
    staleTime: 60_000,
  })
  const detail =
    detailQuery.data?.id === selectedId ? detailQuery.data : undefined
  const lastSeen = selected ? model.dates.get(selected.id) : undefined
  const neighbourGroups = useMemo(() => {
    if (!selectedId) return []
    const groups = new Map<Kind, Array<GraphNode>>()
    for (const id of model.adj.get(selectedId) ?? []) {
      const n = model.byId.get(id)
      if (!n) continue
      const list = groups.get(n.kind)
      if (list) list.push(n)
      else groups.set(n.kind, [n])
    }
    return KIND_ORDER.filter((k) => groups.has(k)).map((k) => ({
      kind: k,
      nodes: groups
        .get(k)!
        .sort(
          (a, b) => (model.deg.get(b.id) ?? 0) - (model.deg.get(a.id) ?? 0),
        ),
    }))
  }, [selectedId, model])

  const showResults = resultsOpen && search.trim().length > 0
  const activeIdx = Math.min(
    activeResult,
    Math.max(0, results.matches.length - 1),
  )
  const shown = visible.nodeIds.size
  const limited = !showAll && visible.candidates > DEFAULT_NODE_LIMIT
  const droppedEdges = data.meta.rawEdgeCount - data.meta.edgeCount

  return (
    <div
      className="mm-wrap"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selectedId) setSelectedId(null)
      }}
    >
      <div className="mm-controls">
        <div className="mm-search-wrap">
          <input
            type="search"
            className="mm-search"
            placeholder="Search nodes…"
            value={search}
            aria-label="Search memory map nodes by label"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="mm-results-list"
            aria-activedescendant={
              showResults && results.matches[activeIdx]
                ? `mm-result-${activeIdx}`
                : undefined
            }
            onChange={(e) => {
              setSearch(e.target.value)
              setResultsOpen(true)
              setActiveResult(0)
            }}
            onFocus={() => setResultsOpen(true)}
            onKeyDown={(e) => {
              const n = results.matches.length
              if (e.key === 'ArrowDown' && n > 0) {
                e.preventDefault()
                setResultsOpen(true)
                setActiveResult((activeIdx + 1) % n)
              } else if (e.key === 'ArrowUp' && n > 0) {
                e.preventDefault()
                setActiveResult((activeIdx - 1 + n) % n)
              } else if (e.key === 'Enter' && results.matches[activeIdx]) {
                focusNode(results.matches[activeIdx].id)
              } else if (e.key === 'Escape') {
                // don't let the wrapper's Escape also close the detail panel
                e.stopPropagation()
                if (showResults) setResultsOpen(false)
                else setSearch('')
              }
            }}
          />
          {showResults && (
            <div className="mm-results">
              <div className="mm-results-count" role="status">
                {results.total === 0
                  ? 'No matches'
                  : `${results.total} match${results.total === 1 ? '' : 'es'} · Enter to jump`}
              </div>
              <div
                id="mm-results-list"
                role="listbox"
                aria-label="Search results"
              >
                {results.matches.map((n, i) => (
                  <button
                    key={n.id}
                    id={`mm-result-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    tabIndex={-1}
                    className={`mm-result ${i === activeIdx ? 'is-active' : ''}`}
                    onMouseEnter={() => setActiveResult(i)}
                    onClick={() => focusNode(n.id)}
                  >
                    <KindGlyph kind={n.kind} />
                    <span className="mm-result-label">
                      {shortLabel(n, 60, model.dates.get(n.id) ?? null)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          className={`mm-toggle mm-filter-btn ${filtersActive ? 'is-on' : ''}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filters{filtersActive ? ' •' : ''}
        </button>
        <div className="mm-zoom" role="group" aria-label="View controls">
          <button
            type="button"
            className="mm-zoom-btn"
            aria-label="Zoom in"
            onClick={() => apiRef.current?.zoomBy(1.4)}
          >
            +
          </button>
          <button
            type="button"
            className="mm-zoom-btn"
            aria-label="Zoom out"
            onClick={() => apiRef.current?.zoomBy(1 / 1.4)}
          >
            −
          </button>
          <button
            type="button"
            className="mm-zoom-btn"
            aria-label="Fit to screen"
            title="Fit to screen"
            onClick={() => apiRef.current?.fit()}
          >
            ⤢
          </button>
          <button
            type="button"
            className={`mm-zoom-btn ${refreshing ? 'is-busy' : ''}`}
            aria-label="Refresh map"
            title="Refresh map"
            disabled={refreshing}
            onClick={onRefresh}
          >
            ⟳
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div
          className="mm-filter-panel"
          role="group"
          aria-label="Graph filters"
        >
          <div className="mm-filter-row">
            <span className="mm-filter-label">Edge types</span>
            <div
              className="mm-toggles"
              role="group"
              aria-label="Edge type filters"
            >
              {EDGE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mm-toggle ${visibleTypes[t] ? 'is-on' : ''}`}
                  aria-pressed={visibleTypes[t]}
                  onClick={() => setVisibleTypes((v) => ({ ...v, [t]: !v[t] }))}
                >
                  <span
                    className="mm-edge-swatch"
                    style={{ background: `var(--mm-${EDGE_KIND[t]})` }}
                    aria-hidden="true"
                  />
                  {t}
                  {data.meta.byType ? ` (${data.meta.byType[t]})` : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="mm-filter-row">
            <label className="mm-filter-slider">
              <span>Min connections: {minConnections}</span>
              <input
                type="range"
                min={0}
                max={model.maxConn}
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

      <div
        className="mm-legend"
        role="group"
        aria-label="Node kinds (toggle visibility)"
      >
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            className={`mm-legend-item ${visibleKinds[k] ? 'is-on' : ''}`}
            aria-pressed={visibleKinds[k]}
            aria-label={`${k} (${model.counts[k] ?? 0})`}
            onClick={() => setVisibleKinds((v) => ({ ...v, [k]: !v[k] }))}
          >
            <KindGlyph kind={k} />
            {k} <span className="mm-legend-count">{model.counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className="mm-canvas"
        role="img"
        aria-label={`Memory map: showing ${shown} of ${data.meta.nodeCount} nodes`}
      />

      {shown === 0 && (
        <div className="mm-empty" role="status">
          No nodes match the current filters.
          <button type="button" className="mm-toggle" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      )}

      {selected && (
        <aside className="mm-detail" aria-label="Selected node detail">
          <div className="mm-detail-head">
            <span className="mm-detail-kind">
              <KindGlyph kind={selected.kind} />
              {selected.kind}
            </span>
            <button
              type="button"
              className="mm-detail-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close detail"
            >
              ✕
            </button>
          </div>
          <div className="mm-detail-label">
            {cleanLabel(detail?.label ?? selected.label) || selected.id}
          </div>
          {detail &&
            detail.text.trim() &&
            detail.text.trim() !== detail.label && (
              <div className="mm-detail-text">{detail.text}</div>
            )}
          {detailQuery.isLoading && (
            <div className="mm-detail-note" role="status">
              Loading full text…
            </div>
          )}
          {detailQuery.isError && (
            <div className="mm-detail-note">Full text unavailable.</div>
          )}
          <dl className="mm-detail-meta">
            <dt>Connections</dt>
            <dd>{model.deg.get(selected.id) ?? 0}</dd>
            {detail?.createdAt && (
              <>
                <dt>Created</dt>
                <dd>{detail.createdAt.slice(0, 16).replace('T', ' ')}</dd>
              </>
            )}
            {detail?.updatedAt && (
              <>
                <dt>Updated</dt>
                <dd>{detail.updatedAt.slice(0, 16).replace('T', ' ')}</dd>
              </>
            )}
            {!detail?.createdAt && lastSeen && (
              <>
                <dt>Last seen</dt>
                <dd>{lastSeen.slice(0, 10)}</dd>
              </>
            )}
            {Object.entries(detail?.source ?? {}).map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k.replace(/_/g, ' ')}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
            <dt>ID</dt>
            <dd className="mm-detail-id">{selected.id}</dd>
          </dl>
          {selected.kind === 'wiki' && (
            <button
              type="button"
              className="mm-toggle is-on"
              onClick={() => openInWiki(selected.id)}
            >
              Open in Wiki
            </button>
          )}
          {neighbourGroups.length > 0 && (
            <div className="mm-detail-neighbours">
              {neighbourGroups.map((g) => (
                <section key={g.kind}>
                  <h4>
                    <KindGlyph kind={g.kind} />
                    {g.kind} · {g.nodes.length}
                  </h4>
                  <ul>
                    {g.nodes
                      .slice(0, expandedKinds.has(g.kind) ? NEIGHBOUR_MAX : 12)
                      .map((n) => (
                        <li key={n.id}>
                          <button type="button" onClick={() => focusNode(n.id)}>
                            {shortLabel(n, 48, model.dates.get(n.id) ?? null)}
                          </button>
                        </li>
                      ))}
                  </ul>
                  {g.nodes.length > 12 && (
                    <button
                      type="button"
                      className="mm-detail-more"
                      aria-expanded={expandedKinds.has(g.kind)}
                      onClick={() =>
                        setExpandedKinds((cur) => {
                          const next = new Set(cur)
                          if (next.has(g.kind)) next.delete(g.kind)
                          else next.add(g.kind)
                          return next
                        })
                      }
                    >
                      {expandedKinds.has(g.kind)
                        ? 'Show fewer'
                        : `+${g.nodes.length - 12} more`}
                    </button>
                  )}
                  {expandedKinds.has(g.kind) &&
                    g.nodes.length > NEIGHBOUR_MAX && (
                      <div className="mm-detail-note">
                        {g.nodes.length - NEIGHBOUR_MAX} more not listed
                      </div>
                    )}
                </section>
              ))}
            </div>
          )}
        </aside>
      )}

      <div className="mm-status" role="note">
        Showing {shown} of {visible.candidates} nodes
        {(limited || showAll) && (
          <button
            type="button"
            className="mm-link-btn"
            onClick={() => setShowAll((s) => !s)}
          >
            {showAll ? `Top ${DEFAULT_NODE_LIMIT}` : 'Show all'}
          </button>
        )}
        {data.meta.truncated && droppedEdges > 0 && (
          <span className="mm-status-warn">
            {' '}
            · {droppedEdges} edges cut by server limit
          </span>
        )}
      </div>
    </div>
  )
}
