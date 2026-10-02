/**
 * memory-graph-node — full detail for one Memory Map node
 * (GET /api/memory/graph/node?id=…).
 *
 * The graph endpoint only ships 60-char labels; this resolves a single node id
 * back to its source row in the mnemosyne DB (read-only, parameterized) or,
 * for wiki nodes, to the knowledge page (readKnowledgePage is root-checked).
 */

import { readKnowledgePage } from './knowledge-browser'
import {
  classifyById,
  factKey,
  isJunkFact,
  openMemoryGraphDb,
  tableExists,
  truncateLabel,
  wikiLabel,
} from './memory-graph'
import type Database from 'better-sqlite3'
import type { MemoryGraphKind } from './memory-graph'

export type MemoryGraphNodeDetail = {
  id: string
  kind: MemoryGraphKind
  label: string
  text: string
  createdAt: string | null
  updatedAt: string | null
  source: Record<string, string | number>
  /** fact: rows identical to this one (incl. itself); dates span them. */
  count?: number
  firstAt?: string | null
  lastAt?: string | null
  /** entity: its non-junk facts, identical ones grouped, most frequent first. */
  facts?: Array<FactGroup>
}

export type FactGroup = {
  id: string
  text: string
  count: number
  firstAt: string | null
  lastAt: string | null
}

type FactRow = {
  fact_id: string
  subject: string | null
  predicate: string | null
  object: string | null
  timestamp: string | null
  created_at?: string | null
}

const FACT_GROUPS_MAX = 50

/**
 * Every fact row in canonical order (same as the graph build). SELECT * so a
 * DB without created_at still works.
 * ponytail: full scan per detail request (~2k rows, ~1 ms); index a
 * normalized key column if the bank reaches 100k facts.
 */
function allFactRows(db: Database.Database): Array<FactRow> {
  if (!tableExists(db, 'facts')) return []
  return db
    .prepare('SELECT * FROM facts ORDER BY timestamp, fact_id')
    .all() as Array<FactRow>
}

const factText = (r: FactRow) =>
  [r.subject, r.predicate, r.object]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' ')

/**
 * Group identical (normalized s|p|o) rows. id/text come from the first row, so
 * feed rows ORDER BY timestamp, fact_id to match the graph's canonical node.
 */
export function groupFacts(rows: ReadonlyArray<FactRow>): Array<FactGroup> {
  const groups = new Map<string, FactGroup>()
  for (const r of rows) {
    // created_at is UTC; timestamp is zone-less local time
    const ts = r.created_at ?? r.timestamp ?? null
    const key = factKey(r.subject, r.predicate, r.object)
    const g = groups.get(key)
    if (!g) {
      groups.set(key, {
        id: r.fact_id,
        text: factText(r),
        count: 1,
        firstAt: ts,
        lastAt: ts,
      })
      continue
    }
    g.count++
    if (ts && (!g.firstAt || ts < g.firstAt)) g.firstAt = ts
    if (ts && (!g.lastAt || ts > g.lastAt)) g.lastAt = ts
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || (a.text < b.text ? -1 : 1),
  )
}

export const NODE_ID_MAX = 1024

// Provenance columns worth showing; anything else (vectors, json blobs of
// internals) stays server-side. Only keys present on the row are returned.
const SOURCE_KEYS = [
  'subject',
  'predicate',
  'object',
  'confidence',
  'source',
  'session_id',
  'source_msg_id',
  'memory_id',
  'memory_type',
  'importance',
  'veracity',
  'trust_tier',
  'recall_count',
  'last_recalled',
  'pinned',
  'tier',
  'summary_of',
  'location',
  'emotion',
  'time_scope',
] as const

type Row = Record<string, unknown>

function pickSource(row: Row): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const k of SOURCE_KEYS) {
    const v = row[k]
    if ((typeof v === 'string' && v !== '') || typeof v === 'number') out[k] = v
  }
  return out
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null

// Table + key column per DB-backed kind; the id prefix is stripped first.
const ROW_SOURCES: Partial<
  Record<
    MemoryGraphKind,
    { table: string; key: string; prefix: string; text: (r: Row) => string }
  >
> = {
  gist: {
    table: 'gists',
    key: 'id',
    prefix: '',
    text: (r) => String(r.text ?? ''),
  },
  working: {
    table: 'working_memory',
    key: 'id',
    prefix: 'wm_',
    text: (r) => String(r.content ?? ''),
  },
  fact: {
    table: 'facts',
    key: 'fact_id',
    prefix: '',
    text: (r) =>
      [r.subject, r.predicate, r.object]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' '),
  },
  episodic: {
    table: 'episodic_memory',
    key: 'id',
    prefix: 'ep_',
    text: (r) => String(r.content ?? ''),
  },
}

function entityDetail(
  db: Database.Database,
  id: string,
): MemoryGraphNodeDetail | null {
  const name = id.slice('entity:'.length).trim()
  if (!name) return null
  const count = (table: string, sql: string, ...args: Array<string>): number =>
    tableExists(db, table)
      ? (db.prepare(sql).get(...args) as { n: number }).n
      : 0
  // Mirror the graph: a fact group hangs off the entities its canonical
  // (first) row names, exact after trim; duplicates follow their canonical.
  const rows = allFactRows(db)
  const canon = new Map<string, FactRow>()
  let junkHits = 0
  const kept: Array<FactRow> = []
  for (const r of rows) {
    const names =
      String(r.subject ?? '').trim() === name ||
      String(r.object ?? '').trim() === name
    if (isJunkFact(r.subject, r.predicate, r.object)) {
      if (names) junkHits++
      continue
    }
    kept.push(r)
    const key = factKey(r.subject, r.predicate, r.object)
    if (!canon.has(key)) canon.set(key, r)
  }
  const mine = new Set(
    [...canon]
      .filter(
        ([, r]) =>
          String(r.subject ?? '').trim() === name ||
          String(r.object ?? '').trim() === name,
      )
      .map(([k]) => k),
  )
  const groups = groupFacts(
    kept.filter((r) => mine.has(factKey(r.subject, r.predicate, r.object))),
  )
  const facts = groups.reduce((n, g) => n + g.count, 0)
  const mentions = count(
    'annotations',
    "SELECT COUNT(*) AS n FROM annotations WHERE kind = 'mentions' AND value = ?",
    name,
  )
  const relations =
    count(
      'memoria_kg',
      'SELECT COUNT(*) AS n FROM memoria_kg WHERE subject = ? OR object = ?',
      name,
      name,
    ) +
    count(
      'triples',
      'SELECT COUNT(*) AS n FROM triples WHERE subject = ? OR object = ?',
      name,
      name,
    )
  if (facts + mentions + relations === 0) return null
  return {
    id,
    kind: 'entity',
    label: truncateLabel(name),
    text: name,
    createdAt: null,
    updatedAt: null,
    source: {
      facts,
      mentions,
      relations,
      distinct_facts: groups.length,
      ...(junkHits > 0 ? { junk_facts_hidden: junkHits } : {}),
    },
    facts: groups.slice(0, FACT_GROUPS_MAX),
  }
}

function wikiDetail(
  id: string,
  profile?: string,
): MemoryGraphNodeDetail | null {
  try {
    const page = readKnowledgePage(id, profile)
    return {
      id,
      kind: 'wiki',
      label: page.meta.title || wikiLabel(id),
      text: page.content,
      createdAt: page.meta.created ?? null,
      updatedAt: page.meta.updated ?? page.meta.modified,
      source: { path: page.meta.path, backlinks: page.backlinks.length },
    }
  } catch {
    // outside the wiki root, not .md, or missing — all "unknown node"
    return null
  }
}

/** Resolve one graph node id to its full record; null when unknown. */
export function getMemoryGraphNode(
  id: string,
  profile?: string,
): MemoryGraphNodeDetail | null {
  if (!id || id.length > NODE_ID_MAX || id.includes('\0')) return null
  const kind = classifyById(id)
  if (kind === 'wiki') return wikiDetail(id, profile)

  const db = openMemoryGraphDb(profile)
  if (!db) return null
  try {
    if (kind === 'entity') return entityDetail(db, id)
    const src = ROW_SOURCES[kind]
    if (!src || !tableExists(db, src.table)) return null
    // table/key are constants from ROW_SOURCES; only the id is user input.
    const row = db
      .prepare(`SELECT * FROM ${src.table} WHERE ${src.key} = ? LIMIT 1`)
      .get(id.slice(src.prefix.length)) as Row | undefined
    if (!row) return null
    const text = src.text(row)
    const detail: MemoryGraphNodeDetail = {
      id,
      kind,
      label: truncateLabel(text),
      text,
      createdAt: str(row.created_at) ?? str(row.timestamp),
      updatedAt: str(row.consolidated_at) ?? str(row.last_recalled),
      source: pickSource(row),
    }
    if (kind === 'fact') {
      // one normalization (factKey) for graph, detail and twins
      const twins = allFactRows(db)
      const key = factKey(
        row.subject as string | null,
        row.predicate as string | null,
        row.object as string | null,
      )
      const g = groupFacts(
        twins.filter((t) => factKey(t.subject, t.predicate, t.object) === key),
      ).at(0)
      if (g) {
        detail.count = g.count
        detail.firstAt = g.firstAt
        detail.lastAt = g.lastAt
      }
    }
    return detail
  } finally {
    db.close()
  }
}
