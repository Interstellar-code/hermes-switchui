/**
 * memory-graph.ts — read-only builder for the Memory Map (issue #342).
 *
 * Reads the profile-scoped mnemosyne.db (never a request-supplied path) and
 * returns a deduplicated node/edge graph with server-truncated labels only.
 * Raw gist/fact text never leaves this module — labels are capped at
 * LABEL_MAX chars so the client can render without seeing private content.
 *
 * Node id shapes in graph_edges (verified against live schema):
 *   gist_*          → kind 'gist'  (label from gists.text)
 *   fact_*_N        → kind 'fact'  (label from facts.subject/predicate/object)
 *   path/to/x.md    → kind 'wiki'  (label = basename without extension)
 */

import fs from 'node:fs'
import Database from 'better-sqlite3'
import { getMnemosyneDbPath } from './mnemosyne-browser'

export const DEFAULT_LIMIT = 2000
export const MAX_LIMIT = 5000
const LABEL_MAX = 60
const IN_CHUNK = 400 // stay well under SQLite's default 999 bound-param ceiling

export type MemoryGraphKind = 'gist' | 'fact' | 'wiki'
export type MemoryGraphEdgeType = 'ctx' | 'references'

export type MemoryGraphNode = {
  id: string
  kind: MemoryGraphKind
  label: string
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
}

type RawEdgeRow = {
  source: string
  target: string
  edge_type: string
  occurrences: number
  weight: number | null
  timestamp: string | null
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
    },
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1",
      )
      .get(name),
  )
}

function classify(id: string): MemoryGraphKind {
  if (id.startsWith('gist_')) return 'gist'
  if (id.startsWith('fact_')) return 'fact'
  return 'wiki'
}

function truncateLabel(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > LABEL_MAX
    ? `${collapsed.slice(0, LABEL_MAX - 1)}…`
    : collapsed
}

function wikiLabel(id: string): string {
  const base = id.split('/').pop() ?? id
  return base.replace(/\.md$/i, '')
}

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Batched IN-lookup that respects SQLite's bound-parameter ceiling. */
function fetchLabelMap(
  db: Database.Database,
  ids: Array<string>,
  sql: (placeholders: string) => string,
  toEntry: (row: any) => [string, string],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const group of chunk(ids, IN_CHUNK)) {
    if (group.length === 0) continue
    const placeholders = group.map(() => '?').join(',')
    const rows = db.prepare(sql(placeholders)).all(...group) as Array<any>
    for (const row of rows) {
      const [key, value] = toEntry(row)
      map.set(key, value)
    }
  }
  return map
}

/**
 * Build the Memory Map graph. Missing DB or missing graph_edges table yields
 * an empty graph with meta.dbMissing=true (never throws for a fresh profile).
 * The returned objects are freshly constructed on every call, so downstream
 * D3 force/link mutations can never corrupt a shared/cached source.
 */
export function buildMemoryGraph(params: MemoryGraphParams = {}): MemoryGraph {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT)),
  )
  const edgeType = params.edgeType ?? null
  const since = params.since ?? null

  const dbPath = getMnemosyneDbPath()
  if (!fs.existsSync(dbPath)) return emptyGraph(true)

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    if (!tableExists(db, 'graph_edges')) return emptyGraph(true)

    const filter = {
      edgeType,
      since,
    }

    // rawEdgeCount: matching rows before dedup.
    const rawEdgeCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM graph_edges
           WHERE ($edgeType IS NULL OR edge_type = $edgeType)
             AND ($since IS NULL OR timestamp >= $since)`,
        )
        .get(filter) as { n: number }
    ).n

    // totalUnique: deduped groups matching filter (drives truncated flag).
    const totalUnique = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM (
             SELECT 1 FROM graph_edges
             WHERE ($edgeType IS NULL OR edge_type = $edgeType)
               AND ($since IS NULL OR timestamp >= $since)
             GROUP BY source, target, edge_type
           )`,
        )
        .get(filter) as { n: number }
    ).n

    const rawEdges = db
      .prepare(
        `SELECT source, target, edge_type,
                COUNT(*) AS occurrences,
                MAX(weight) AS weight,
                MAX(timestamp) AS timestamp
         FROM graph_edges
         WHERE ($edgeType IS NULL OR edge_type = $edgeType)
           AND ($since IS NULL OR timestamp >= $since)
         GROUP BY source, target, edge_type
         ORDER BY edge_type, source, target
         LIMIT $limit`,
      )
      .all({ ...filter, limit }) as Array<RawEdgeRow>

    const edges: Array<MemoryGraphEdge> = rawEdges
      // Only ctx/references are known kinds; drop anything unexpected.
      .filter(
        (r) => r.edge_type === 'ctx' || r.edge_type === 'references',
      )
      .map((r) => ({
        source: r.source,
        target: r.target,
        edgeType: r.edge_type as MemoryGraphEdgeType,
        weight: typeof r.weight === 'number' ? r.weight : 1,
        occurrences: r.occurrences,
        timestamp: r.timestamp ?? null,
      }))

    // Collect endpoint ids, resolve labels per kind.
    const nodeIds = new Set<string>()
    for (const e of edges) {
      nodeIds.add(e.source)
      nodeIds.add(e.target)
    }
    const ids = [...nodeIds]
    const gistIds = ids.filter((id) => classify(id) === 'gist')
    const factIds = ids.filter((id) => classify(id) === 'fact')

    const gistLabels = tableExists(db, 'gists')
      ? fetchLabelMap(
          db,
          gistIds,
          (p) => `SELECT id, text FROM gists WHERE id IN (${p})`,
          (row) => [row.id, truncateLabel(String(row.text ?? ''))],
        )
      : new Map<string, string>()

    const factLabels = tableExists(db, 'facts')
      ? fetchLabelMap(
          db,
          factIds,
          (p) =>
            `SELECT fact_id, subject, predicate, object FROM facts WHERE fact_id IN (${p})`,
          (row) => [
            row.fact_id,
            truncateLabel(
              `${row.subject ?? ''} ${row.predicate ?? ''} ${row.object ?? ''}`,
            ),
          ],
        )
      : new Map<string, string>()

    const nodes: Array<MemoryGraphNode> = ids.map((id) => {
      const kind = classify(id)
      let label: string
      if (kind === 'gist') label = gistLabels.get(id) || truncateLabel(id)
      else if (kind === 'fact') label = factLabels.get(id) || truncateLabel(id)
      else label = truncateLabel(wikiLabel(id))
      return { id, kind, label }
    })

    return {
      nodes,
      edges,
      meta: {
        rawEdgeCount,
        edgeCount: edges.length,
        nodeCount: nodes.length,
        truncated: totalUnique > limit,
        dbMissing: false,
        generatedAt: new Date().toISOString(),
      },
    }
  } finally {
    db.close()
  }
}
