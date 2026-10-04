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
 * Usability defaults: only the top DEFAULT_NODE_LIMIT nodes (toolbar select,
 * persisted in localStorage) are
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

import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  computeVisibleGraph,
  degreeMap,
  nodeDates,
  searchNodes,
  shortLabel,
} from './memory-map-graph'
import { useWikiFocusStore } from './wiki-focus-store'
import { MapInspector } from './map/map-inspector'
import {
  EDGE_KIND,
  EDGE_ORDER,
  KIND_ORDER,
  KIND_SHAPE,
  KindGlyph,
} from './map/map-kinds'
import { MapRail } from './map/map-rail'
import { computeClusters } from './map/clusters'
import {
  AGE_VARS,
  CLUSTER_SLOTS,
  ageOf,
  colourIndex,
  isDimmed,
  miniToSim,
  minimapTransform,
  nodeRadius,
  paletteFor,
  viewportRect,
} from './map/map-render'
import { resolveCssColor } from './map/palette'
import type { MapPalette, MiniTransform } from './map/map-render'
import type { Shape } from './map/map-kinds'
import type {
  ColourBy,
  EdgeType,
  GraphEdge,
  GraphNode,
  GraphResponse,
  Kind,
  MapViewState,
} from './memory-map-graph'
import type {
  Simulation,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from 'd3-force'
import type { ZoomTransform } from 'd3-zoom'
import { useMemoryScreenStore } from '@/stores/memory-screen-store'
import '@/styles/matrix-memory-map.css'

type SimNode = GraphNode &
  SimulationNodeDatum & {
    deg: number
    /** cluster id (-1 = Other) */
    cl: number
    /** recency 0..1, null = undated */
    age: number | null
    /** colour bucket for the current colour-by mode */
    ci: number
    /** KIND_ORDER index (shape bucket) */
    ki: number
    /** cached label text */
    lt?: string
  }
type SimEdge = Omit<GraphEdge, 'source' | 'target'> &
  SimulationLinkDatum<SimNode> & {
    source: string | SimNode
    target: string | SimNode
  }

// ── palette / geometry ──────────────────────────────────────────────────────

// Used only when the theme vars can't be read (e.g. stylesheet missing).
const FALLBACK_COLOR: Record<Kind, string> = {
  gist: '#00ff41',
  working: '#7dffa8',
  fact: '#5fcfff',
  entity: '#ffb347',
  episodic: '#c792ea',
  wiki: '#ff6b9d',
}
const EDGE_ALPHA: Record<EdgeType, number> = {
  ctx: 0.3,
  references: 0.45,
  mentions: 0.12,
  about: 0.22,
  relates: 0.55,
  summarizes: 0.3,
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
// Focused default: chat-log episodes are the noise. `mentions` stays on: it
// is ~70% of edges, and without it the top-300 view splits into ~23 islands
// (one connected component with it, live hermes-switch data 2026-10).
const DEFAULT_TYPES: Record<EdgeType, boolean> = ALL_TYPES_ON
const DEFAULT_KINDS: Record<Kind, boolean> = {
  ...ALL_KINDS_ON,
  episodic: false,
}

const TAU = Math.PI * 2
// ponytail: labels are the costliest draw call; cap per frame
const LABEL_MAX = 150
/** hovered/selected node: label its top neighbours by degree, at any zoom */
const NEIGHBOR_LABEL_MAX = 40
/** alpha for nodes outside the search / neighbourhood / selected cluster */
const DIM_ALPHA = 0.12
// preallocated pass lists so the draw loop allocates nothing per frame
const PASS_NORMAL: ReadonlyArray<boolean> = [false]
const PASS_DIM_FIRST: ReadonlyArray<boolean> = [true, false]
const MINI_W = 150
const MINI_H = 96
const LIMIT_OPTIONS = [500, 1000, 2000, 5000] as const
const LIMIT_KEY = 'memory-map-node-limit'

/** Persisted node-limit choice: a number, or null for "All". */
function readLimit(): number | null {
  try {
    const v = localStorage.getItem(LIMIT_KEY)
    if (v === 'all') return null
    const n = Number(v)
    if ((LIMIT_OPTIONS as ReadonlyArray<number>).includes(n)) return n
  } catch {
    /* storage blocked */
  }
  return DEFAULT_NODE_LIMIT
}

function radiusOf(n: SimNode): number {
  return nodeRadius(n.kind, n.deg)
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

function readPalette(el: HTMLElement): MapPalette {
  const v = (name: string, fb: string) => resolveCssColor(el, name, fb)
  const kind = {} as Record<Kind, string>
  for (const k of KIND_ORDER) kind[k] = v(`--mm-${k}`, FALLBACK_COLOR[k])
  const muted = v('--theme-muted', '#6b8f74')
  return {
    kind,
    cluster: [
      ...Array.from({ length: CLUSTER_SLOTS }, (_, i) =>
        v(`--mm-cluster-${i}`, muted),
      ),
      v('--mm-cluster-other', muted),
    ],
    // ramp + "undated" (muted) last
    age: [
      ...AGE_VARS.map((name) => v(name, muted)),
      v('--mm-cluster-other', muted),
    ],
    text: v('--theme-text', '#d8ffe3'),
    bg: v('--theme-bg', '#020804'),
    accent: v('--theme-accent', '#00ff41'),
    edge: muted,
  }
}

// Top-layer popovers have no anchor; place under the invoking button.
function placePopBelow(e: React.ToggleEvent<HTMLElement>) {
  if (e.newState !== 'open') return
  const pop = e.currentTarget
  const btn = pop.previousElementSibling
  if (!btn) return
  const r = btn.getBoundingClientRect()
  // still display:none here; the computed width is the CSS-declared one
  const w = parseFloat(getComputedStyle(pop).width) || 280
  pop.style.top = `${r.bottom + 6}px`
  pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`
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
  const miniRef = useRef<HTMLCanvasElement | null>(null)
  const controlsRef = useRef<HTMLDivElement | null>(null)
  const edgesPopId = useId()
  const apiRef = useRef<MapApi | null>(null)
  // node positions survive a refetch (data identity change)
  const posRef = useRef(new Map<string, { x: number; y: number }>())

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [visibleTypes, setVisibleTypes] = useState(DEFAULT_TYPES)
  const [visibleKinds, setVisibleKinds] = useState(DEFAULT_KINDS)
  const [minConnections, setMinConnections] = useState(0)
  // MapViewState slots; G drives focus.
  const [colourBy, setColourBy] = useState<ColourBy>('cluster')
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)
  const [focus, setFocus] = useState<MapViewState['focus']>(null)
  // null = every node that passes the filters ("Show all")
  const [nodeLimit, setNodeLimitState] = useState<number | null>(readLimit)
  const showAll = nodeLimit == null
  // the status-line toggle returns here from "Show all"
  const [lastLimit, setLastLimit] = useState(nodeLimit ?? DEFAULT_NODE_LIMIT)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [activeResult, setActiveResult] = useState(0)
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

  // Full dataset, not the visible subset: colours stay stable under filters.
  const clusters = useMemo(
    () => computeClusters(data.nodes, data.edges),
    [data],
  )

  const visible = useMemo(
    () =>
      computeVisibleGraph(data.nodes, data.edges, {
        kinds: visibleKinds,
        types: visibleTypes,
        minDegree: minConnections,
        limit: nodeLimit,
        pinned: selectedId,
      }),
    [data, visibleKinds, visibleTypes, minConnections, nodeLimit, selectedId],
  )

  const results = useMemo(
    () => searchNodes(model.searchIndex, search, model.deg),
    [search, model],
  )

  // live refs so interaction state reaches the draw loop without rebuilding it
  // matchIds: null = no active search (nothing dimmed)
  const matchIds = search.trim() ? results.ids : null
  const stateRef = useRef({ selectedId, matchIds, colourBy, selectedCluster })
  stateRef.current = { selectedId, matchIds, colourBy, selectedCluster }

  useEffect(() => {
    const wrapEl = wrapRef.current
    const canvas = canvasRef.current
    if (!wrapEl || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const mini = miniRef.current
    const mctx = mini?.getContext('2d') ?? null

    const reduced = prefersReducedMotion()
    const dpr = Math.min(
      2,
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    )
    let palette = readPalette(wrapEl)

    // clone DTOs — d3-force mutates node/link objects in place.
    const positions = posRef.current
    // age = recency of last-seen within the dataset's time span
    const lastT = new Map<string, number>()
    let tMin = Infinity
    let tMax = -Infinity
    for (const n of data.nodes) {
      const iso = model.dates.get(n.id)?.last ?? n.lastAt
      const t = iso ? Date.parse(iso) : NaN
      if (!Number.isFinite(t)) continue
      lastT.set(n.id, t)
      if (t < tMin) tMin = t
      if (t > tMax) tMax = t
    }
    const nodes: Array<SimNode> = data.nodes.map((n) => ({
      ...n,
      ...positions.get(n.id),
      deg: model.deg.get(n.id) ?? 0,
      cl: clusters.clusterOf.get(n.id) ?? -1,
      age: ageOf(lastT.get(n.id), tMin, tMax),
      ci: 0,
      ki: KIND_ORDER.indexOf(n.kind),
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
    if (mini) {
      mini.width = MINI_W * dpr
      mini.height = MINI_H * dpr
    }

    const linkForce = forceLink<SimNode, SimEdge>([])
      .id((d) => d.id)
      .distance((d) => (d.edgeType === 'mentions' ? 40 : 28))
      .strength(0.15)
    const chargeForce = forceManyBody<SimNode>().strength(-14).distanceMax(400)
    const collideForce = forceCollide<SimNode>()
      .radius((d) => radiusOf(d) + 1)
      .iterations(1)
    // dev-only perf hook: Playwright reads the settle time of one layout run
    // (drag re-heats leave simStart at 0 and are not recorded)
    let simStart = 0
    function markSettled() {
      if (!import.meta.env.DEV || simStart === 0) return
      ;(window as { __mmSettleMs?: number }).__mmSettleMs = Math.round(
        performance.now() - simStart,
      )
      simStart = 0
      canvas!.dataset.settled = '1'
    }
    const sim = forceSimulation<SimNode, SimEdge>([])
      .force('link', linkForce)
      .force('charge', chargeForce)
      .force('center', forceCenter(width / 2, height / 2))
      .force('x', forceX(width / 2).strength(0.02))
      .force('y', forceY(height / 2).strength(0.02))
      .force('collide', collideForce)
      .alphaDecay(0.03)
      .stop()

    // ── visible subset (rebuilt on filter change, not per frame) ────────────
    let visNodes: Array<SimNode> = []
    let visIds = new Set<string>()
    let visEdgeKey = ''
    // draw batches: one path per (shape, colour) — ≤ 6 shapes × 9 colours
    let groups: Array<{ shape: Shape; ci: number; nodes: Array<SimNode> }> = []
    let groupMode: ColourBy | null = null
    function regroup(mode: ColourBy) {
      groupMode = mode
      const byKey = new Map<number, (typeof groups)[number]>()
      for (const n of visNodes) {
        n.ci = colourIndex(mode, n.kind, n.cl, n.age)
        const key = n.ki * 16 + n.ci
        const g = byKey.get(key)
        if (g) g.nodes.push(n)
        else byKey.set(key, { shape: KIND_SHAPE[n.kind], ci: n.ci, nodes: [n] })
      }
      groups = [...byKey.values()]
      dotsDirty = miniDirty = true
    }
    const edgesByType = new Map<EdgeType, Array<SimEdge>>()
    const visAdj = new Map<string, Array<SimNode>>()
    // label LOD: hubs by visible degree, most-connected first
    let hubs: Array<SimNode> = []

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
      for (const id of nodeIds) {
        const n = nodeById.get(id)
        if (n) visNodes.push(n)
      }
      groupMode = null
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
      hubs = visNodes
        .filter((n) => n.kind === 'entity' || n.kind === 'wiki')
        .sort(
          (a, b) =>
            (visAdj.get(b.id)?.length ?? 0) - (visAdj.get(a.id)?.length ?? 0),
        )

      // Cheaper sim for big subsets: Barnes-Hut is O(n log n) per tick but the
      // constant bites at a few thousand nodes, so cool faster and loosen
      // theta; collide is skipped entirely past 3000 nodes.
      const big = visNodes.length > 1000
      sim.alphaDecay(big ? 0.05 : 0.03)
      chargeForce.theta(big ? 1.2 : 0.9)
      collideForce.iterations(visNodes.length > 3000 ? 0 : 1)

      if (import.meta.env.DEV) {
        simStart = performance.now()
        delete canvas!.dataset.settled
      }
      if (reduced) {
        sim.stop()
        // sync ticks block the main thread; scale down for big subsets
        const n = visNodes.length
        sim.tick(n <= 1000 ? 200 : n <= 3000 ? 80 : 40)
        if (!fitted) {
          fitted = true
          fit(false)
        }
        scheduleDraw()
        markSettled()
      } else {
        sim.alpha(fitted ? 0.4 : 1).restart()
      }
    }

    // ── drawing ───────────────────────────────────────────────────────────
    // active (hover/selected) neighbourhood, cached until the active node or
    // the visible set changes: the id set for dimming + neighbours by degree
    let nbFor: string | null = null
    let nbVis: Set<string> | null = null
    const nbIds = new Set<string>()
    let nbByDeg: Array<SimNode> = []
    function neighborhood(activeId: string | null): Set<string> {
      if (activeId === nbFor && visIds === nbVis) return nbIds
      nbFor = activeId
      nbVis = visIds
      nbIds.clear()
      nbByDeg = []
      if (!activeId) return nbIds
      nbIds.add(activeId)
      for (const m of visAdj.get(activeId) ?? []) {
        if (nbIds.has(m.id)) continue
        nbIds.add(m.id)
        nbByDeg.push(m)
      }
      nbByDeg.sort((a, b) => b.deg - a.deg)
      return nbIds
    }
    // per-frame label scratch, reused (cleared) instead of reallocated
    const labelled: Array<SimNode> = []
    const labelIds = new Set<string>()
    const labelTexts = new Set<string>()
    let raf = 0
    let miniDirty = true
    let lastMini = 0
    function draw() {
      const {
        selectedId: sel,
        matchIds: hits,
        colourBy: mode,
        selectedCluster: selCl,
      } = stateRef.current
      if (groupMode !== mode) regroup(mode)
      const activeId =
        (hoverId && visIds.has(hoverId) ? hoverId : null) ??
        (sel && visIds.has(sel) ? sel : null)
      const neighbors = neighborhood(activeId)

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

      // edges, batched per type; fade when zoomed out on a dense subset.
      // With a cluster selected, edges leaving it get a faint second pass.
      c.lineWidth = Math.max(0.3, Math.min(1, transform.k)) / transform.k
      const edgeFade =
        visNodes.length > 600 && transform.k < 0.8
          ? Math.max(0.35, transform.k / 0.8)
          : 1
      const edgePasses = selCl == null ? PASS_NORMAL : PASS_DIM_FIRST
      for (const type of EDGE_ORDER) {
        const bucket = edgesByType.get(type)
        if (!bucket) continue
        c.strokeStyle =
          mode === 'kind' ? palette.kind[EDGE_KIND[type]] : palette.edge
        const base = activeId
          ? Math.min(1, EDGE_ALPHA[type] * 2)
          : EDGE_ALPHA[type] * edgeFade
        for (const dimPass of edgePasses) {
          c.globalAlpha = dimPass ? base * DIM_ALPHA : base
          c.beginPath()
          for (const e of bucket) {
            const s = e.source as SimNode
            const t = e.target as SimNode
            if (s.x == null || s.y == null || t.x == null || t.y == null)
              continue
            if (activeId && s.id !== activeId && t.id !== activeId) continue
            if (selCl != null && (s.cl !== selCl || t.cl !== selCl) !== dimPass)
              continue
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
      }

      // nodes: dimmed batches first (underneath), then normal ones
      const colours = paletteFor(mode, palette)
      const dimState = {
        hits,
        neighbors: activeId ? neighbors : null,
        selectedCluster: selCl,
      }
      const anyDim = hits != null || activeId != null || selCl != null
      const matched: Array<SimNode> = []
      for (const dimPass of anyDim ? PASS_DIM_FIRST : PASS_NORMAL) {
        c.globalAlpha = dimPass ? DIM_ALPHA : 1
        for (const g of groups) {
          c.beginPath()
          let any = false
          for (const n of g.nodes) {
            if (n.x == null || n.y == null || !onScreen(n)) continue
            // the active / selected node itself never dims
            const dim =
              anyDim &&
              n.id !== activeId &&
              n.id !== sel &&
              isDimmed(n.id, n.cl, dimState)
            if (dim !== dimPass) continue
            if (!dimPass && hits?.has(n.id)) matched.push(n)
            const r = radiusOf(n)
            tracePath(c, g.shape, n.x, n.y, g.shape === 'ring' ? r - 0.7 : r)
            any = true
          }
          if (!any) continue
          if (g.shape === 'ring') {
            c.lineWidth = 1.4
            c.strokeStyle = colours[g.ci]
            c.stroke()
          } else {
            c.fillStyle = colours[g.ci]
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
          radiusOf(n) + 2 / transform.k,
        )
        c.stroke()
      }
      if (matched.length > 0) {
        c.beginPath()
        for (const n of matched)
          tracePath(c, KIND_SHAPE[n.kind], n.x!, n.y!, radiusOf(n))
        c.stroke()
      }

      // labels (LOD): selected, hovered and search hits always; then the
      // active node's top neighbours by degree (any zoom, capped, identical
      // text once); else entity/wiki hubs (within the selected cluster) —
      // the biggest few when zoomed out, more as you zoom in.
      labelled.length = 0
      labelIds.clear()
      labelTexts.clear()
      const addLabel = (n: SimNode | undefined): boolean => {
        if (labelled.length >= LABEL_MAX || !n || labelIds.has(n.id))
          return false
        if (n.x == null || !onScreen(n)) return false
        n.lt ??= shortLabel(n, 28, model.dates.get(n.id)?.last ?? null)
        if (labelTexts.has(n.lt)) return false
        labelIds.add(n.id)
        labelTexts.add(n.lt)
        labelled.push(n)
        return true
      }
      if (sel && visIds.has(sel)) addLabel(nodeById.get(sel))
      if (activeId) addLabel(nodeById.get(activeId))
      for (const n of matched) addLabel(n)
      const k = transform.k
      if (activeId) {
        for (let i = 0, added = 0; i < nbByDeg.length; i++) {
          if (added >= NEIGHBOR_LABEL_MAX) break
          if (addLabel(nbByDeg[i])) added++
        }
      } else {
        const hubCap = k >= 1.4 ? LABEL_MAX : k >= 0.9 ? 50 : k >= 0.6 ? 25 : 10
        for (let i = 0, added = 0; i < hubs.length && added < hubCap; i++) {
          if (selCl != null && hubs[i].cl !== selCl) continue
          if (addLabel(hubs[i])) added++
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
          const lx = n.x! + radiusOf(n) + 3 / transform.k
          const ly = n.y! + fs * 0.35
          c.strokeText(n.lt!, lx, ly)
          c.fillText(n.lt!, lx, ly)
        }
      }
      c.restore()

      if (miniDirty || dotsCl !== selCl) drawMini()
    }

    // ── minimap: dots cached offscreen; a pan/zoom only blits + strokes ─────
    let miniT: MiniTransform | null = null
    const dots =
      mctx && typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null
    const dctx = dots?.getContext('2d') ?? null
    if (dots) {
      dots.width = MINI_W * dpr
      dots.height = MINI_H * dpr
    }
    let dotsDirty = true
    let dotsCl: number | null = null
    function drawDots(selCl: number | null) {
      dotsDirty = false
      dotsCl = selCl
      lastMini = performance.now()
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of visNodes) {
        if (n.x == null || n.y == null) continue
        if (n.x < minX) minX = n.x
        if (n.x > maxX) maxX = n.x
        if (n.y < minY) minY = n.y
        if (n.y > maxY) maxY = n.y
      }
      miniT = Number.isFinite(minX)
        ? minimapTransform({ minX, minY, maxX, maxY }, MINI_W, MINI_H)
        : null
      if (!dctx) return
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dctx.clearRect(0, 0, MINI_W, MINI_H)
      const mt = miniT
      if (!mt) return
      const colours = paletteFor(stateRef.current.colourBy, palette)
      // with a cluster selected, the rest fade as on the main canvas
      for (const dimPass of selCl == null ? PASS_NORMAL : PASS_DIM_FIRST) {
        dctx.globalAlpha = dimPass ? DIM_ALPHA : 0.8
        for (const g of groups) {
          dctx.beginPath()
          for (const n of g.nodes) {
            if (n.x == null || n.y == null) continue
            if (selCl != null && (n.cl !== selCl) !== dimPass) continue
            dctx.rect(
              n.x * mt.k + mt.x - 0.75,
              n.y * mt.k + mt.y - 0.75,
              1.5,
              1.5,
            )
          }
          dctx.fillStyle = colours[g.ci]
          dctx.fill()
        }
      }
      dctx.globalAlpha = 1
    }
    function drawMini() {
      miniDirty = false
      if (!mctx) return
      const selCl = stateRef.current.selectedCluster
      if (dotsDirty || dotsCl !== selCl) drawDots(selCl)
      mctx.setTransform(1, 0, 0, 1, 0, 0)
      mctx.clearRect(0, 0, mini!.width, mini!.height)
      if (dots) mctx.drawImage(dots, 0, 0)
      if (!miniT) return
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const r = viewportRect(transform, width, height, miniT)
      mctx.strokeStyle = palette.accent
      mctx.lineWidth = 1
      mctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    function scheduleDraw() {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        draw()
      })
    }
    sim.on('tick', () => {
      // minimap follows the layout at ~2 Hz while it settles
      if (performance.now() - lastMini > 500) dotsDirty = miniDirty = true
      scheduleDraw()
    })
    sim.on('end', () => {
      dotsDirty = miniDirty = true
      scheduleDraw()
      markSettled()
      if (!fitted) {
        fitted = true
        fit()
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
        // user took control during the first layout: don't auto-fit over it
        if (event.sourceEvent) fitted = true
        transform = event.transform
        miniDirty = true
        scheduleDraw()
      })
    const canvasSel = select(canvas)
    canvasSel.call(zoomBehavior as any)
    const moveTo = (t: ZoomTransform, animate = true) =>
      canvasSel
        .transition()
        .duration(animate && !reduced ? 450 : 0)
        .call(zoomBehavior.transform as any, t)

    /** Centre of the canvas area not covered by the rail / open inspector. */
    function viewCentre(): [number, number] {
      const railW =
        parseFloat(getComputedStyle(wrapEl!).getPropertyValue('--mm-rail-w')) ||
        0
      const insp = wrapEl!.querySelector<HTMLElement>('.mm-detail')
      const inspW = insp ? insp.offsetWidth + 24 : 0
      return [(railW + width - inspW) / 2, height / 2]
    }

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
      // keep the graph clear of the left rail (MapRail sets --mm-rail-w)
      const railW =
        parseFloat(getComputedStyle(wrapEl!).getPropertyValue('--mm-rail-w')) ||
        0
      const fitW = width - railW
      const k = Math.max(
        0.05,
        Math.min(
          4,
          Math.min(
            fitW / (maxX - minX + pad * 2),
            height / (maxY - minY + pad * 2),
          ),
        ),
      )
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      moveTo(
        zoomIdentity
          .translate(railW + fitW / 2 - k * cx, height / 2 - k * cy)
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

    // ── minimap: click / drag centres the view there; arrows pan ────────────
    let miniDrag = false
    function miniPan(ev: PointerEvent) {
      if (!miniT) return
      const rect = mini!.getBoundingClientRect()
      const [sx, sy] = miniToSim(
        ev.clientX - rect.left,
        ev.clientY - rect.top,
        miniT,
      )
      fitted = true
      canvasSel.interrupt()
      zoomBehavior.translateTo(canvasSel as any, sx, sy, viewCentre())
    }
    function onMiniDown(ev: PointerEvent) {
      if (ev.button !== 0) return
      miniDrag = true
      mini!.setPointerCapture(ev.pointerId)
      miniPan(ev)
    }
    function onMiniMove(ev: PointerEvent) {
      if (miniDrag) miniPan(ev)
    }
    function onMiniUp(ev: PointerEvent) {
      miniDrag = false
      if (mini!.hasPointerCapture(ev.pointerId))
        mini!.releasePointerCapture(ev.pointerId)
    }
    function onMiniKey(ev: KeyboardEvent) {
      if (ev.key === 'Home' || ev.key === '0') {
        ev.preventDefault()
        fit()
        return
      }
      const step = 80 / transform.k
      const d: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      }
      const v = d[ev.key] as [number, number] | undefined
      if (!v) return
      ev.preventDefault()
      fitted = true
      zoomBehavior.translateBy(canvasSel as any, v[0], v[1])
    }
    mini?.addEventListener('pointerdown', onMiniDown)
    mini?.addEventListener('pointermove', onMiniMove)
    mini?.addEventListener('pointerup', onMiniUp)
    mini?.addEventListener('pointercancel', onMiniUp)
    mini?.addEventListener('keydown', onMiniKey)

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
      miniDirty = true
      sim.force('center', forceCenter(width / 2, height / 2))
      sim.force('x', forceX(width / 2).strength(0.02))
      sim.force('y', forceY(height / 2).strength(0.02))
      scheduleDraw()
    })
    ro.observe(wrapEl)
    const mo = new MutationObserver(() => {
      palette = readPalette(wrapEl)
      dotsDirty = miniDirty = true
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
        const [cx, cy] = viewCentre()
        moveTo(zoomIdentity.translate(cx - k * n.x, cy - k * n.y).scale(k))
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
      mini?.removeEventListener('pointerdown', onMiniDown)
      mini?.removeEventListener('pointermove', onMiniMove)
      mini?.removeEventListener('pointerup', onMiniUp)
      mini?.removeEventListener('pointercancel', onMiniUp)
      mini?.removeEventListener('keydown', onMiniKey)
      apiRef.current = null
    }
    // Rebuild only when the dataset changes; interaction reads via stateRef.
  }, [data, model, clusters])

  // the toolbar wraps at narrow widths: rail / inspector start below it
  useEffect(() => {
    const el = controlsRef.current
    const wrap = wrapRef.current
    if (!el || !wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() =>
      wrap.style.setProperty(
        '--mm-rail-top',
        `${el.offsetTop + el.offsetHeight + 8}px`,
      ),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
  }, [selectedId, matchIds, colourBy, selectedCluster])

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
  function setNodeLimit(limit: number | null) {
    setNodeLimitState(limit)
    if (limit != null) setLastLimit(limit)
    try {
      localStorage.setItem(LIMIT_KEY, limit == null ? 'all' : String(limit))
    } catch {
      /* storage blocked */
    }
  }

  function resetFilters() {
    setVisibleTypes(DEFAULT_TYPES)
    setVisibleKinds(DEFAULT_KINDS)
    setMinConnections(0)
  }

  const selected = selectedId ? model.byId.get(selectedId) : undefined

  const showResults = resultsOpen && search.trim().length > 0
  const activeIdx = Math.min(
    activeResult,
    Math.max(0, results.matches.length - 1),
  )
  const shown = visible.nodeIds.size
  const limited = !showAll && visible.candidates > nodeLimit
  const droppedEdges = data.meta.rawEdgeCount - data.meta.edgeCount

  return (
    <div
      className="mm-wrap"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selectedId) setSelectedId(null)
      }}
    >
      <div className="mm-controls" ref={controlsRef}>
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
                      {shortLabel(n, 60, model.dates.get(n.id)?.last ?? null)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <select
          className="mm-toggle mm-limit"
          aria-label="Maximum nodes shown"
          title="Maximum nodes shown"
          value={nodeLimit ?? 'all'}
          onChange={(e) =>
            setNodeLimit(
              e.target.value === 'all' ? null : Number(e.target.value),
            )
          }
        >
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} nodes
            </option>
          ))}
          <option value="all">All nodes</option>
        </select>
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
        <div className="mm-pill" role="note">
          <span>
            {shown.toLocaleString()}
            <span className="mm-pill-long"> of </span>
            <span className="mm-pill-short" aria-hidden="true">
              /
            </span>
            {visible.candidates.toLocaleString()}
            <span className="mm-pill-long"> shown</span>
          </span>
          {(limited || showAll) && (
            <button
              type="button"
              className="mm-link-btn"
              onClick={() => setNodeLimit(showAll ? lastLimit : null)}
            >
              {showAll ? `Top ${lastLimit}` : 'Show all'}
            </button>
          )}
          {(data.meta.junkFacts ?? 0) > 0 && (
            <span>
              · {data.meta.junkFacts!.toLocaleString()} junk
              <span className="mm-pill-long"> hidden</span>
            </span>
          )}
          {data.meta.truncated && droppedEdges > 0 && (
            <>
              <button
                type="button"
                className="mm-link-btn mm-status-warn"
                popoverTarget={edgesPopId}
                aria-label={`Edges trimmed: ${droppedEdges} edges cut by the server limit. More info`}
                onKeyDown={(e) => {
                  // Escape closes the popover only, not the inspector too
                  if (
                    e.key === 'Escape' &&
                    document
                      .getElementById(edgesPopId)
                      ?.matches(':popover-open')
                  )
                    e.stopPropagation()
                }}
              >
                · edges<span className="mm-pill-long"> trimmed</span> ⓘ
              </button>
              <div
                id={edgesPopId}
                className="mm-pill-pop"
                popover="auto"
                onBeforeToggle={placePopBelow}
              >
                {droppedEdges.toLocaleString()} of{' '}
                {data.meta.rawEdgeCount.toLocaleString()} edges were cut by the
                server&apos;s edge limit, so some links between shown nodes are
                missing. Nodes are unaffected.
              </div>
            </>
          )}
        </div>
      </div>

      <MapRail
        colourBy={colourBy}
        clusters={clusters}
        defaultTypes={DEFAULT_TYPES}
        defaultKinds={DEFAULT_KINDS}
        selectedCluster={selectedCluster}
        onColourBy={setColourBy}
        onSelectCluster={setSelectedCluster}
        byType={data.meta.byType}
        counts={model.counts}
        maxConn={model.maxConn}
        types={visibleTypes}
        kinds={visibleKinds}
        minDegree={minConnections}
        onToggleType={(t) => setVisibleTypes((v) => ({ ...v, [t]: !v[t] }))}
        onToggleKind={(k) => setVisibleKinds((v) => ({ ...v, [k]: !v[k] }))}
        onMinConnections={setMinConnections}
        onReset={resetFilters}
      />

      <canvas
        ref={canvasRef}
        tabIndex={-1}
        className="mm-canvas"
        role="img"
        aria-label={`Memory map: showing ${shown} of ${data.meta.nodeCount} nodes`}
      />

      <div className="mm-zoom" role="group" aria-label="Zoom controls">
        <button
          type="button"
          className="mm-zoom-btn"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => apiRef.current?.zoomBy(1.4)}
        >
          +
        </button>
        <button
          type="button"
          className="mm-zoom-btn"
          aria-label="Zoom out"
          title="Zoom out"
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
      </div>
      <canvas
        ref={miniRef}
        className="mm-minimap"
        tabIndex={0}
        role="application"
        aria-roledescription="minimap"
        width={MINI_W}
        height={MINI_H}
        aria-label="Click or drag to move the view; arrow keys pan, Home or 0 fits"
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
        <MapInspector
          profile={profile}
          selected={selected}
          model={model}
          clusters={clusters}
          onClose={() => {
            setSelectedId(null)
            canvasRef.current?.focus({ preventScroll: true })
          }}
          onFocusNode={focusNode}
          onFocus={(id) =>
            setFocus({
              id,
              hops: 2,
              types: new Set(EDGE_ORDER.filter((t) => visibleTypes[t])),
            })
          }
          onOpenInWiki={openInWiki}
        />
      )}
    </div>
  )
}
