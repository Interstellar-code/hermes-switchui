/**
 * memory-graph.ts — read-only builder for the full mnemosyne Memory Map (#342).
 *
 * Reads the profile-scoped mnemosyne.db (never a request path) and returns a
 * deduplicated node/edge graph with server-truncated labels only. Raw
 * gist/fact/memory text never leaves this module (labels capped at LABEL_MAX).
 *
 * The graph unifies several tables into one census so nodes actually
 * interconnect (graph_edges alone only has gist→fact + wiki→wiki):
 *
 *   Node kinds:
 *     gist     — gists.text            (the consolidated memory summary)
 *     working  — working_memory.content (only rows WITHOUT a matching gist;
 *                working_memory.id === gist hash, so 2783/2784 are the same
 *                memory as a gist and are NOT duplicated)
 *     fact     — facts.subject/predicate/object
 *     episodic — episodic_memory.content
 *     entity   — distinct subject/object/mention strings (the hubs)
 *     wiki     — wiki .md paths (from graph_edges 'references')
 *
 *   Edge types:
 *     ctx        gist → fact          (graph_edges)
 *     references wiki → wiki          (graph_edges)
 *     mentions   memory → entity      (annotations kind='mentions')  ← main web
 *     about      fact → entity        (facts subject & object)
 *     relates    entity → entity      (memoria_kg + triples S/O)
 *     summarizes episodic → memory    (episodic_memory.summary_of hashes)
 *
 * Memory nodes are keyed by hash: a bare hash referenced by annotations /
 * episodic.summary_of resolves to gist_<hash> when a gist exists, else wm_<hash>.
 *
 * Returned objects are freshly constructed every call, so downstream D3
 * force/link in-place mutation can never corrupt a shared/cached source.
 */

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { listKnowledgePages } from './knowledge-browser'
import { ENTITY_STOPWORDS, isJunkFact } from './memory-junk'
import { getMnemosyneDbPath } from './mnemosyne-browser'

export const DEFAULT_LIMIT = 20000
export const MAX_LIMIT = 100000
const LABEL_MAX = 60

const FACT_IDS_MAX = 50

export { isJunkFact }

/** Normalized subject|predicate|object key: identical facts share it. */
export function factKey(
  subject: string | null,
  predicate: string | null,
  object: string | null,
): string {
  return [subject, predicate, object]
    .map((x) =>
      String(x ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase(),
    )
    .join('|')
}

// Entities shorter than 3 chars are dropped unless they look like an acronym
// in their original case (PR, DB, UI, CI, KG). Entity ids keep source case.
function isJunkEntityId(id: string): boolean {
  if (!id.startsWith('entity:')) return false
  const raw = id.slice('entity:'.length).trim()
  if (raw.length < 3) return !/^[A-Z0-9]{2}$/.test(raw)
  return ENTITY_STOPWORDS.has(raw.toLowerCase())
}

const zeroByType = (): Record<MemoryGraphEdgeType, number> => ({
  ctx: 0,
  references: 0,
  mentions: 0,
  about: 0,
  relates: 0,
  summarizes: 0,
})

export type MemoryGraphKind =
  | 'gist'
  | 'fact'
  | 'wiki'
  | 'entity'
  | 'working'
  | 'episodic'

export type MemoryGraphEdgeType =
  | 'ctx'
  | 'references'
  | 'mentions'
  | 'about'
  | 'relates'
  | 'summarizes'

export const EDGE_TYPES: ReadonlyArray<MemoryGraphEdgeType> = [
  'ctx',
  'references',
  'mentions',
  'about',
  'relates',
  'summarizes',
]

export type MemoryGraphNode = {
  id: string
  kind: MemoryGraphKind
  label: string
  /** fact nodes only, when identical facts were collapsed into this one. */
  count?: number
  firstAt?: string | null
  lastAt?: string | null
  factIds?: Array<string>
}

export type MemoryGraphEdge = {
  source: string
  target: string
  edgeType: MemoryGraphEdgeType
  weight: number
  occurrences: number
  timestamp: string | null
}

export type MemoryGraphMeta = {
  rawEdgeCount: number
  edgeCount: number
  nodeCount: number
  truncated: boolean
  dbMissing: boolean
  generatedAt: string
  /** Raw edge rows dropped for touching a stopword / single-mention entity. */
  junkDropped: number
  /** Fragment facts hidden by isJunkFact (rows, not unique). */
  junkFacts: number
  /** Fact rows folded into an identical fact node. */
  duplicateFacts: number
  /** Edges kept per type after the limit cut. */
  byType: Record<MemoryGraphEdgeType, number>
  /** Edges dropped per type by the limit cut. */
  droppedByType: Record<MemoryGraphEdgeType, number>
}

export type MemoryGraph = {
  nodes: Array<MemoryGraphNode>
  edges: Array<MemoryGraphEdge>
  meta: MemoryGraphMeta
}

export type MemoryGraphParams = {
  limit?: number
  edgeType?: MemoryGraphEdgeType | null
  since?: string | null
  /** Validated profile name; absent = legacy hermes-switch DB. */
  profile?: string
}

function emptyGraph(dbMissing: boolean): MemoryGraph {
  return {
    nodes: [],
    edges: [],
    meta: {
      rawEdgeCount: 0,
      edgeCount: 0,
      nodeCount: 0,
      truncated: false,
      dbMissing,
      generatedAt: new Date().toISOString(),
      junkDropped: 0,
      junkFacts: 0,
      duplicateFacts: 0,
      byType: zeroByType(),
      droppedByType: zeroByType(),
    },
  }
}

export function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1",
      )
      .get(name),
  )
}

export function truncateLabel(text: unknown): string {
  const collapsed = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return collapsed.length > LABEL_MAX
    ? `${collapsed.slice(0, LABEL_MAX - 1)}…`
    : collapsed
}

export function wikiLabel(id: string): string {
  const base = id.split('/').pop() ?? id
  return base.replace(/\.md$/i, '')
}

/** Classify a bare edge-endpoint id when no node was pre-registered for it. */
export function classifyById(id: string): MemoryGraphKind {
  if (id.startsWith('gist_')) return 'gist'
  if (id.startsWith('wm_')) return 'working'
  if (id.startsWith('fact_')) return 'fact'
  if (id.startsWith('ep_')) return 'episodic'
  if (id.startsWith('entity:')) return 'entity'
  return 'wiki'
}

/** Read-only handle on a profile's mnemosyne DB; null if absent. */
export function openMemoryGraphDb(profile?: string): Database.Database | null {
  const dbPath = getMnemosyneDbPath(undefined, profile)
  if (!fs.existsSync(dbPath)) return null
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

export function buildMemoryGraph(params: MemoryGraphParams = {}): MemoryGraph {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT)),
  )
  const edgeType = params.edgeType ?? null
  const since = params.since ?? null

  const db = openMemoryGraphDb(params.profile)
  if (!db) return emptyGraph(true)
  try {
    // graph_edges is the minimum required table; without it there is no graph.
    if (!tableExists(db, 'graph_edges')) return emptyGraph(true)

    const nodes = new Map<string, MemoryGraphNode>()
    const addNode = (id: string, kind: MemoryGraphKind, label: string) => {
      const existing = nodes.get(id)
      if (existing) {
        if (!existing.label && label) existing.label = label
        return
      }
      nodes.set(id, { id, kind, label: label || '' })
    }
    // Identical facts collapse onto the first fact_id seen; junk facts vanish.
    // Applied to every edge endpoint so graph_edges ctx edges follow along.
    const factAlias = new Map<string, string>()
    const junkFactIds = new Set<string>()
    const ensureNode = (raw: string) => {
      // a folded duplicate fact resolves to its canonical node; a junk fact
      // never gets one (its edges are dropped in addEdge)
      const id = factAlias.get(raw) ?? raw
      if (nodes.has(id) || junkFactIds.has(id)) return
      const kind = classifyById(id)
      const label =
        kind === 'wiki'
          ? truncateLabel(wikiLabel(id))
          : kind === 'entity'
            ? truncateLabel(id.slice('entity:'.length))
            : truncateLabel(id)
      nodes.set(id, { id, kind, label })
    }

    // edge accumulator: key = source|target|edgeType
    const edgeMap = new Map<
      string,
      {
        source: string
        target: string
        edgeType: MemoryGraphEdgeType
        weight: number
        occurrences: number
        timestamp: string | null
      }
    >()
    let rawEdgeCount = 0
    let junkDropped = 0
    let junkFacts = 0
    let duplicateFacts = 0
    // Entities named by a fact/relation survive the min-degree filter.
    const factEntities = new Set<string>()
    const wantEdge = (t: MemoryGraphEdgeType) =>
      edgeType === null || edgeType === t
    const addEdge = (
      source: string,
      target: string,
      type: MemoryGraphEdgeType,
      weight: number,
      timestamp: string | null,
    ) => {
      source = factAlias.get(source) ?? source
      target = factAlias.get(target) ?? target
      if (!source || !target || source === target) return
      rawEdgeCount++
      if (junkFactIds.has(source) || junkFactIds.has(target)) {
        junkDropped++
        return
      }
      if (isJunkEntityId(source) || isJunkEntityId(target)) {
        junkDropped++
        return
      }
      const key = `${source}\u0000${target}\u0000${type}`
      const cur = edgeMap.get(key)
      if (cur) {
        cur.occurrences++
        if (weight > cur.weight) cur.weight = weight
        if (timestamp && (!cur.timestamp || timestamp > cur.timestamp))
          cur.timestamp = timestamp
      } else {
        edgeMap.set(key, {
          source,
          target,
          edgeType: type,
          weight,
          occurrences: 1,
          timestamp,
        })
      }
    }

    // ── memory hash resolution (gist wins; else working) ────────────────────
    const gistHashes = new Set<string>()
    if (tableExists(db, 'gists')) {
      for (const row of db
        .prepare('SELECT id, text FROM gists')
        .iterate() as Iterable<{
        id: string
        text: string
      }>) {
        addNode(row.id, 'gist', truncateLabel(row.text))
        if (row.id.startsWith('gist_')) gistHashes.add(row.id.slice(5))
      }
    }
    const memoryNodeId = (hash: string): string =>
      gistHashes.has(hash) ? `gist_${hash}` : `wm_${hash}`

    // working-only rows (no matching gist) become 'working' nodes.
    if (tableExists(db, 'working_memory')) {
      for (const row of db
        .prepare(
          `SELECT w.id AS id, w.content AS content
             FROM working_memory w
             LEFT JOIN gists g ON g.id = 'gist_' || w.id
            WHERE g.id IS NULL`,
        )
        .iterate() as Iterable<{ id: string; content: string }>) {
        addNode(`wm_${row.id}`, 'working', truncateLabel(row.content))
      }
    }

    // facts → nodes (+ entity strings collected via 'about' edges below)
    if (tableExists(db, 'facts')) {
      const byKey = new Map<
        string,
        { node: MemoryGraphNode; subj: string; obj: string }
      >()
      for (const row of db
        .prepare(
          // canonical node = first row by (timestamp, fact_id), as in Browse
          'SELECT * FROM facts ORDER BY timestamp, fact_id',
        )
        .iterate() as Iterable<{
        fact_id: string
        subject: string | null
        predicate: string | null
        object: string | null
        confidence: number | null
        timestamp: string | null
        created_at?: string | null
      }>) {
        if (isJunkFact(row.subject, row.predicate, row.object)) {
          junkFacts++
          junkFactIds.add(row.fact_id)
          continue
        }
        const key = factKey(row.subject, row.predicate, row.object)
        const ts = row.timestamp ?? null
        // "Seen" range: created_at is UTC (timestamp is zone-less local time)
        const seen = row.created_at ?? ts
        const hit = byKey.get(key)
        let subj = String(row.subject ?? '').trim()
        let obj = String(row.object ?? '').trim()
        if (hit) {
          // about edges land on the canonical fact's own entity spelling
          ;({ subj, obj } = hit)
          const twin = hit.node
          duplicateFacts++
          factAlias.set(row.fact_id, twin.id)
          twin.count = (twin.count ?? 1) + 1
          if (seen && (!twin.firstAt || seen < twin.firstAt))
            twin.firstAt = seen
          if (seen && (!twin.lastAt || seen > twin.lastAt)) twin.lastAt = seen
          if (twin.factIds!.length < FACT_IDS_MAX)
            twin.factIds!.push(row.fact_id)
        } else {
          addNode(
            row.fact_id,
            'fact',
            truncateLabel(
              `${row.subject ?? ''} ${row.predicate ?? ''} ${row.object ?? ''}`,
            ),
          )
          const node = nodes.get(row.fact_id)!
          Object.assign(node, {
            count: 1,
            firstAt: seen,
            lastAt: seen,
            factIds: [row.fact_id],
          })
          byKey.set(key, { node, subj, obj })
        }
        const factId = factAlias.get(row.fact_id) ?? row.fact_id
        const w = typeof row.confidence === 'number' ? row.confidence : 1
        if (subj) factEntities.add(`entity:${subj}`)
        if (obj) factEntities.add(`entity:${obj}`)
        if (wantEdge('about')) {
          if (subj) {
            const eid = `entity:${subj}`
            addNode(eid, 'entity', truncateLabel(subj))
            addEdge(factId, eid, 'about', w, ts)
          }
          if (obj) {
            const eid = `entity:${obj}`
            addNode(eid, 'entity', truncateLabel(obj))
            addEdge(factId, eid, 'about', w, ts)
          }
        }
      }
    }

    // episodic → nodes + summarizes edges (summary_of = comma-separated hashes)
    if (tableExists(db, 'episodic_memory')) {
      for (const row of db
        .prepare(
          'SELECT id, content, summary_of, timestamp FROM episodic_memory',
        )
        .iterate() as Iterable<{
        id: string
        content: string
        summary_of: string | null
        timestamp: string | null
      }>) {
        const epId = `ep_${row.id}`
        addNode(epId, 'episodic', truncateLabel(row.content))
        if (wantEdge('summarizes') && row.summary_of) {
          for (const raw of row.summary_of.split(',')) {
            const hash = raw.trim()
            if (!hash) continue
            const target = memoryNodeId(hash)
            ensureNode(target)
            addEdge(epId, target, 'summarizes', 1, row.timestamp ?? null)
          }
        }
      }
    }

    // ── graph_edges: ctx (gist→fact) + references (wiki→wiki) ────────────────
    const filter = { edgeType, since }
    for (const row of db
      .prepare(
        `SELECT source, target, edge_type, weight, timestamp
           FROM graph_edges
          WHERE ($edgeType IS NULL OR edge_type = $edgeType)
            AND ($since IS NULL OR timestamp >= $since)`,
      )
      .iterate(filter) as Iterable<{
      source: string
      target: string
      edge_type: string
      weight: number | null
      timestamp: string | null
    }>) {
      const type = row.edge_type as MemoryGraphEdgeType
      if (type !== 'ctx' && type !== 'references') continue
      if (!wantEdge(type)) continue
      ensureNode(row.source)
      ensureNode(row.target)
      addEdge(
        row.source,
        row.target,
        type,
        typeof row.weight === 'number' ? row.weight : 1,
        row.timestamp ?? null,
      )
    }

    // ── mentions: memory → entity (the main interconnector) ──────────────────
    if (wantEdge('mentions') && tableExists(db, 'annotations')) {
      for (const row of db
        .prepare(
          "SELECT memory_id, value, confidence FROM annotations WHERE kind = 'mentions'",
        )
        .iterate() as Iterable<{
        memory_id: string
        value: string | null
        confidence: number | null
      }>) {
        const value = String(row.value ?? '').trim()
        if (!value) continue
        const src = memoryNodeId(row.memory_id)
        const eid = `entity:${value}`
        ensureNode(src)
        addNode(eid, 'entity', truncateLabel(value))
        addEdge(
          src,
          eid,
          'mentions',
          typeof row.confidence === 'number' ? row.confidence : 1,
          null,
        )
      }
    }

    // ── relates: entity → entity (memoria_kg + triples) ──────────────────────
    if (wantEdge('relates')) {
      const relSources: Array<{ sql: string; ok: boolean }> = [
        {
          sql: 'SELECT subject, object, confidence FROM memoria_kg',
          ok: tableExists(db, 'memoria_kg'),
        },
        {
          sql: 'SELECT subject, object, confidence FROM triples',
          ok: tableExists(db, 'triples'),
        },
      ]
      for (const { sql, ok } of relSources) {
        if (!ok) continue
        for (const row of db.prepare(sql).iterate() as Iterable<{
          subject: string | null
          object: string | null
          confidence: number | null
        }>) {
          const s = String(row.subject ?? '').trim()
          const o = String(row.object ?? '').trim()
          if (!s || !o) continue
          const sid = `entity:${s}`
          const oid = `entity:${o}`
          factEntities.add(sid)
          factEntities.add(oid)
          addNode(sid, 'entity', truncateLabel(s))
          addNode(oid, 'entity', truncateLabel(o))
          addEdge(
            sid,
            oid,
            'relates',
            typeof row.confidence === 'number' ? row.confidence : 1,
            null,
          )
        }
      }
    }

    // ── wiki pages: every curated page is a node, linked or not ──────────────
    if (wantEdge('references')) {
      let pages: Array<{ path: string }> = []
      try {
        pages = listKnowledgePages(params.profile)
      } catch {
        // wiki dir unreadable → graph still renders from mnemosyne alone
      }
      for (const page of pages)
        addNode(page.path, 'wiki', truncateLabel(wikiLabel(page.path)))
    }

    // ── finalize: fair per-type cut, stable order ────────────────────────────
    // Water-fill the limit across edge types, rarest first, so a huge type
    // (mentions) can never starve the rest. Within a type keep the strongest.
    // Min-degree: an entity seen exactly once (and never in a fact/relation)
    // is noise — drop it with its single edge.
    const degree = new Map<string, number>()
    for (const e of edgeMap.values())
      for (const id of [e.source, e.target])
        degree.set(id, (degree.get(id) ?? 0) + 1)
    const isLonelyEntity = (id: string) =>
      id.startsWith('entity:') && degree.get(id) === 1 && !factEntities.has(id)
    for (const [key, e] of edgeMap) {
      if (isLonelyEntity(e.source) || isLonelyEntity(e.target)) {
        edgeMap.delete(key)
        junkDropped += e.occurrences
      }
    }

    const byTypeAll = new Map<MemoryGraphEdgeType, Array<MemoryGraphEdge>>()
    for (const e of edgeMap.values()) {
      const list = byTypeAll.get(e.edgeType)
      if (list) list.push(e)
      else byTypeAll.set(e.edgeType, [e])
    }
    const groups = [...byTypeAll.values()].sort((a, b) => a.length - b.length)
    const byType = zeroByType()
    const droppedByType = zeroByType()
    let edges: Array<MemoryGraphEdge> = []
    let budget = limit
    groups.forEach((group, i) => {
      // Every non-empty type gets >=1 edge while budget lasts.
      const take = Math.min(
        group.length,
        budget,
        Math.max(1, Math.floor(budget / (groups.length - i))),
      )
      budget -= take
      if (take < group.length)
        group.sort(
          (a, b) =>
            b.weight - a.weight ||
            b.occurrences - a.occurrences ||
            (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
            (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
        )
      edges.push(...group.slice(0, take))
      byType[group[0].edgeType] = take
      droppedByType[group[0].edgeType] = group.length - take
    })
    const truncated = edges.length < edgeMap.size
    edges = edges.sort((a, b) => {
      if (a.edgeType !== b.edgeType) return a.edgeType < b.edgeType ? -1 : 1
      if (a.source !== b.source) return a.source < b.source ? -1 : 1
      return a.target < b.target ? -1 : a.target > b.target ? 1 : 0
    })

    // Prune nodes the cut (or stopword filter) left edgeless; wiki pages stay.
    const linked = new Set<string>()
    for (const e of edges) {
      linked.add(e.source)
      linked.add(e.target)
    }

    const edgeDtos: Array<MemoryGraphEdge> = edges.map((e) => ({
      source: e.source,
      target: e.target,
      edgeType: e.edgeType,
      weight: e.weight,
      occurrences: e.occurrences,
      timestamp: e.timestamp,
    }))

    const nodeDtos: Array<MemoryGraphNode> = [...nodes.values()]
      .filter((n) => n.kind === 'wiki' || linked.has(n.id))
      .map((n) =>
        // dates/ids only matter once something was actually collapsed
        n.count && n.count > 1
          ? {
              id: n.id,
              kind: n.kind,
              label: n.label,
              count: n.count,
              firstAt: n.firstAt ?? null,
              lastAt: n.lastAt ?? null,
              factIds: n.factIds,
            }
          : { id: n.id, kind: n.kind, label: n.label },
      )

    return {
      nodes: nodeDtos,
      edges: edgeDtos,
      meta: {
        rawEdgeCount,
        edgeCount: edgeDtos.length,
        nodeCount: nodeDtos.length,
        truncated,
        dbMissing: false,
        generatedAt: new Date().toISOString(),
        junkDropped,
        junkFacts,
        duplicateFacts,
        byType,
        droppedByType,
      },
    }
  } finally {
    db.close()
  }
}
